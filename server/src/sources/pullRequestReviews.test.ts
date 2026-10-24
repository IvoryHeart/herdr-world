import { describe, expect, test } from "bun:test";
import {
  resultOutcome,
  reviewerOf,
  reviewerResults,
} from "./pullRequestDetail";

const HEAD = "c".repeat(40);
const OLD = "b".repeat(40);
const commits = [
  { oid: OLD, at: 1 },
  { oid: HEAD, at: 2 },
];
const source = (id: number) =>
  `https://github.com/example-org/widgets/pull/7#issuecomment-${id}`;
const post = (body: string, id = 1, fields = {}) => ({
  id: `post-${id}`,
  url: source(id),
  author: { login: "shared-owner" },
  body,
  at: id,
  ...fields,
});
const result = "RESULT #7: 0/0 resolved, 0 new";

describe("explicit reviewer evidence", () => {
  test("bold canonical metadata still explicitly claims the sender", () => {
    expect(reviewerOf("**Reviewer:** **rev2**")).toBe("rev2");
  });

  test("canonical formal review claims its reviewer and uses GitHub's commit", () => {
    expect(
      reviewerResults(
        7,
        [post(`Reviewer: rev2\n${result}`, 1, { commit: HEAD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([
      { reviewer: "rev2", outcome: "confirmed", commit: HEAD, commitsSince: 0 },
    ]);
  });

  test.each([
    "rev1 combined confirmation at",
    "rev1 refreshed confirmation at",
    "**rev1** — Review of",
    "rev1 (gpt-example) — confirmation at",
    "[rev1 -> sources] confirmation at",
  ])("explicit current header %s names the comment's head", (header) => {
    expect(
      reviewerResults(
        7,
        [post(`${header} ${HEAD}\n\n${result}`)],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ reviewer: "rev1", outcome: "confirmed", commit: HEAD }]);
  });

  test("shared-login RESULT-only formal reviews survive separately as unknown", () => {
    const entries = reviewerResults(
      7,
      [post(result, 1, { commit: OLD }), post(result, 2, { commit: HEAD })],
      commits,
      HEAD,
    );
    expect(entries).toMatchObject([
      {
        reviewer: null,
        sourceId: "post-1",
        outcome: "unknown",
        commit: OLD,
        url: source(1),
      },
      {
        reviewer: null,
        sourceId: "post-2",
        outcome: "unknown",
        commit: HEAD,
        url: source(2),
      },
    ]);
    expect(entries.every((entry) => entry.line === "0/0 resolved, 0 new")).toBe(
      true,
    );
  });

  test("unknown URL fallback is stable and a later named post does not own it", () => {
    const unknown = post(result, 1, { id: undefined, commit: HEAD });
    const named = post(`Reviewer: rev2\n${result}`, 2, { commit: HEAD });
    const entries = reviewerResults(7, [unknown, named], commits, HEAD);
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.reviewer === null)).toMatchObject({
      sourceId: source(1),
      url: source(1),
      outcome: "unknown",
    });
    // An explicit correction on the same source post can identify it.
    expect(
      reviewerResults(
        7,
        [{ ...unknown, body: `Reviewer: rev2\n${result}` }],
        commits,
        HEAD,
      ),
    ).toMatchObject([
      { reviewer: "rev2", outcome: "confirmed", sourceId: source(1) },
    ]);
  });

  test("latest named result wins, but cannot discard another unknown source", () => {
    const entries = reviewerResults(
      7,
      [
        post(`rev2 — Review of ${OLD}\nRESULT #7: 1 P2 open`, 1),
        post(result, 2, { commit: HEAD }),
        post(`Reviewer: rev2\nReviewed commit: ${HEAD}\n${result}`, 3),
      ],
      commits,
      HEAD,
    );
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.reviewer === "rev2")).toMatchObject({
      outcome: "confirmed",
      commit: HEAD,
    });
    expect(entries.find((entry) => entry.reviewer === null)).toMatchObject({
      outcome: "unknown",
      url: source(2),
    });
  });

  test("conflicting unquoted sender claims stay unknown", () => {
    for (const body of [
      `Reviewer: rev2\nReviewer: rev5\n${result}`,
      `rev2 — Review\nReviewer: rev5\n${result}`,
    ]) {
      expect(reviewerOf(body)).toBeNull();
      expect(
        reviewerResults(7, [post(body, 1, { commit: HEAD })], commits, HEAD),
      ).toMatchObject([{ reviewer: null, outcome: "unknown", url: source(1) }]);
    }
  });

  test("quoted sender claims and RESULT examples cannot become a review", () => {
    for (const body of [
      `Author reply: fixed rev2's findings.\n> Reviewer: rev2\n> ${result}`,
      `Author reply\n\`\`\`text\nReviewer: rev2\n${result}\n\`\`\``,
      `rev2 findings fixed in ${HEAD}; ${result}`,
    ])
      expect(reviewerResults(7, [post(body)], commits, HEAD)).toEqual([]);
    expect(reviewerOf(`Reviewer: rev2\n> Reviewer: rev5\n${result}`)).toBe(
      "rev2",
    );
    expect(
      reviewerResults(
        7,
        [post(`rev2 findings fixed.\n${result}`, 1, { commit: HEAD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ reviewer: null, outcome: "unknown" }]);
  });

  test("a shared login named rev2 cannot supply a missing sender claim", () => {
    expect(
      reviewerResults(
        7,
        [post(result, 1, { author: { login: "rev2" }, commit: HEAD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ reviewer: null, outcome: "unknown" }]);
  });

  test("legacy inline sender results stay readable, but conflicting verdicts cannot clear", () => {
    expect(
      reviewerResults(
        7,
        [post(`rev2 — ${result}`, 1, { commit: HEAD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ reviewer: "rev2", outcome: "confirmed" }]);
    expect(
      reviewerResults(
        7,
        [
          post(`Reviewer: rev2\n${result}\nRESULT #7: 1 P2 open`, 1, {
            commit: HEAD,
          }),
        ],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ reviewer: "rev2", outcome: "open" }]);
    expect(
      reviewerResults(
        7,
        [post("RESULT #7:", 1, { commit: HEAD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([
      { reviewer: null, outcome: "unknown", sourceId: "post-1" },
    ]);
  });

  test("foreign RESULT numbers do not supersede this PR's named evidence", () => {
    const entries = reviewerResults(
      7,
      [
        post(`Reviewer: rev2\n${result}`, 1, { commit: HEAD }),
        post("Reviewer: rev2\nRESULT #70: 1 P2 open", 2, { commit: HEAD }),
      ],
      commits,
      HEAD,
    );
    expect(entries).toMatchObject([
      { reviewer: "rev2", outcome: "confirmed", url: source(1) },
    ]);
  });
});

describe("reviewed head binding", () => {
  test.each([undefined, HEAD])(
    "historical evidence prose cannot contradict explicit reviewed head (%s)",
    (metadata) => {
      const body = `Reviewer: rev2\nReviewed commit: ${HEAD}\n${result}\n\nHistorical RED at ${OLD}; comparison of ${OLD}.\nPreviously reviewed head ${OLD} failed before this repair.`;
      expect(
        reviewerResults(
          7,
          [post(body, 1, { commit: metadata })],
          commits,
          HEAD,
        ),
      ).toMatchObject([
        {
          reviewer: "rev2",
          commit: HEAD,
          outcome: "confirmed",
          commitsSince: 0,
        },
      ]);
    },
  );

  test("historical prose alone cannot bind a RESULT to a reviewed head", () => {
    expect(
      reviewerResults(
        7,
        [post(`Reviewer: rev2\n${result}\nHistorical RED at ${HEAD}`)],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ commit: null, commitsSince: null }]);
  });

  test("different explicit reviewed headers still conflict even with matching metadata", () => {
    const body = `Reviewer: rev2\nReviewed commit: ${HEAD}\nReviewed head: ${OLD}\n${result}`;
    expect(
      reviewerResults(7, [post(body, 1, { commit: HEAD })], commits, HEAD),
    ).toMatchObject([{ commit: null, outcome: "unknown" }]);
  });

  test("metadata keeps a stale review stale regardless of its timestamp", () => {
    expect(
      reviewerResults(
        7,
        [post(`Reviewer: rev2\n${result}`, 1000, { commit: OLD })],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ commit: OLD, commitsSince: 1 }]);
    expect(
      reviewerResults(
        7,
        [post(`Reviewer: rev2\n${result}`, 1000)],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ commit: null, commitsSince: null }]);
  });

  test("an explicit full stale SHA is preserved even outside the commit window", () => {
    const outside = "a".repeat(40);
    expect(
      reviewerResults(
        7,
        [post(`Reviewer: rev2\nReviewed commit: ${outside}\n${result}`)],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ commit: outside, commitsSince: null }]);
  });

  test("ambiguous prefixes and conflicting textual or metadata claims do not bind", () => {
    const collision = "c".repeat(39) + "d";
    const all = [...commits, { oid: collision, at: 3 }];
    for (const body of [
      `Reviewer: rev2\nReviewed commit: ccccccc\n${result}`,
      `Reviewer: rev2\nReview of ${OLD}; confirmation at ${HEAD}\n${result}`,
    ])
      expect(reviewerResults(7, [post(body)], all, HEAD)).toMatchObject([
        { commit: null, outcome: "unknown" },
      ]);
    expect(
      reviewerResults(
        7,
        [
          post(`Reviewer: rev2\nReviewed commit: ${OLD}\n${result}`, 1, {
            commit: HEAD,
          }),
        ],
        commits,
        HEAD,
      ),
    ).toMatchObject([{ commit: null, outcome: "unknown" }]);
  });
});

describe("RESULT uncertainty and open findings", () => {
  test.each([
    ["0/0 resolved, 2 P2 findings", "open"],
    ["0/0 resolved, 1 P1 finding", "open"],
    ["0/0 resolved, 0 new; review pending", "unknown"],
    ["0/0 resolved, needs another look", "unknown"],
    ["0/0 resolved, 0 new; cannot verify", "unknown"],
    ["0/0 resolved, 0 new, unread remainder", "unknown"],
    ["0/0 resolved, 0 new. Checked the published composition.", "confirmed"],
    ["1/2 resolved, review pending", "open"],
    ["0/0 resolved, no new findings; 2 P2 open", "open"],
  ] as const)("%s is %s", (line, expected) =>
    expect(resultOutcome(line)).toBe(expected),
  );
});
