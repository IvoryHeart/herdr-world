import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  publishTracking,
  catchUpTracking,
  readFlakeReports,
  trackFlakes,
  type GitHubAPI,
} from "./flaky-tests";
import { issueBody, ledgerOf, type FlakyIssue } from "./flaky-test-policy";
const at = "2026-11-20T12:00:00Z";
const flaky = { file: "scripts/example.test.ts", name: "example case" };
const report = { files: [flaky.file], flaky: [flaky] };

function fakeAPI() {
  const issues: FlakyIssue[] = [];
  const statuses: Array<{
    context: string;
    description: string;
    state: string;
  }> = [];
  const calls: Array<{ path: string; body?: any }> = [];
  let failCreateReply = false;
  let sourceConclusion: string | null = "success";
  let sourceRepository: unknown = { full_name: "example/repo" };
  const sources = new Map<number, Record<string, unknown>>();
  const completed: number[] = [];
  const api: GitHubAPI = async (path, body: any) => {
    calls.push({ path, body });
    const source = (id: number) => ({
      id,
      path: ".github/workflows/ci.yml",
      head_sha: "a".repeat(40),
      head_repository: sourceRepository,
      created_at: at,
      conclusion: sourceConclusion,
      run_attempt: 1,
      ...sources.get(id),
    });
    if (path.startsWith("actions/workflows/")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return {
        workflow_runs: completed
          .slice((page - 1) * 100, page * 100)
          .map(source),
      };
    }
    if (path.startsWith("actions/runs/"))
      return source(Number(path.split("/")[2]));
    if (path.startsWith("commits/")) {
      const page = Number(new URLSearchParams(path.split("?")[1]).get("page"));
      return statuses.slice((page - 1) * 100, page * 100);
    }
    if (path.startsWith("statuses/")) {
      statuses.unshift(body);
      return {};
    }
    if (path.startsWith("issues?"))
      return issues.map((issue) => structuredClone(issue));
    if (path === "labels") return {};
    if (path === "issues") {
      const issue = {
        number: issues.length + 1,
        body: body.body,
        labels: [{ name: "flaky" }],
      };
      issues.push(issue);
      if (failCreateReply) {
        failCreateReply = false;
        throw new Error("reply lost");
      }
      return issue;
    }
    const issue = issues.find((issue) => path === `issues/${issue.number}`)!;
    if (!issue) throw new Error(`unexpected path ${path}`);
    issue.body = body.body;
    return issue;
  };
  return {
    api,
    issues,
    statuses,
    calls,
    sources,
    completed,
    repository: (value: unknown) => {
      sourceRepository = value;
    },
    loseReply: () => {
      failCreateReply = true;
    },
    conclusion: (value: string | null) => {
      sourceConclusion = value;
    },
  };
}

test("issue writes recover from a lost reply, deduplicate runs and create a new cause after closure", async () => {
  const mock = fakeAPI();
  mock.loseReply();
  await expect(
    trackFlakes(mock.api, "example/repo", [report], { run: 1, at }),
  ).rejects.toThrow("reply lost");
  for (const run of [1, 1, 2, 2])
    await trackFlakes(mock.api, "example/repo", [report, report], { run, at });
  expect(mock.issues).toHaveLength(1);
  expect(
    ledgerOf(mock.issues[0]!.body)?.occurrences.map((item) => item.run),
  ).toEqual([1, 2]);
  mock.issues.splice(0); // GitHub's open-issue query excludes owner-closed fixes.
  await trackFlakes(mock.api, "example/repo", [report], { run: 3, at });
  expect(
    ledgerOf(mock.issues[0]!.body)?.occurrences.map((item) => item.run),
  ).toEqual([3]);
});

