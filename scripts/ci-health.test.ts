import { expect, test } from "bun:test";
import {
  collectHealth,
  spread,
  type Github,
  type HealthData,
  type Pull,
  type Run,
} from "./ci-health-github";
import { deliveryLines, percentile } from "./ci-health-delivery";
import { healthReport } from "./ci-health";

const since = new Date("2026-01-01T00:00:00Z");
const now = new Date("2026-01-04T00:00:00Z");
const run = (id: number, conclusion = "success"): Run => ({
  id,
  name: "CI",
  event: "pull_request",
  head_sha: "a".repeat(40),
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:10:00Z",
  conclusion,
  run_attempt: 1,
  html_url: `https://example.invalid/runs/${id}`,
});
const pull = (number: number, title = "Change behavior", body = ""): Pull => ({
  number,
  title,
  body,
  createdAt: "2026-01-01T01:00:00Z",
  mergedAt: `2026-01-02T0${number}:00:00Z`,
  mergeCommit: { oid: String(number).repeat(40) },
  commits: { nodes: [{ commit: { committedDate: "2026-01-01T00:00:00Z" } }] },
  labels: { nodes: [] },
});
const data = (): HealthData => ({
  runs: [],
  jobs: [],
  attempts: [],
  pulls: [],
  releases: [],
  shipped: new Map(),
  requests: 0,
  limits: [],
});

test("health separates cancellation from failure, includes queue time and reports sparse evidence honestly", () => {
  const input = data();
  input.runs = [run(1), run(2, "failure"), run(3, "cancelled")];
  input.jobs = [
    {
      run: input.runs[0]!,
      jobs: [
        {
          name: "Model",
          conclusion: "success",
          labels: ["ubuntu-latest"],
          created_at: "2026-01-02T00:01:00Z",
          started_at: "2026-01-02T00:03:00Z",
          completed_at: "2026-01-02T00:08:00Z",
          steps: [],
        },
      ],
    },
  ];
  input.attempts = [run(4), run(4, "failure")];
  const report = healthReport(input, since, now);
  expect(report).toContain("pass 1 (33.3%), fail 1 (33.3%), cancel 1 (33.3%)");
  expect(report).toContain("green p50/p90 10.0m/10.0m");
  expect(report).toContain("Model: p50/p90 5.0m/5.0m");
  expect(report).toContain("Runner wait ubuntu-latest: p50/p90 2.0m/2.0m");
  expect(report).toContain("1/2 green; 49/50 target unproven");
  expect(report).toContain("→ release n/a / n/a (n=0)");
  expect(report.split("\n").length).toBeLessThanOrEqual(26);
  expect(percentile([9, 1, 5, NaN], 0.5)).toBe(5);
});

test("delivery attributes regressions and recovery to the first release that actually contains the fix", () => {
  const input = data();
  input.pulls = [
    pull(1),
    pull(2, "fix: regression", "Regression-of: #1\nAffected-release: v1.0.0\n"),
    pull(3, "fix: ordinary bug"),
  ];
  input.releases = [
    {
      tagName: "v1.0.0",
      publishedAt: "2026-01-02T01:30:00Z",
      isPrerelease: false,
      tagCommit: { oid: "a".repeat(40) },
    },
    {
      tagName: "v1.0.1",
      publishedAt: "2026-01-03T01:30:00Z",
      isPrerelease: false,
      tagCommit: { oid: "b".repeat(40) },
    },
  ];
  input.shipped.set("v1.0.0", new Set([input.pulls[0]!.mergeCommit!.oid]));
  input.shipped.set(
    "v1.0.1",
    new Set(input.pulls.slice(0, 2).map((pull) => pull.mergeCommit!.oid)),
  );
  let report = deliveryLines(input, since, now).join("\n");
  expect(report).toContain(
    "main 3 merges (1.0/day); stable releases 2 (0.67/day)",
  );
  expect(report).toContain(
    "merges 1/3; releases 1/2 explicitly linked; 1 fixes unattributed",
  );
  expect(report).toContain("published fix p50/p90 24.0h / 24.0h (n=1)");
  // Several corrective PRs for one release are one incident; an additional
  // unpublished correction cannot erase its already published recovery.
  input.pulls[2]!.body = "Affected-release: v1.0.0";
  report = deliveryLines(input, since, now).join("\n");
  expect(report).toContain("linked unreleased 0");
  // A merged fix is not recovery until publication includes its immutable SHA.
  input.shipped.delete("v1.0.1");
  report = deliveryLines(input, since, now).join("\n");
  expect(report).toContain("linked unreleased 1, oldest 46.5h");
  expect(report).toContain("published fix p50/p90 n/a / n/a (n=0)");
});

