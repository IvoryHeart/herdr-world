import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../../../shared/worldSources";
import { refreshGitHub, type RunProcess } from "./github";
import {
  countImages,
  DETAIL_MAX_AGE_MS,
  DETAIL_PER_REFRESH,
  detailQuery,
  detailsDue,
  detailStamp,
  parseDetail,
  resultOutcome,
  reviewerOf,
  uiPath,
  type CachedDetail,
} from "./pullRequestDetail";

const HEAD = "c".repeat(40);
const OLDER = "b".repeat(40);
const OLDEST = "a".repeat(40);

const item = (number: number, fields: Partial<WorkItem> = {}): WorkItem => ({
  key: `github:pr:example-org/widgets#${number}`,
  source: "github",
  kind: "pull_request",
  ref: `example-org/widgets#${number}`,
  title: `Synthetic ${number}`,
  url: `https://github.com/example-org/widgets/pull/${number}`,
  lane: "green",
  status: "open",
  roles: ["author"],
  updatedAt: 1_000,
  number,
  repo: "example-org/widgets",
  base: "main",
  headSha: HEAD,
  checks: "pass",
  review: "review_required",
  mergeable: "mergeable",
  draft: false,
  ...fields,
});

const post = (body: string, fields: Record<string, unknown> = {}) => ({
  author: { login: "synthetic-owner" },
  authorAssociation: "OWNER",
  body,
  url: "https://github.com/example-org/widgets/pull/7#issuecomment-1",
  ...fields,
});

/** A GraphQL pull request node with three commits; the last is the head. */
const detailNode = (fields: Record<string, unknown> = {}) => ({
  headRefOid: HEAD,
  body: "Before and after:\n![phone](https://example.com/a.webp)",
  author: { login: "synthetic-owner" },
  headRef: { compare: { aheadBy: 4 } },
  files: {
    totalCount: 2,
    nodes: [{ path: "web/src/world/Thing.tsx" }, { path: "server/src/x.ts" }],
  },
  commits: {
    nodes: [
      { commit: { oid: OLDEST, committedDate: "2026-01-01T10:00:00Z" } },
      { commit: { oid: OLDER, committedDate: "2026-01-01T11:00:00Z" } },
      { commit: { oid: HEAD, committedDate: "2026-01-01T12:00:00Z" } },
    ],
  },
  latest: {
    nodes: [
      {
        commit: {
          oid: HEAD,
          statusCheckRollup: {
            contexts: {
              totalCount: 3,
              nodes: [
                {
                  __typename: "CheckRun",
                  name: "Unit tests",
                  status: "COMPLETED",
                  conclusion: "SUCCESS",
                  completedAt: "2026-01-01T12:10:00Z",
                  detailsUrl: "https://example.com/run/1",
                  isRequired: true,
                },
                {
                  __typename: "CheckRun",
                  name: "Browser suite",
                  status: "IN_PROGRESS",
                  conclusion: null,
                  isRequired: false,
                },
                {
                  __typename: "StatusContext",
                  context: "external/lint",
                  state: "FAILURE",
                  createdAt: "2026-01-01T12:05:00Z",
                  targetUrl: "http://example.com/insecure",
                  isRequired: false,
                },
              ],
            },
          },
        },
      },
    ],
  },
  reviews: {
    nodes: [
      post("rev2 — Review of bbbbbbb.\n\nRESULT #7: 2 findings (P2).", {
        submittedAt: "2026-01-01T11:30:00Z",
        commit: { oid: OLDER },
      }),
    ],
  },
  comments: {
    nodes: [
      // The author's reply mentions rev2 but is not rev2's result.
      post(
        "rev2 findings, fixed in ccccccc. ![after](https://example.com/b.png)",
        {
          createdAt: "2026-01-01T12:01:00Z",
        },
      ),
      post(
        "rev2 — Fix confirmation at ccccccc.\n\nRESULT #7: 2/2 resolved, 0 new.",
        {
          createdAt: "2026-01-01T12:20:00Z",
        },
      ),
      post(
        "**rev4**: confirmation at aaaaaaa.\n\nRESULT #7: no new findings.",
        {
          createdAt: "2026-01-01T12:30:00Z",
        },
      ),
      // Someone without standing in the repository can't confirm anything.
      post("rev9 — RESULT #7: 9/9 resolved.", {
        authorAssociation: "NONE",
        author: { login: "passer-by" },
        createdAt: "2026-01-01T12:40:00Z",
        body: "rev9 — RESULT #7: 9/9 resolved. <img src=x>",
      }),
    ],
  },
  ...fields,
});