test("serialized completed runs record every verdict without owning Delivery checks", async () => {
  for (const order of [
    [1, 2, 3, 4],
    [4, 3, 2, 1],
    [2, 4, 1, 3],
  ]) {
    const mock = fakeAPI();
    for (const [index, run] of order.entries()) {
      const result = publishTracking(
        mock.api,
        "example/repo",
        [report],
        run,
        1,
        false,
        at,
      );
      if (index === 3) await expect(result).rejects.toThrow("frequency limit");
      else await result;
    }
    expect(mock.statuses[0]!.state).toBe("failure");
    await expect(
      publishTracking(
        mock.api,
        "example/repo",
        [{ ...report, flaky: [] }],
        5,
        1,
        false,
        at,
      ),
    ).rejects.toThrow();
    mock.issues[0]!.labels.push({ name: "flaky-quarantined" });
    await publishTracking(mock.api, "example/repo", [report], 6, 1, false, at);
    expect(mock.statuses[0]!.state).toBe("success");
    mock.conclusion("failure");
    await publishTracking(mock.api, "example/repo", [report], 7, 1, false, at);
    expect(mock.statuses[0]!.state).toBe("failure");
    await publishTracking(mock.api, "example/repo", [], 2, 1, false, at);
    expect(
      mock.statuses.some(
        (status) =>
          status.description.includes("run 7 attempt 1:") &&
          status.state === "failure",
      ),
    ).toBe(true);
    expect(
      mock.statuses.every((status) => status.context === "Flaky accounting"),
    ).toBe(true);
  }
});

test("requested runs use advisory accounting; late requests and superseded attempts do not overwrite it", async () => {
  const mock = fakeAPI();
  mock.conclusion(null);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses[0]!.context).toBe("Flaky accounting");
  expect(mock.statuses[0]!.state).toBe("pending");
  mock.conclusion("success");
  await publishTracking(mock.api, "example/repo", [], 1, 1, false, at);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses.map((status) => status.state)).toEqual([
    "success",
    "pending",
  ]);
  mock.statuses.unshift({
    context: "Flaky accounting",
    description: "Flaky history run 2 attempt 1: recorded",
    state: "success",
  });
  mock.conclusion(null);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses[0]!.description).toContain("run 2 attempt 1:");
  await expect(
    publishTracking(mock.api, "example/repo", [], 1, 2, false, at),
  ).rejects.toThrow("superseded");
  expect(
    mock.statuses.every((status) => status.context === "Flaky accounting"),
  ).toBe(true);
});

test("completed events catch up missed runs once, independent of delivery order", async () => {
  for (const order of [
    [1, 2, 3],
    [1, 3, 2],
    [2, 1, 3],
    [2, 3, 1],
    [3, 1, 2],
    [3, 2, 1],
  ]) {
    for (const trigger of order) {
      const mock = fakeAPI();
      mock.completed.push(...order);
      const loaded: number[] = [];
      const load = async (id: number) => {
        loaded.push(id);
        return [report];
      };
      await catchUpTracking(mock.api, "example/repo", trigger, load, at);
      await catchUpTracking(mock.api, "example/repo", trigger, load, at);
      expect(loaded).toEqual([1, 2, 3]);
      expect(
        ledgerOf(mock.issues[0]!.body)?.occurrences.map((item) => item.run),
      ).toEqual([1, 2, 3]);
      expect(mock.statuses).toHaveLength(3);
      expect(
        mock.statuses.every((status) => status.context === "Flaky accounting"),
      ).toBe(true);
    }
  }
});

test("catch-up resumes interrupted writes, continues other runs and records rerun attempts", async () => {
  const mock = fakeAPI();
  mock.completed.push(1, 2);
  mock.loseReply();
  await expect(
    catchUpTracking(mock.api, "example/repo", 2, async () => [report], at),
  ).rejects.toThrow("needs attention");
  expect(mock.statuses.map((status) => status.description)).toEqual([
    "Flaky history run 2 attempt 1: recorded",
  ]);
  const loaded: number[] = [];
  await catchUpTracking(
    mock.api,
    "example/repo",
    2,
    async (id) => {
      loaded.push(id);
      return [report];
    },
    at,
  );
  expect(loaded).toEqual([1]);
  mock.sources.set(1, { run_attempt: 2 });
  await catchUpTracking(
    mock.api,
    "example/repo",
    1,
    async (id) => {
      loaded.push(id);
      return [report];
    },
    at,
  );
  expect(loaded).toEqual([1, 1]);
  expect(
    ledgerOf(mock.issues[0]!.body)?.occurrences.map((item) => item.run),
  ).toEqual([1, 2]);
  expect(mock.statuses[0]!.description).toBe(
    "Flaky history run 1 attempt 2: recorded",
  );
});

