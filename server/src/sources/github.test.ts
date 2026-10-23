import { describe, expect, test } from "bun:test";
import { pullRequestLane, workBadgeText } from "../../../shared/worldSources";
import {
  GITHUB_NOT_INSTALLED,
  GITHUB_SIGNED_OUT,
  githubQuery,
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

  test("asks for merged pull requests from the last week only", () => {
    const query = githubQuery(Date.parse("2026-03-10T12:00:00Z"));
    expect(query).toContain("merged:>=2026-03-03");
    expect(query).toContain("review-requested:@me");
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

  test("runs one GraphQL request after the sign-in check", async () => {
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
    ]);
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
