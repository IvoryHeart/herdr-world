import { describe, expect, test } from "bun:test";
import {
  mergeCommand,
  mergeUnavailable,
  pullRequestAttention,
  pullRequestReadiness,
  readyToMerge,
  STALLED_SETTLE_MS,
  verbConsequence,
  type PullRequestDetail,
  type PullRequestReviewer,
} from "./pullRequests";
import type { WorkItem } from "./worldSources";

const HEAD = "c".repeat(40);

const reviewer = (
  fields: Partial<PullRequestReviewer> = {},
): PullRequestReviewer => ({
  reviewer: "rev2",
  url: "https://github.com/example-org/widgets/pull/7#issuecomment-1",
  at: 1,
  outcome: "confirmed",
  line: "2/2 resolved, 0 new.",
  commit: HEAD,
  commitsSince: 0,
  ...fields,
});

const detail = (
  fields: Partial<PullRequestDetail> = {},
): PullRequestDetail => ({
  baseRef: "main",
  behindBy: 3,
  checks: [{ name: "Unit tests", state: "pass", required: true }],
  checksTruncated: false,
  reviewers: [reviewer()],
  uiChange: true,
  images: 5,
  ...fields,
});

const item = (fields: Partial<WorkItem> = {}): WorkItem => ({
  key: "github:pr:example-org/widgets#7",
  source: "github",
  kind: "pull_request",
  ref: "example-org/widgets#7",
  title: "Synthetic change",
  url: "https://github.com/example-org/widgets/pull/7",
  lane: "green",
  status: "open",
  roles: ["author"],
  updatedAt: 1,
  number: 7,
  repo: "example-org/widgets",
  headSha: HEAD,
  draft: false,
  checks: "pass",
  review: "review_required",
  mergeable: "mergeable",
  pr: detail(),
  prObservation: {
    source: "github",
    state: "fresh",
    headSha: HEAD,
    readAt: 1,
    expiresAt: 600_001,
  },
  ...fields,
});

const states = (entry: WorkItem) =>
  Object.fromEntries(
    pullRequestReadiness(entry).map((rule) => [rule.id, rule.state]),
  );

describe("pull request readiness", () => {
  test("unattributed evidence cannot clear findings or hide behind named confirmations", () => {
    const unknown = reviewer({
      reviewer: null,
      outcome: "unknown",
      sourceId: "review-1",
    });
    const entry = item({ pr: detail({ reviewers: [reviewer(), unknown] }) });
    const findings = pullRequestReadiness(entry).find(
      (rule) => rule.id === "findings",
    )!;
    expect(findings.state).toBe("unknown");
    expect(findings.detail).toContain("attribution unknown");
    expect(readyToMerge(entry)).toBe(false);
    // Even malformed/legacy evidence with no identity cannot assert clear.
    expect(
      states(
        item({
          pr: detail({ reviewers: [{ ...unknown, outcome: "confirmed" }] }),
        }),
      ),
    ).toMatchObject({ findings: "unknown" });
    // A known open finding still wins over the unknown attribution.
    expect(
      states(
        item({
          pr: detail({
            reviewers: [
              unknown,
              reviewer({ outcome: "open", line: "1 P2 open" }),
            ],
          }),
        }),
      ),
    ).toMatchObject({ findings: "fail" });
  });

  test("ready when every one of the owner's rules holds", () => {
    expect(states(item())).toEqual({
      draft: "pass",
      findings: "pass",
      checks: "pass",
      mergeable: "pass",
      screenshots: "pass",
    });
    expect(readyToMerge(item())).toBe(true);
    expect(
      pullRequestReadiness(item()).find((rule) => rule.id === "screenshots")!
        .detail,
    ).toBe("5 images");
  });

  test("each failing rule says why", () => {
    const failing = item({
      draft: true,
      checks: "fail",
      mergeable: "conflicting",
      pr: detail({
        checks: [{ name: "Browser suite", state: "fail", required: false }],
        reviewers: [
          reviewer({ outcome: "open", line: "1/2 resolved, 1 remaining" }),
        ],
        images: 0,
      }),
    });
    expect(
      pullRequestReadiness(failing).map((rule) => [
        rule.id,
        rule.state,
        rule.detail,
      ]),
    ).toEqual([
      ["draft", "fail", "Still a draft"],
      ["findings", "fail", "rev2: 1/2 resolved, 1 remaining"],
      ["checks", "fail", "1 failing: Browser suite"],
      ["mergeable", "fail", "Conflicts with main"],
      ["screenshots", "fail", "UI change without screenshots"],
    ]);
    expect(readyToMerge(failing)).toBe(false);
  });

  test("what World can't tell is unknown, never a guess", () => {
    expect(states(item({ pr: undefined }))).toMatchObject({
      findings: "unknown",
      screenshots: "unknown",
    });
    expect(
      states(
        item({
          checks: "pending",
          mergeable: "unknown",
          pr: detail({ reviewers: [], uiChange: null }),
        }),
      ),
    ).toMatchObject({
      findings: "unknown",
      checks: "unknown",
      mergeable: "unknown",
      screenshots: "unknown",
    });
    expect(
      states(
        item({ pr: detail({ reviewers: [reviewer({ outcome: "unknown" })] }) }),
      ),
    ).toMatchObject({ findings: "unknown" });
    expect(
      states(item({ pr: detail({ uiChange: false, images: 0 }) })),
    ).toMatchObject({
      screenshots: "pass",
    });
  });

  test("a confirmation of an older head is not a confirmation of this one", () => {
    const stale = item({
      pr: detail({
        reviewers: [
          reviewer({ reviewer: "rev2" }),
          reviewer({
            reviewer: "rev4",
            commit: "a".repeat(40),
            commitsSince: 2,
          }),
        ],
      }),
    });
    const rule = pullRequestReadiness(stale).find(
      (entry) => entry.id === "findings",
    )!;
    expect([rule.state, rule.detail]).toEqual([
      "unknown",
      "rev4 confirmed at aaaaaaa · 2 commits since",
    ]);
  });
});