test("missing evidence is retried later and frequency breaches do not starve following runs", async () => {
  const mock = fakeAPI();
  mock.completed.push(1, 2, 3, 4, 5);
  await expect(
    catchUpTracking(
      mock.api,
      "example/repo",
      5,
      async (id) => {
        if (id === 1) throw new Error("artifact download interrupted");
        return [report];
      },
      at,
    ),
  ).rejects.toThrow("needs attention");
  expect(mock.statuses).toHaveLength(4);
  await expect(
    catchUpTracking(mock.api, "example/repo", 5, async () => [report], at),
  ).rejects.toThrow("needs attention");
  expect(
    ledgerOf(mock.issues[0]!.body)
      ?.occurrences.map((item) => item.run)
      .sort(),
  ).toEqual([1, 2, 3, 4, 5]);
  await catchUpTracking(
    mock.api,
    "example/repo",
    5,
    async () => {
      throw new Error("already accounted");
    },
    at,
  );
  expect(mock.statuses).toHaveLength(5);
});

test("catch-up pages through retained runs and receipts without reading foreign artifacts", async () => {
  const mock = fakeAPI();
  mock.completed.push(...Array.from({ length: 101 }, (_, i) => i + 1));
  for (const run of mock.completed)
    mock.sources.set(run, { head_repository: { full_name: "foreign/fork" } });
  mock.sources.set(101, { head_repository: { full_name: "example/repo" } });
  mock.statuses.push(
    ...Array.from({ length: 100 }, () => ({
      context: "Delivery checks",
      description: "unrelated",
      state: "pending",
    })),
  );
  const loaded: number[] = [];
  await catchUpTracking(
    mock.api,
    "example/repo",
    101,
    async (id) => {
      loaded.push(id);
      return [report];
    },
    at,
  );
  mock.statuses.push(mock.statuses.shift()!); // Receipt is beyond the first page.
  await catchUpTracking(
    mock.api,
    "example/repo",
    101,
    async () => {
      throw new Error("already recorded");
    },
    at,
  );
  expect(loaded).toEqual([101]);
  expect(
    mock.calls.some(
      (call) =>
        call.path.startsWith("actions/workflows/") &&
        call.path.includes("page=2"),
    ),
  ).toBe(true);
  expect(
    mock.calls
      .filter((call) => call.body && call.path.startsWith("statuses/"))
      .every((call) => call.body.context === "Flaky accounting"),
  ).toBe(true);
});