describe("pull request detail", () => {
  test("formal RESULT-only reviews keep GitHub IDs, source links and commit metadata", () => {
    const detail = parseDetail(
      item(7),
      detailNode({
        reviews: {
          nodes: [
            post("RESULT #7: 0/0 resolved, 0 new", {
              id: "formal-review-1",
              submittedAt: "2026-01-01T12:30:00Z",
              commit: { oid: HEAD },
              url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-1",
            }),
          ],
        },
        comments: { nodes: [] },
      }),
    );
    expect(detail.reviewers).toMatchObject([
      {
        reviewer: null,
        sourceId: "formal-review-1",
        outcome: "unknown",
        commit: HEAD,
        commitsSince: 0,
        url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-1",
      },
    ]);
    expect(detailQuery([item(7)])).toContain("nodes { id author");
  });

  test("reads checks, reviewer results, files and images from GitHub's answer", () => {
    const detail = parseDetail(item(7), detailNode());
    expect(detail.behindBy).toBe(4);
    expect(detail.checks).toEqual([
      {
        name: "Unit tests",
        state: "pass",
        required: true,
        url: "https://example.com/run/1",
        completedAt: Date.parse("2026-01-01T12:10:00Z"),
      },
      { name: "Browser suite", state: "pending", required: false },
      // Only https links are kept.
      {
        name: "external/lint",
        state: "fail",
        required: false,
        completedAt: Date.parse("2026-01-01T12:05:00Z"),
      },
    ]);
    expect(detail.checksTruncated).toBe(false);
    expect(detail.uiChange).toBe(true);
    // The description's image and the author's own reply; not the passer-by's.
    expect(detail.images).toBe(2);
    expect(
      detail.reviewers.map((entry) => [
        entry.reviewer,
        entry.outcome,
        entry.commit,
        entry.commitsSince,
      ]),
    ).toEqual([
      // rev2's latest result wins over its first review; it names its head.
      ["rev2", "confirmed", HEAD, 0],
      // rev4 names the commit it confirmed: two commits ago.
      ["rev4", "confirmed", OLDEST, 2],
    ]);
  });

  test("a change outside the files World read is unknown, not a non-UI change", () => {
    const many = detailNode({
      files: { totalCount: 300, nodes: [{ path: "server/src/x.ts" }] },
    });
    expect(parseDetail(item(7), many).uiChange).toBeNull();
    const backend = detailNode({
      files: { totalCount: 1, nodes: [{ path: "server/src/x.ts" }] },
    });
    expect(parseDetail(item(7), backend).uiChange).toBe(false);
  });

  test("a UI change is the web app or site, not its tests", () => {
    expect(uiPath("web/src/world/Card.tsx")).toBe(true);
    expect(uiPath("site/index.html")).toBe(true);
    expect(uiPath("web/src/world/Card.test.ts")).toBe(false);
    expect(uiPath("web/src/world/Card.browser.tsx")).toBe(false);
    expect(uiPath("docs/TUTORIAL.md")).toBe(false);
    expect(countImages("![a](https://x.example/a.png) <img src=b> <IMG>")).toBe(
      3,
    );
    expect(countImages("[link](https://x.example)")).toBe(0);
  });

  test("reads a reviewer's own post, not a reply that mentions it", () => {
    expect(reviewerOf("rev2 — Review of abc")).toBe("rev2");
    expect(reviewerOf("**rev4**: confirmation")).toBe("rev4");
    expect(reviewerOf("[rev4 -> sources] RESULT #1: …")).toBe("rev4");
    expect(reviewerOf("rev2 findings, fixed in abc")).toBeNull();
    expect(reviewerOf("Re rev2 review 12")).toBeNull();
  });

  test("results in a reviewer's own words: anything open wins", () => {
    const cases: [string, string][] = [
      ["2/2 resolved, 0 new.", "confirmed"],
      ["3/3 outstanding findings resolved, 0 new.", "confirmed"],
      ["merge resolution confirmed, 0 new findings.", "confirmed"],
      ["no new findings; both fixes hold.", "confirmed"],
      ["review posted, 0 findings", "confirmed"],
      ["2/3 resolved, 1 remaining, 1 new.", "open"],
      ["2 fixes confirmed; 1 original P2 remains, plus 1 new P2.", "open"],
      ["review posted, 3 findings (2 P2, 1 P3)", "open"],
      ["2/2 resolved, 1 P2 open", "open"],
      ["2/2 resolved, 3 findings (P2)", "open"],
      ["not confirmed, 0 new findings", "open"],
      ["one P2 remains", "open"],
      ["2/2 resolved; one finding (P2)", "open"],
      ["2/2 resolved; 0/1 resolved, 0 new", "open"],
      ["2/2 resolved, plus a new P2", "open"],
      ["2/2 resolved and another new P3 in the retry path", "open"],
      ["merge resolution confirmed, 0 new P1–P3 findings.", "confirmed"],
      ["All four findings confirmed; 0 new.", "confirmed"],
      ["both remaining P2s confirmed fixed; no new findings.", "confirmed"],
      ["looks fine to me", "unknown"],
    ];
    for (const [line, outcome] of cases)
      expect([line, resultOutcome(line)]).toEqual([line, outcome]);
  });

  test("a reviewer post without a RESULT line is a result World can't read", () => {
    const detail = parseDetail(
      item(7),
      detailNode({
        reviews: { nodes: [] },
        comments: {
          nodes: [
            post("rev3 — synthetic-private-canary, all fixed.", {
              createdAt: "2026-01-01T12:30:00Z",
            }),
          ],
        },
      }),
    );
    expect(detail.reviewers).toMatchObject([
      { reviewer: "rev3", outcome: "unknown", line: "" },
    ]);
    // Nothing of a post without a RESULT line leaves the service.
    expect(JSON.stringify(detail)).not.toContain("canary");
  });

  test("a commit's date is no proof of the head a result was given on", () => {
    // OLDER was made at 11:00 but pushed after a SHA-less confirmation at
    // 11:30 that reviewed OLDEST; the confirmation must not count for it.
    const detail = parseDetail(
      item(7, { headSha: OLDER }),
      detailNode({
        headRefOid: OLDER,
        commits: {
          nodes: [
            { commit: { oid: OLDEST, committedDate: "2026-01-01T10:00:00Z" } },
            { commit: { oid: OLDER, committedDate: "2026-01-01T11:00:00Z" } },
          ],
        },
        reviews: { nodes: [] },
        comments: {
          nodes: [
            post(
              "rev2 — Fix confirmation.\n\nRESULT #7: 2/2 resolved, 0 new.",
              {
                createdAt: "2026-01-01T11:30:00Z",
              },
            ),
          ],
        },
      }),
    );
    expect(detail.reviewers).toMatchObject([
      {
        reviewer: "rev2",
        outcome: "confirmed",
        commit: null,
        commitsSince: null,
      },
    ]);
  });

  test("the whole RESULT line decides; only the text shown is shortened", () => {
    const line = `2/2 resolved; ${"the fix holds under every case tried. ".repeat(8)}1 new P2 in the retry path.`;
    expect(line.length).toBeGreaterThan(250);
    const detail = parseDetail(
      item(7),
      detailNode({
        reviews: { nodes: [] },
        comments: {
          nodes: [
            post(`rev2 — Fix confirmation at ccccccc.\n\nRESULT #7: ${line}`, {
              createdAt: "2026-01-01T12:30:00Z",
            }),
          ],
        },
      }),
    );
    expect(detail.reviewers[0]!.outcome).toBe("open");
    expect([...detail.reviewers[0]!.line].length).toBeLessThanOrEqual(200);
  });

  test("reads changed, unread, running or old pull requests first, a bounded few", () => {
    const now = 10 * DETAIL_MAX_AGE_MS;
    const cached = (entry: WorkItem, readAt = now): [string, CachedDetail] => [
      entry.key,
      {
        stamp: detailStamp(entry),
        readAt,
        detail: parseDetail(entry, detailNode()),
      },
    ];
    const same = item(1);
    const changed = item(2);
    const running = item(3, { checks: "pending" });
    const old = item(4);
    const fresh = item(5);
    const cache = new Map([
      cached(same),
      cached({ ...changed, updatedAt: 1 }),
      cached(running),
      cached(old, now - DETAIL_MAX_AGE_MS),
    ]);
    expect(
      detailsDue([same, changed, running, old, fresh], cache, now).map(
        (entry) => entry.number,
      ),
    ).toEqual([5, 2, 4, 3]);
    const many = Array.from({ length: 30 }, (_, index) => item(100 + index));
    expect(detailsDue(many, new Map(), now)).toHaveLength(DETAIL_PER_REFRESH);
  });

  test("asks for each pull request by repository and number, comparing with its base", () => {
    const query = detailQuery([item(7), item(8, { base: "release" })]);
    expect(query).toContain(
      'p0: repository(owner: "example-org", name: "widgets")',
    );
    expect(query).toContain("pullRequest(number: 7)");
    expect(query).toContain('compare(headRef: "release")');
    expect(query).toContain("isRequired(pullRequestNumber: 8)");
  });
});

