import { expect, test } from "bun:test";
import {
  existsSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const indexes: FlakyIssue[] = [];
  let pages: number[][] | undefined;
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
        workflow_runs: (pages
          ? pages[page - 1] || []
          : completed.slice((page - 1) * 100, page * 100)
        ).map(source),
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
      return (path.includes("labels=flaky-accounting") ? indexes : issues).map(
        (issue) => structuredClone(issue),
      );
    if (path === "labels") return {};
    if (path === "issues") {
      const cache = body.labels.includes("flaky-accounting");
      const collection = cache ? indexes : issues;
      const issue = {
        number: cache ? 10000 : issues.length + 1,
        body: body.body,
        labels: [{ name: "flaky" }],
      };
      collection.push(issue);
      if (failCreateReply && !cache) {
        failCreateReply = false;
        throw new Error("reply lost");
      }
      return issue;
    }
    const issue = [...issues, ...indexes].find(
      (issue) => path === `issues/${issue.number}`,
    )!;
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
    indexes,
    pages: (value: number[][]) => {
      pages = value;
    },
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
      expect(loaded).toEqual([
        trigger,
        ...[1, 2, 3].filter((id) => id !== trigger),
      ]);
      expect(
        ledgerOf(mock.issues[0]!.body)
          ?.occurrences.map((item) => item.run)
          .sort(),
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
    "Flaky history run 1 attempt 1: recorded",
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
  expect(loaded).toEqual([2]);
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
  expect(loaded).toEqual([2, 1]);
  expect(
    ledgerOf(mock.issues[0]!.body)
      ?.occurrences.map((item) => item.run)
      .sort(),
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

test("short nonterminal run pages reach old misses with bounded API requests", async () => {
  const mock = fakeAPI();
  const runs = Array.from({ length: 1283 }, (_, i) => 1283 - i);
  for (const id of runs)
    mock.sources.set(id, { head_sha: id.toString(16).padStart(40, "0") });
  mock.indexes.push({
    number: 10000,
    labels: [{ name: "flaky-accounting" }],
    body: `<!-- flaky-accounting-v1: ${JSON.stringify({ receipts: runs.filter((id) => id !== 1 && id !== 1283).map((id) => [id, 1]), after: 0 })} -->`,
  });
  const pages = [runs.slice(0, 87), runs.slice(87, 170)];
  for (let i = 170; i < runs.length; i += 100)
    pages.push(runs.slice(i, i + 100));
  mock.pages(pages);
  const loaded: number[] = [];
  await catchUpTracking(
    mock.api,
    "example/repo",
    1283,
    async (id) => {
      loaded.push(id);
      return [report];
    },
    at,
  );
  expect(loaded).toEqual([1283, 1]);
  expect(
    ledgerOf(mock.issues[0]!.body)
      ?.occurrences.map((item) => item.run)
      .sort((a, b) => a - b),
  ).toEqual([1, 1283]);
  expect(mock.calls.length).toBeLessThan(30);
  expect(
    mock.calls
      .filter((call) => /^actions\/runs\/\d+$/.test(call.path))
      .map((call) => call.path),
  ).toEqual(["actions/runs/1283"]);
  expect(
    mock.calls.filter((call) => call.path.startsWith("commits/")),
  ).toHaveLength(2);
  const previous = mock.calls.length;
  await catchUpTracking(
    mock.api,
    "example/repo",
    1283,
    async () => {
      throw new Error("already accounted");
    },
    at,
  );
  expect(mock.calls.length - previous).toBe(2 + pages.length + 1);
});

test("listed source metadata is validated without refetching runs or foreign artifacts", async () => {
  const mock = fakeAPI();
  mock.completed.push(1, 2, 3);
  mock.sources.set(1, { head_repository: { full_name: "foreign/fork" } });
  mock.sources.set(2, { head_sha: "invalid" });
  const loaded: number[] = [];
  await expect(
    catchUpTracking(
      mock.api,
      "example/repo",
      3,
      async (id) => {
        loaded.push(id);
        return [];
      },
      at,
    ),
  ).rejects.toThrow("needs attention");
  expect(loaded).toEqual([3]);
  expect(
    mock.calls
      .filter((call) => /^actions\/runs\/\d+$/.test(call.path))
      .map((call) => call.path),
  ).toEqual(["actions/runs/3"]);
});

test("cold backlog drains bounded batches while prioritizing the triggering run", async () => {
  const mock = fakeAPI();
  mock.completed.push(...Array.from({ length: 1282 }, (_, i) => 1282 - i));
  const loaded: number[] = [];
  const load = async (id: number) => {
    loaded.push(id);
    return [];
  };
  await catchUpTracking(mock.api, "example/repo", 1282, load, at);
  expect(loaded).toEqual([1282, 1, 2, 3, 4, 5, 6, 7]);
  expect(mock.calls.length).toBeLessThan(50);
  const previous = mock.calls.length;
  await catchUpTracking(mock.api, "example/repo", 1281, load, at);
  expect(loaded.slice(8)).toEqual([1281, 8, 9, 10, 11, 12, 13, 14]);
  expect(mock.calls.length - previous).toBeLessThan(50);
});

test("every failed subset of a full batch leaves later missed runs reachable", async () => {
  for (let failures = 0; failures < 256; failures++) {
    const mock = fakeAPI();
    mock.completed.push(...Array.from({ length: 9 }, (_, i) => i + 1));
    const loaded: number[] = [];
    const load = async (id: number) => {
      loaded.push(id);
      if (id < 9 && failures & (1 << (id - 1)))
        throw new Error("unavailable artifact");
      return [];
    };
    await catchUpTracking(mock.api, "example/repo", 9, load, at).catch(
      () => {},
    );
    await catchUpTracking(mock.api, "example/repo", 9, load, at).catch(
      () => {},
    );
    // Even seven permanently unavailable older runs cannot starve run eight.
    expect(loaded).toContain(8);
    for (const id of mock.completed)
      if (id === 9 || !(failures & (1 << (id - 1))))
        expect(
          mock.statuses.some((status) =>
            status.description.startsWith(`Flaky history run ${id} attempt 1:`),
          ),
        ).toBe(true);
  }
});

test("the request ceiling also covers artifact discovery and oversized metadata scans", async () => {
  const mock = fakeAPI();
  await expect(
    catchUpTracking(
      mock.api,
      "example/repo",
      1,
      async (_id, api) => {
        for (let i = 0; i < 100; i++) await api("labels", {});
        return [];
      },
      at,
    ),
  ).rejects.toThrow("request budget reached");
  expect(mock.calls).toHaveLength(80);
  expect(mock.statuses).toHaveLength(0);
});

test("lost cache replies and a rebuilt index replay durable history idempotently", async () => {
  const mock = fakeAPI();
  mock.completed.push(1, 2);
  let loseReply = true;
  const api: GitHubAPI = async (path, body) => {
    const response = await mock.api(path, body);
    if (loseReply && path === "issues/10000") {
      loseReply = false;
      throw new Error("cache reply lost");
    }
    return response;
  };
  await expect(
    catchUpTracking(api, "example/repo", 2, async () => [report], at),
  ).rejects.toThrow("needs attention");
  await catchUpTracking(api, "example/repo", 2, async () => [report], at);
  mock.indexes.splice(0);
  await catchUpTracking(api, "example/repo", 2, async () => [report], at);
  expect(
    ledgerOf(mock.issues[0]!.body)
      ?.occurrences.map((item) => item.run)
      .sort(),
  ).toEqual([1, 2]);
});

test("cache rebuild honors existing receipts without reopening owner-closed causes", async () => {
  const mock = fakeAPI();
  mock.completed.push(1);
  await catchUpTracking(mock.api, "example/repo", 1, async () => [report], at);
  mock.issues.splice(0); // Owner closed the fixed cause.
  mock.indexes.splice(0); // Owner also closed the disposable index.
  await catchUpTracking(
    mock.api,
    "example/repo",
    1,
    async () => {
      throw new Error("a durable receipt needs no artifact replay");
    },
    at,
  );
  expect(mock.issues).toHaveLength(0);
  expect(mock.statuses).toHaveLength(1);
});

test("requested status pagination still finds receipts after a full page", async () => {
  const mock = fakeAPI();
  mock.conclusion(null);
  mock.statuses.push(
    ...Array.from({ length: 100 }, () => ({
      context: "Delivery checks",
      description: "unrelated",
      state: "pending",
    })),
  );
  mock.statuses.push({
    context: "Flaky accounting",
    description: "Flaky history run 2 attempt 1: recorded",
    state: "success",
  });
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses).toHaveLength(101);
  expect(
    mock.calls.some((call) =>
      call.path.includes("statuses?per_page=100&page=2"),
    ),
  ).toBe(true);
});

test.each(["success", "expired", "download-fails", "invalid", "no-artifacts"])(
  "real tracker downloads retained artifacts as data (%s)",
  async (mode) => {
    const root = mkdtempSync(join(tmpdir(), "flake-tracker-"));
    try {
      const calls = join(root, "calls.jsonl");
      const zip = Bun.spawnSync([
        "python3",
        "-c",
        "import sys, zipfile; archive = zipfile.ZipFile(sys.stdout.buffer, 'w'); archive.writestr('../../unit.json', sys.argv[1]); archive.close()",
        mode === "invalid" ? "{}" : JSON.stringify(report),
      ]);
      expect(zip.exitCode).toBe(0);
      const archive = Buffer.from(zip.stdout).toString("base64");
      const preload = join(root, "api.ts");
      writeFileSync(
        preload,
        `
import { appendFileSync } from "node:fs";
const source = { id: 1, path: ".github/workflows/ci.yml", head_sha: "a".repeat(40), head_repository: { full_name: "example/repo" }, created_at: new Date().toISOString(), conclusion: "success", run_attempt: 1 };
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  const path = parsed.pathname.split("/repos/example/repo/")[1];
  const body = options.body ? JSON.parse(options.body) : undefined;
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ path, body }) + "\\n");
  let result;
  if (path === "actions/runs/1") result = source;
  else if (path === "actions/workflows/ci.yml/runs") result = { workflow_runs: parsed.searchParams.get("page") === "1" ? [source] : [] };
  else if (path === "actions/runs/1/artifacts") result = { artifacts: ${JSON.stringify(mode === "no-artifacts" ? [] : [{ id: 1, name: "flaky-tests-unit-1", expired: mode === "expired" }])} };
  else if (path === "actions/artifacts/1/zip") return ${JSON.stringify(mode)} === "download-fails" ? new Response("interrupted", { status: 503 }) : new Response(Buffer.from(${JSON.stringify(archive)}, "base64"));
  else if (path === "issues" && body) result = { number: 1, body: body.body, labels: [{ name: "flaky" }] };
  else if (path === "issues" || path.startsWith("commits/")) result = [];
  else if (path === "issues/1" || path === "labels" || path.startsWith("statuses/")) result = {};
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
      expect(
        recorded.some((call) => call.path === "actions/artifacts/1/zip"),
      ).toBe(!["expired", "no-artifacts"].includes(mode));
      expect(existsSync(join(root, "unit.json"))).toBe(false);
      expect(
        recorded.filter(
          (call) =>
            call.path === "issues" && call.body?.labels?.includes("flaky"),
        ),
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