describe("pull request verbs offered", () => {
  test("no Merge while GitHub requires a review: Open on GitHub and the plain command instead", () => {
    expect(mergeUnavailable(item())).toBe(
      "GitHub requires a review; merge on GitHub.",
    );
    expect(mergeCommand(item())).toBe(
      "gh pr merge 7 --repo example-org/widgets --merge",
    );
    expect(mergeCommand(item())).not.toContain("--admin");
    expect(mergeUnavailable(item({ review: "approved" }))).toBeNull();
    expect(mergeUnavailable(item({ review: "none" }))).toBeNull();
    expect(mergeUnavailable(item({ roles: ["reviewer"] }))).not.toBeNull();
  });

  test("each sheet says exactly what happens", () => {
    expect(verbConsequence(item({ review: "approved" }), "merge")).toBe(
      "Merge #7 into main with a merge commit. Head ccccccc must still be the head. The branch is kept.",
    );
    expect(verbConsequence(item(), "close")).toBe(
      "Close #7 without merging. The branch is kept.",
    );
    expect(verbConsequence(item(), "ready")).toBe("Mark #7 ready for review.");
  });
});

describe("pull request attention", () => {
  const time = (at: number) => `t${at}`;
  const failed = item({
    checks: "fail",
    pr: detail({
      checks: [
        { name: "Unit tests", state: "fail", required: true, completedAt: 500 },
        { name: "Lint", state: "fail", required: false, completedAt: 400 },
      ],
    }),
  });
  const idle = [{ label: "teams", idle: true }];

  test("ready to merge when every rule holds", () => {
    expect(pullRequestAttention(item(), [], 0, null, time)).toEqual({
      reason: "ready",
      label: "Ready to merge",
    });
  });

  test("stalled when CI failed on the head and its agent is idle, once it has held a moment", () => {
    const at = 10_000;
    expect(pullRequestAttention(failed, idle, at, at, time)).toBeNull();
    expect(
      pullRequestAttention(failed, idle, at + STALLED_SETTLE_MS, at, time),
    ).toEqual({
      reason: "stalled",
      since: 400,
      label: "CI red since t400 · teams idle",
    });
    // A working agent, no agent at all, or a passing head: not stalled.
    for (const [entry, authors] of [
      [failed, [{ label: "teams", idle: false }]],
      [failed, []],
      [item({ review: "approved", mergeable: "unknown" }), idle],
    ] as const)
      expect(
        pullRequestAttention(
          entry,
          [...authors],
          at + STALLED_SETTLE_MS,
          at,
          time,
        ),
      ).toBeNull();
  });
});