describe("GitHub refresh with detail", () => {
  const listNode = (number: number, fields: Record<string, unknown> = {}) => ({
    number,
    title: `Synthetic ${number}`,
    url: `https://github.com/example-org/widgets/pull/${number}`,
    isDraft: false,
    state: "OPEN",
    updatedAt: "2026-01-01T12:00:00Z",
    headRefName: `agent/change-${number}`,
    headRefOid: HEAD,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    repository: { nameWithOwner: "example-org/widgets" },
    headRepository: { nameWithOwner: "example-org/widgets" },
    commits: {
      nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }],
    },
    ...fields,
  });

  function fakeGitHub(failDetail = false) {
    const queries: string[] = [];
    const run: RunProcess = async (argv) => {
      if (argv[1] === "auth") return { code: 0, stdout: "", stderr: "" };
      const query = argv.at(-1)!.slice("query=".length);
      queries.push(query);
      if (query.includes("pullRequest(number:")) {
        if (failDetail) return { code: 1, stdout: "", stderr: "boom" };
        return {
          code: 0,
          stdout: JSON.stringify({
            data: { p0: { pullRequest: detailNode() } },
          }),
          stderr: "",
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            authored: { nodes: [listNode(7)] },
            // Someone else's pull request is not read in detail.
            reviewing: { nodes: [listNode(8)] },
            assigned: { nodes: [] },
            merged: { nodes: [], pageInfo: { hasNextPage: false } },
            issues: { nodes: [] },
          },
        }),
        stderr: "",
      };
    };
    return { run, queries };
  }

  test("reads your open pull requests in detail once, then only when they change", async () => {
    const { run, queries } = fakeGitHub();
    const cache = new Map<string, CachedDetail>();
    const first = await refreshGitHub(run, 1_000, 7, Date.now, cache);
    if (!first.ok) throw new Error("refresh failed");
    const own = first.items.find((entry) => entry.number === 7)!;
    expect(own).toMatchObject({ headSha: HEAD, base: "main" });
    expect(own.pr?.reviewers.map((entry) => entry.reviewer)).toEqual([
      "rev2",
      "rev4",
    ]);
    expect(first.items.find((entry) => entry.number === 8)!.pr).toBeUndefined();
    expect(queries).toHaveLength(2);
    // Comment text stays in the service.
    expect(JSON.stringify(first.items)).not.toContain("Fix confirmation");
    const second = await refreshGitHub(run, 2_000, 7, Date.now, cache);
    expect(queries).toHaveLength(3);
    expect(second.ok && second.items[0]!.pr).toBeTruthy();
  });

  test("a failed detail read keeps the list and leaves the rules unknown", async () => {
    const { run } = fakeGitHub(true);
    const result = await refreshGitHub(run, 1_000, 7, Date.now, new Map());
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.items.find((entry) => entry.number === 7)!.pr,
      ).toBeUndefined();
  });
});