test("GitHub collection stops at fixed bounds, uses immutable comparisons and writes through no API", () => {
  const calls: string[][] = [];
  const api: Github = (args) => {
    calls.push(args);
    if (args[0] === "graphql")
      return {
        data: {
          search: { issueCount: 101, nodes: [pull(1)] },
          repository: {
            releases: {
              nodes: [
                {
                  tagName: "v1",
                  publishedAt: "2026-01-03T00:00:00Z",
                  isPrerelease: false,
                  tagCommit: { oid: "b".repeat(40) },
                },
              ],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      };
    const path = args[0]!;
    if (path.includes("/jobs?")) return { jobs: [], total_count: 0 };
    if (path.includes("/compare/"))
      return {
        status: "ahead",
        total_commits: 1,
        commits: [{ sha: "b".repeat(40) }],
      };
    if (path.includes("/actions/runs?"))
      return {
        workflow_runs: Array.from({ length: 100 }, (_, index) =>
          run(calls.length * 100 + index),
        ),
      };
    throw new Error(`Unexpected read ${path}`);
  };
  const result = collectHealth("example/project", since, api);
  expect(result.requests).toBe(62);
  expect(result.limits).toContain("run inventory capped at 1,000");
  expect(result.limits).toContain("merged PR inventory capped at 100");
  expect(calls.find((args) => args[0]?.includes("compare/"))?.[0]).toContain(
    `${"1".repeat(40)}...${"b".repeat(40)}`,
  );
  expect(
    calls.some(
      (args) => args.includes("--method") || args.includes("--paginate"),
    ),
  ).toBe(false);
  expect(result.shipped.get("v1")?.has("1".repeat(40))).toBe(true);
  expect(spread([1, 2, 3, 4, 5], 3)).toEqual([1, 3, 5]);
  expect(spread([1, 2], 1)).toEqual([1]);
});

test("incomplete ancestry and GraphQL errors cannot fabricate release lead times", () => {
  const api: Github = (args) =>
    args[0] === "graphql"
      ? { errors: [{ message: "synthetic" }] }
      : { workflow_runs: [] };
  expect(() => collectHealth("example/project", since, api)).toThrow(
    "delivery query returned errors",
  );
  expect(() => collectHealth("../private", since, api)).toThrow(
    "Invalid repository",
  );
  const input = data();
  input.pulls = [pull(1, "fix: a regression", "Regression-of: #999")];
  expect(deliveryLines(input, since, now).join("\n")).toContain(
    "1 fixes unattributed",
  );
});

test("optional GitHub failures stay visible without retries; required inventory failures stop collection", () => {
  let jobs = 0;
  const api: Github = (args) => {
    if (args[0] === "graphql")
      return {
        data: {
          search: { issueCount: 0, nodes: [] },
          repository: {
            releases: { nodes: [], pageInfo: { hasNextPage: false } },
          },
        },
      };
    if (args[0]?.includes("/jobs?")) {
      jobs++;
      throw new Error("Synthetic API outage");
    }
    return { workflow_runs: [run(1)] };
  };
  const result = collectHealth("example/project", since, api);
  expect(jobs).toBe(1);
  expect(result.jobs).toEqual([]);
  expect(result.limits).toContain("unavailable read: actions/runs/1/jobs");
  expect(() =>
    collectHealth("example/project", since, () => {
      throw new Error("Inventory unavailable");
    }),
  ).toThrow("Inventory unavailable");
});