test.each(["success", "expired", "download-fails", "invalid", "no-artifacts"])(
  "real tracker downloads retained artifacts as data (%s)",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "flake-tracker-"));
    try {
      const calls = join(root, "calls.jsonl");
      const downloaded = join(root, "downloaded.json");
      const shim = join(root, "gh");
      writeFileSync(
        shim,
        `#!${process.execPath}
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (JSON.stringify(args.slice(0, 8)) !== JSON.stringify(["run", "download", "1", "--repo", "example/repo", "--pattern", "flaky-tests-*", "--dir"])) process.exit(9);
writeFileSync(${JSON.stringify(downloaded)}, JSON.stringify(args));
if (${JSON.stringify(mode)} === "download-fails") process.exit(1);
const directory = join(args[8], "flaky-tests-unit-1");
mkdirSync(directory);
writeFileSync(join(directory, "unit.json"), ${JSON.stringify(mode === "invalid" ? "{}" : JSON.stringify(report))});
`,
      );
      chmodSync(shim, 0o755);
      const preload = join(root, "api.ts");
      writeFileSync(
        preload,
        `
import { appendFileSync } from "node:fs";
const source = { id: 1, path: ".github/workflows/ci.yml", head_sha: "a".repeat(40), head_repository: { full_name: "example/repo" }, created_at: new Date().toISOString(), conclusion: "success", run_attempt: 1 };
globalThis.fetch = async (url, options) => {
  const path = new URL(url).pathname.split("/repos/example/repo/")[1];
  const body = options.body ? JSON.parse(options.body) : undefined;
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ path, body }) + "\\n");
  let result;
  if (path === "actions/runs/1") result = source;
  else if (path === "actions/workflows/ci.yml/runs") result = { workflow_runs: [source] };
  else if (path === "actions/runs/1/artifacts") result = { artifacts: ${JSON.stringify(mode === "no-artifacts" ? [] : [{ name: "flaky-tests-unit-1", expired: mode === "expired" }])} };
  else if (path === "issues" && body) result = { number: 1, body: body.body, labels: [{ name: "flaky" }] };
  else if (path === "issues" || path.startsWith("commits/")) result = [];
  else if (path === "labels" || path.startsWith("statuses/")) result = {};
  else throw new Error("Unexpected API path " + path);
  return Response.json(result);
};
`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "--preload",
          preload,
          join(import.meta.dir, "flaky-tests.ts"),
          "track",
        ],
        {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            PATH: `${root}${delimiter}${process.env.PATH}`,
            GH_TOKEN: "synthetic-test-token",
            GITHUB_REPOSITORY: "example/repo",
            SOURCE_RUN: "1",
            SOURCE_ATTEMPT: "1",
          },
        },
      );
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      const recorded = readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const statuses = recorded.filter((call) =>
        call.path.startsWith("statuses/"),
      );
      expect(code, stderr).toBe(
        ["success", "no-artifacts"].includes(mode) ? 0 : 1,
      );
      expect(statuses).toHaveLength(
        ["success", "no-artifacts"].includes(mode) ? 1 : 0,
      );
      expect(
        statuses.every((call) => call.body.context === "Flaky accounting"),
      ).toBe(true);
      expect(existsSync(downloaded)).toBe(
        !["expired", "no-artifacts"].includes(mode),
      );
      if (existsSync(downloaded))
        expect(
          existsSync(JSON.parse(readFileSync(downloaded, "utf8"))[8]),
        ).toBe(false);
      expect(
        recorded.filter((call) => call.path === "issues" && call.body),
      ).toHaveLength(mode === "success" ? 1 : 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  10000,
);

test("catch-up rejects untrusted triggers before discovery or artifact loading", async () => {
  for (const repository of [
    { full_name: "foreign/fork" },
    undefined,
    null,
    {},
  ]) {
    const mock = fakeAPI();
    mock.repository(repository);
    await expect(
      catchUpTracking(
        mock.api,
        "example/repo",
        1,
        async () => {
          throw new Error("must not download");
        },
        at,
      ),
    ).rejects.toThrow("source repository");
    expect(mock.calls.map((call) => call.path)).toEqual(["actions/runs/1"]);
  }
});

test.each([true, false])(
  "untrusted source repositories cannot write tracking state (pending=%s)",
  async (pending) => {
    for (const repository of [
      { full_name: "contributor/fork" },
      { full_name: "example/repo-other" },
      undefined,
      null,
      {},
    ]) {
      const mock = fakeAPI();
      mock.repository(repository);
      mock.conclusion(pending ? null : "success");
      for (const run of [1, 2, 3, 4])
        await expect(
          publishTracking(
            mock.api,
            "example/repo",
            [report],
            run,
            1,
            pending,
            at,
          ),
        ).rejects.toThrow("source repository");
      expect(mock.issues).toEqual([]);
      expect(mock.statuses).toEqual([]);
      expect(mock.calls.map((call) => call.path)).toEqual([
        "actions/runs/1",
        "actions/runs/2",
        "actions/runs/3",
        "actions/runs/4",
      ]);
    }
  },
);

