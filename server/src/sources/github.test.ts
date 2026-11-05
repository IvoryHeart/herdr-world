import { describe, expect, test } from "bun:test";
import { pullRequestLane, workBadgeText } from "../../../shared/worldSources";
import {
  GITHUB_NOT_INSTALLED,
  GITHUB_SIGNED_OUT,
  githubQuery,
  mergedPageQuery,
  normalizeMergedDays,
  parseGitHubResponse,
  refreshGitHub,
  type RunProcess,
} from "./github";

const pr = (number: number, fields: Record<string, unknown> = {}) => ({
  number,
  title: `Synthetic change ${number}`,
  url: `https://github.com/example-org/widgets/pull/${number}`,
  isDraft: false,
  state: "OPEN",
  updatedAt: `2026-01-0${number % 9 || 1}T00:00:00Z`,
  headRefName: `agent/change-${number}`,
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  repository: { nameWithOwner: "example-org/widgets" },
  headRepository: { nameWithOwner: "example-org/widgets" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...fields,
});

const response = (data: Record<string, unknown[]>) => ({
  data: Object.fromEntries(
    ["authored", "reviewing", "assigned", "merged", "issues"].map((alias) => [
      alias,
      { nodes: data[alias] ?? [] },
    ]),
  ),
});

describe("GitHub source", () => {
  test("the crew's own pending marks don't make a green head's checks pending", () => {
    const rollup = (
      state: string,
      nodes: unknown[],
      totalCount = nodes.length,
    ) =>
      pr(3, {
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: { state, contexts: { totalCount, nodes } },
              },
            },
          ],
        },
      });
    const green = {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    };
    const mark = {
      __typename: "StatusContext",
      context: "crew/merge-ready",
      state: "PENDING",
    };
    const checks = (value: ReturnType<typeof pr>) =>
      parseGitHubResponse(response({ authored: [value] }))[0]!.checks;
    expect(checks(rollup("PENDING", [green, mark]))).toBe("pass");
    // A real check still running or failing still counts.
    expect(
      checks(
        rollup("PENDING", [
          green,
          mark,
          { __typename: "CheckRun", status: "IN_PROGRESS", conclusion: null },
        ]),
      ),
    ).toBe("pending");
    expect(
      checks(
        rollup("FAILURE", [
          mark,
          { __typename: "StatusContext", context: "ci/lint", state: "FAILURE" },
        ]),
      ),
    ).toBe("fail");
    // An incomplete read keeps GitHub's combined state.
    expect(checks(rollup("PENDING", [green, mark], 150))).toBe("pending");
    // Without marks, GitHub's state stands as before.
    expect(checks(pr(4))).toBe("pass");
  });

  test("merges searches into one item per pull request with each role", () => {
    const items = parseGitHubResponse(
      response({
        authored: [pr(1)],
        assigned: [pr(1)],
        reviewing: [pr(2, { reviewDecision: "APPROVED" })],
        issues: [
          {
            number: 7,
            title: "Synthetic issue",
            url: "https://github.com/example-org/widgets/issues/7",
            updatedAt: "2026-01-01T00:00:00Z",
            repository: { nameWithOwner: "example-org/widgets" },
          },
        ],
      }),
    );
    expect(items.map((item) => [item.key, item.roles, item.lane])).toEqual([
      ["github:pr:example-org/widgets#2", ["reviewer"], "ready"],
      ["github:pr:example-org/widgets#1", ["author", "assignee"], "green"],
      ["github:issue:example-org/widgets#7", ["assignee"], "todo"],
    ]);
    expect(items[1]).toMatchObject({
      branch: "agent/change-1",
      checks: "pass",
      review: "review_required",
      mergeable: "mergeable",
    });
    expect(items[1]).toMatchObject({ headRepo: "example-org/widgets" });
  });

  test("records a fork's head repository and drops malformed nodes", () => {
    const items = parseGitHubResponse(
      response({
        authored: [
          pr(3, { headRepository: { nameWithOwner: "someone/widgets" } }),
          { number: 4, url: "javascript:alert(1)" },
          pr(5, { state: "CLOSED" }),
          {},
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ headRepo: "someone/widgets" });
  });

  test("a pull request whose head repository is gone has no branch to link", () => {
    const [item] = parseGitHubResponse(
      response({ authored: [pr(3, { headRepository: null })] }),
    );
    expect(item).not.toHaveProperty("branch");
    expect(item).not.toHaveProperty("headRepo");
  });

  test("lanes run review, fixing, green, ready and merged", () => {
    const base = {
      merged: false,
      draft: false,
      checks: "pass" as const,
      review: "review_required" as const,
      mergeable: "mergeable" as const,
    };
    expect(pullRequestLane(base)).toBe("green");
    expect(pullRequestLane({ ...base, checks: "pending" })).toBe("review");
    expect(pullRequestLane({ ...base, draft: true })).toBe("review");
    expect(pullRequestLane({ ...base, checks: "fail" })).toBe("fixing");
    expect(pullRequestLane({ ...base, mergeable: "conflicting" })).toBe(
      "fixing",
    );
    expect(
      pullRequestLane({ ...base, review: "changes_requested", checks: "none" }),
    ).toBe("fixing");
    expect(pullRequestLane({ ...base, review: "approved" })).toBe("ready");
    expect(pullRequestLane({ ...base, checks: "none" })).toBe("review");
    // No review rule: GitHub reports no decision, and passing is ready.
    expect(pullRequestLane({ ...base, review: "none" })).toBe("ready");
    expect(
      pullRequestLane({ ...base, review: "none", checks: "pending" }),
    ).toBe("review");
    expect(pullRequestLane({ ...base, merged: true, checks: "fail" })).toBe(
      "merged",
    );
  });

  test("badges show the number and check state", () => {
    const [failing, merged] = parseGitHubResponse(
      response({
        authored: [
          pr(8, {
            commits: {
              nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }],
            },
          }),
        ],
        merged: [pr(6, { state: "MERGED" })],
      }),
    );
    expect(workBadgeText(failing!)).toBe("#8 ✗");
    expect(workBadgeText(merged!)).toBe("#6 ◆");
  });

  test("asks for pull requests merged in the window, fifty at a time", () => {
    const now = Date.parse("2026-03-10T12:00:00Z");
    const query = mergedPageQuery(now, 7);
    expect(query).toContain("merged:>=2026-03-03T12:00:00Z");
    expect(githubQuery()).toContain("review-requested:@me");
    expect(query).toMatch(/merged: search\(type: ISSUE, first: 50,/u);
    expect(query).toContain("pageInfo { hasNextPage endCursor }");
    expect(mergedPageQuery(now, 7, "page-1")).toMatch(
      /merged: search\(type: ISSUE, after: "page-1", first: 50,/u,
    );
    expect(mergedPageQuery(now, 30)).toContain("merged:>=2026-02-08T12:00:00Z");
    expect(() => normalizeMergedDays(0)).toThrow();
    expect(() => normalizeMergedDays(91)).toThrow();
    expect(() => normalizeMergedDays(2.5)).toThrow();
    expect(normalizeMergedDays(90)).toBe(90);
  });

  const merged = (number: number) =>
    pr(number, {
      state: "MERGED",
      mergedAt: "2026-03-09T08:00:00Z",
    });
  /** gh answering with open work and `total` merged pull requests, 50 per page. */
  const pagedGitHub = (total: number, failPage?: number) => {
    const queries: string[] = [];
    const run: RunProcess = async (argv) => {
      if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
      const query = argv.at(-1)!;
      queries.push(query);
      if (!query.includes("merged: search(")) {
        const open: Record<string, unknown> = response({
          authored: [pr(1)],
        }).data;
        delete open.merged;
        for (const alias of ["authored", "reviewing", "assigned"])
          Object.assign(open[alias]!, { pageInfo: { hasNextPage: false } });
        return { code: 0, stdout: JSON.stringify({ data: open }), stderr: "" };
      }
      const page = Number(/after: "page-(\d+)"/u.exec(query)?.[1] ?? 0);
      if (page === failPage) return { code: 1, stdout: "", stderr: "" };
      const nodes = Array.from(
        { length: Math.max(0, Math.min(50, total - page * 50)) },
        (_, index) => merged(1_000 + page * 50 + index),
      );
      const more = (page + 1) * 50 < total;
      const search = {
        pageInfo: { hasNextPage: more, endCursor: `page-${page + 1}` },
        nodes,
      };
      return {
        code: 0,
        stdout: JSON.stringify({ data: { merged: search } }),
        stderr: "",
      };
    };
    return { run, queries };
  };

  test("reads every pull request merged in the window, page by page", async () => {
    const { run, queries } = pagedGitHub(250);
    const result = await refreshGitHub(run, Date.parse("2026-03-10T12:00:00Z"));
    expect(result.ok).toBe(true);
    const items = result.ok ? result.items : [];
    expect(items.filter((item) => item.lane === "merged")).toHaveLength(250);
    expect(items[0]).toMatchObject({
      finishedAt: Date.parse("2026-03-09T08:00:00Z"),
    });
    // Open work, then five pages of merged pull requests.
    expect(queries).toHaveLength(6);
    expect(queries[1]).not.toContain("after:");
    expect(queries[2]).toContain('after: "page-1"');
    expect(queries[2]).not.toContain("review-requested");
    expect(queries[5]).toContain('after: "page-4"');
  });

  test("stops at GitHub's 1,000-result search limit", async () => {
    const { run, queries } = pagedGitHub(5_000);
    const result = await refreshGitHub(run, 0);
    expect(
      result.ok && result.items.filter((item) => item.lane === "merged"),
    ).toHaveLength(1_000);
    expect(queries).toHaveLength(21);
  });

  test("a failed page fails the refresh, so the last complete list stays", async () => {
    const { run } = pagedGitHub(250, 2);
    expect((await refreshGitHub(run, 0)).ok).toBe(false);
  });

  test("GitHub's next-page flag, not a full page, asks for the next fifty", async () => {
    for (const [total, merges] of [
      [0, 1],
      [49, 1],
      [50, 1],
      [51, 2],
      [100, 2],
      [101, 3],
    ] as const) {
      const { run, queries } = pagedGitHub(total);
      const result = await refreshGitHub(run, 0);
      expect(
        result.ok && result.items.filter((item) => item.lane === "merged"),
      ).toHaveLength(total);
      expect(result.ok && result.pullRequestsComplete).toBe(true);
      expect(queries).toHaveLength(1 + merges);
    }
  });

  test("a failed first merged page fails the refresh, though open work answered", async () => {
    const { run, queries } = pagedGitHub(10, 0);
    expect(await refreshGitHub(run, 0)).toMatchObject({
      ok: false,
      state: "error",
    });
    expect(queries).toHaveLength(2);
  });

  test("a pull request that shifts onto the next page while paging is kept once", async () => {
    const { run: paged } = pagedGitHub(100);
    const run: RunProcess = async (argv, timeoutMs) => {
      const answer = await paged(argv, timeoutMs);
      if (!argv.at(-1)!.includes('after: "page-1"')) return answer;
      // A merge landed between the reads: the first page's last row
      // shows again at the top of the second.
      const data = JSON.parse(answer.stdout);
      data.data.merged.nodes.unshift(merged(1_049));
      return { ...answer, stdout: JSON.stringify(data) };
    };
    const result = await refreshGitHub(run, 0);
    const refs = result.ok
      ? result.items
          .filter((item) => item.lane === "merged")
          .map((item) => item.ref)
      : [];
    expect(refs).toHaveLength(100);
    expect(new Set(refs).size).toBe(100);
    expect(result.ok && result.items).toHaveLength(101);
  });

  test("all pages share one deadline", async () => {
    const { run: paged } = pagedGitHub(5_000);
    let clock = 0;
    const timeouts: number[] = [];
    const run: RunProcess = async (argv, timeoutMs) => {
      timeouts.push(timeoutMs);
      clock += 25_000;
      return paged(argv, timeoutMs);
    };
    const result = await refreshGitHub(run, 0, 7, () => clock);
    expect(result.ok).toBe(false);
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(20_000);
    expect(timeouts.at(-1)).toBeLessThan(20_000);
  });

  test("reports a missing or signed-out gh as not connected", async () => {
    const missing: RunProcess = async () => {
      throw Object.assign(new Error("spawn gh"), { code: "ENOENT" });
    };
    expect(await refreshGitHub(missing, 0)).toEqual({
      ok: false,
      state: "not_connected",
      detail: GITHUB_NOT_INSTALLED,
    });
    const signedOut: RunProcess = async () => ({
      code: 1,
      stdout: "",
      stderr: "You are not logged into any GitHub hosts.",
    });
    expect(await refreshGitHub(signedOut, 0)).toEqual({
      ok: false,
      state: "not_connected",
      detail: GITHUB_SIGNED_OUT,
    });
  });

  test("reads open work, then merged pull requests, after the sign-in check", async () => {
    const calls: string[][] = [];
    const run: RunProcess = async (argv) => {
      calls.push(argv);
      return argv[1] === "auth"
        ? { code: 0, stdout: "", stderr: "" }
        : {
            code: 0,
            stdout: JSON.stringify(response({ authored: [pr(1)] })),
            stderr: "",
          };
    };
    const result = await refreshGitHub(run, 0);
    expect(result.ok && result.items.map((item) => item.ref)).toEqual([
      "example-org/widgets#1",
    ]);
    expect(calls.map((argv) => argv.slice(0, 3))).toEqual([
      ["gh", "auth", "status"],
      ["gh", "api", "graphql"],
      ["gh", "api", "graphql"],
    ]);
  });

  test("merged pull requests are read apart from open work, fifty per request", async () => {
    // GitHub stops a GraphQL request after ten seconds. A week of busy
    // merges, each with its check contexts, took longer than that inside
    // the open-work request, so every refresh failed with HTTP 504.
    const { run, queries } = pagedGitHub(120);
    const result = await refreshGitHub(run, 0);
    expect(result.ok).toBe(true);
    for (const query of queries) {
      const searches = query.match(/\w+: search\(/gu) ?? [];
      if (!query.includes("merged: search(")) continue;
      expect(searches).toEqual(["merged: search("]);
      expect(query).toMatch(/first: 50\b/u);
    }
    expect(queries[0]).not.toContain("merged: search(");
  });

  test("a failed request is an error, never raw CLI output", async () => {
    const run: RunProcess = async (argv) =>
      argv[1] === "auth"
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "token ghp_secret rejected" };
    const result = await refreshGitHub(run, 0);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("ghp_secret");
  });
});
