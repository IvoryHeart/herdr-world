import { describe, expect, test } from "bun:test";
import { STALLED_SETTLE_MS } from "../../../shared/pullRequests";
import type { WorkItem } from "../../../shared/worldSources";
import { pullRequestAttentionAt } from "./pullRequestAttention";
import { parseWorldSources } from "./worldSources";

const HEAD = "c".repeat(40);

const failing: WorkItem = {
  key: "github:pr:example-org/widgets#7",
  source: "github",
  kind: "pull_request",
  ref: "example-org/widgets#7",
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  lane: "fixing",
  status: "open",
  roles: ["author"],
  updatedAt: 1,
  number: 7,
  repo: "example-org/widgets",
  headSha: HEAD,
  checks: "fail",
  review: "review_required",
  mergeable: "mergeable",
  pr: {
    baseRef: "main",
    behindBy: 0,
    checks: [
      { name: "Unit tests", state: "fail", required: true, completedAt: 100 },
    ],
    checksTruncated: false,
    reviewers: [],
    uiChange: false,
    images: 0,
  },
};

describe("pull request attention in the browser", () => {
  test("decoding retains source-keyed unknowns across the bounded GitHub evidence window", () => {
    const reviewers = Array.from({ length: 50 }, (_, id) => ({
      reviewer: null,
      sourceId: `review-${id}`,
      url: `https://github.com/example-org/widgets/pull/7#pullrequestreview-${id}`,
      at: id,
      outcome: "confirmed",
      line: "0/0 resolved, 0 new",
      commit: HEAD,
      commitsSince: 0,
    }));
    const [decoded] = parseWorldSources({
      items: [{ ...failing, pr: { ...failing.pr, reviewers } }],
    }).items;
    expect(decoded!.pr!.reviewers).toHaveLength(50);
    expect(decoded!.pr!.reviewers[49]).toMatchObject({
      reviewer: null,
      sourceId: "review-49",
      outcome: "unknown",
      url: reviewers[49]!.url,
    });
  });

  test("stalled only once it has held for a moment, and forgotten when it clears", () => {
    const seen = new Map<string, number>();
    const idle = [{ item: failing, authors: [{ label: "teams", idle: true }] }];
    expect(pullRequestAttentionAt(idle, 1_000, seen).size).toBe(0);
    // The agent starts working again before it settles: it starts over.
    const working = [
      { item: failing, authors: [{ label: "teams", idle: false }] },
    ];
    expect(pullRequestAttentionAt(working, 2_000, seen).size).toBe(0);
    expect(seen.size).toBe(0);
    pullRequestAttentionAt(idle, 3_000, seen);
    expect(
      pullRequestAttentionAt(idle, 3_000 + STALLED_SETTLE_MS, seen).get(
        failing.key,
      ),
    ).toMatchObject({ reason: "stalled", since: 100 });
  });

  test("decoding keeps a pull request's detail and drops what is malformed", () => {
    const decoded = parseWorldSources({
      items: [
        {
          ...failing,
          headSha: "not-a-sha",
          pr: {
            ...failing.pr,
            checks: [
              ...failing.pr!.checks,
              { name: "Lint", state: "exploded" },
              { name: "Docs", state: "pass", url: "javascript:alert(1)" },
            ],
            reviewers: [
              {
                reviewer: "rev2",
                outcome: "confirmed",
                line: "2/2 resolved",
                commit: HEAD,
                commitsSince: 0,
                url: "https://github.com/example-org/widgets/pull/7#c",
              },
              { reviewer: "rev3", outcome: "great" },
            ],
          },
        },
      ],
      actions: [
        {
          verb: "merge",
          itemKey: failing.key,
          ref: failing.ref,
          at: 5,
          outcome: "failed",
          detail: "Pull request is not mergeable",
          sender: { basis: "inferred", via: "agent" },
        },
        { verb: "approve", itemKey: failing.key, outcome: "done" },
      ],
    });
    const [item] = decoded.items;
    expect(item!.headSha).toBeUndefined();
    expect(item!.pr!.checks.map((check) => [check.name, check.url])).toEqual([
      ["Unit tests", undefined],
      ["Docs", undefined],
    ]);
    expect(item!.pr!.reviewers.map((entry) => entry.reviewer)).toEqual([
      "rev2",
    ]);
    // Who asked is always this viewer's browser session.
    expect(decoded.actions).toEqual([
      {
        verb: "merge",
        itemKey: failing.key,
        ref: failing.ref,
        at: 5,
        outcome: "failed",
        detail: "Pull request is not mergeable",
        sender: { basis: "reported", via: "browser" },
      },
    ]);
  });
});