test("retained JSON from all attempts is data only and malformed evidence is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "flake-evidence-"));
  try {
    expect(readFlakeReports(join(root, "absent"))).toEqual([]);
    writeFileSync(join(root, "first.json"), JSON.stringify(report));
    mkdirSync(join(root, "flaky-tests-unit-1"));
    writeFileSync(
      join(root, "flaky-tests-unit-1", "retry.json"),
      JSON.stringify({ ...report, flaky: [] }),
    );
    expect(readFlakeReports(root)).toHaveLength(2);
    writeFileSync(
      join(root, "invalid.json"),
      JSON.stringify({
        files: [flaky.file],
        flaky: [{ file: "../secret.test.ts", name: "bad" }],
      }),
    );
    expect(() => readFlakeReports(root)).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CI delegates only test recovery and tracker runs trusted code with a serialized write token", () => {
  const workflow = (name: string): any =>
    Bun.YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
  const ci = workflow("ci"),
    browser = workflow("world-browser"),
    models = workflow("behavioral-verification"),
    tracker = workflow("flaky-tests");
  for (const candidate of [ci, browser, models]) {
    expect(Object.values(candidate.permissions)).not.toContain("write");
    for (const job of Object.values(candidate.jobs) as any[])
      for (const step of job.steps || []) {
        expect(step.name).not.toBe("Retry failed test once");
        expect(step["continue-on-error"]).toBeUndefined();
      }
  }
  expect(tracker.on).toEqual({
    workflow_run: { workflows: ["CI"], types: ["requested", "completed"] },
  });
  expect(tracker.concurrency).toEqual({
    group: "flaky-test-tracking",
    queue: "max",
  });
  expect(tracker.permissions).toEqual({
    contents: "read",
    actions: "read",
    issues: "write",
    statuses: "write",
  });
  expect(tracker.jobs.track.if).toBe(
    "github.event.workflow_run.head_repository.full_name == github.repository",
  );
  const steps = tracker.jobs.track.steps;
  expect(
    steps.find((step: any) => step.uses?.startsWith("actions/checkout@")).with,
  ).toEqual({ "persist-credentials": false });
  expect(
    steps.some(
      (step: any) =>
        step.run?.includes("install") || step.run?.includes("source/"),
    ),
  ).toBe(false);
  expect(
    steps.some((step: any) =>
      step.uses?.startsWith("actions/download-artifact@"),
    ),
  ).toBe(false);
  expect(
    steps.find((step: any) => step.run === "bun scripts/flaky-tests.ts track"),
  ).toMatchObject({
    if: "github.event.action == 'completed'",
    env: { SOURCE_RUN: "${{ github.event.workflow_run.id }}" },
  });
  const gate = ci.jobs.delivery.steps.find(
    (step: any) => step.run === "bun scripts/flaky-tests.ts gate",
  );
  expect(gate.if).toBe("always()");
  expect(ci.jobs.delivery.steps.indexOf(gate)).toBeLessThan(
    ci.jobs.delivery.steps.findIndex(
      (step: any) => step.run === "bun scripts/ci-delivery-result.ts",
    ),
  );
});

test.each(["reuse", "scoped"])(
  "real Delivery gate blocks breached history in %s mode and retains selected inventory",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "flake-gate-"));
    try {
      const summary = join(root, "summary.md");
      const issue = {
        number: 12,
        labels: [{ name: "flaky" }],
        body: issueBody(
          {
            test: flaky,
            occurrences: [1, 2, 3, 4].map((run) => ({ run, at })),
          },
          "example/repo",
        ),
      };
      const preload = join(root, "api.ts");
      writeFileSync(
        preload,
        `globalThis.fetch = async () => Response.json(${JSON.stringify([issue])});`,
      );
      const child = Bun.spawn(
        [
          process.execPath,
          "--preload",
          preload,
          join(import.meta.dir, "flaky-tests.ts"),
          "gate",
        ],
        {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
          env: {
            ...process.env,
            GH_TOKEN: "synthetic-test-token",
            GITHUB_REPOSITORY: "example/repo",
            GITHUB_RUN_ID: "5",
            GITHUB_RUN_ATTEMPT: "2",
            GITHUB_STEP_SUMMARY: summary,
            VALIDATION_MODE: mode,
            HERDR_CI_SELECTION: JSON.stringify({
              unit: [flaky.file],
              world: [],
              web: [],
            }),
          },
        },
      );
      const [code, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
        new Response(child.stdout).text(),
      ]);
      expect(code).not.toBe(0);
      expect(readFileSync(summary, "utf8")).toContain("### Flaky tests");
      expect(
        JSON.parse(
          readFileSync(
            join(root, ".agents/delivery/flakes/inventory-2.json"),
            "utf8",
          ),
        ),
      ).toEqual({ files: [flaky.file], flaky: [] });
      expect(stderr).toContain(
        mode === "reuse" ? "#12" : "Missing test retry evidence",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  10000,
);
