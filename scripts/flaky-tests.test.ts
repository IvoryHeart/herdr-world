import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  publishTracking,
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
  const api: GitHubAPI = async (path, body: any) => {
    calls.push({ path, body });
    if (path.startsWith("actions/runs/"))
      return {
        path: ".github/workflows/ci.yml",
        head_sha: "a".repeat(40),
        head_repository: sourceRepository,
        created_at: at,
        conclusion: sourceConclusion,
        run_attempt: 1,
      };
    if (path.startsWith("commits/")) return statuses;
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

test("serialized completed runs enforce fourth occurrence and cannot erase a newer verdict", async () => {
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
    expect(mock.statuses[0]!.description).toContain("run 7:");
  }
});

test("requested runs hold the required status; late requests and superseded attempts do not overwrite it", async () => {
  const mock = fakeAPI();
  mock.conclusion(null);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses[0]!.state).toBe("pending");
  mock.conclusion("success");
  await publishTracking(mock.api, "example/repo", [], 1, 1, false, at);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses.map((status) => status.state)).toEqual([
    "success",
    "pending",
  ]);
  mock.statuses.unshift({
    context: "Delivery checks",
    description: "Flaky history run 2: recorded",
    state: "success",
  });
  mock.conclusion(null);
  await publishTracking(mock.api, "example/repo", [], 1, 1, true, at);
  expect(mock.statuses[0]!.description).toContain("run 2:");
  await expect(
    publishTracking(mock.api, "example/repo", [], 1, 2, false, at),
  ).rejects.toThrow("superseded");
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
    writeFileSync(
      join(root, "retry.json"),
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
  const download = steps.find((step: any) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  expect(download.with.pattern).toBe("flaky-tests-*");
  expect(download.with["run-id"]).toBe("${{ github.event.workflow_run.id }}");
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
