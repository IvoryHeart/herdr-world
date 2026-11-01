import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { openFindings, withReplies } from "./crew/review-facts";
import {
  actionsIn,
  addAction,
  addRun,
  finishRun,
  getAction,
  setAction,
} from "./crew/store";
import { input, NOW, SHA } from "./gate/cases";

afterEach(cleanupDeliveries);

const settings = {
  readyAsk: false,
  prs: [7, 8],
  reviewStarts: { "7": { head: SHA.reviewed, at: NOW - 100 } },
  reviewJudgmentSeat: "steward",
};

test.each([
  "[P2] src/second.ts:20 second defect",
  "The second defect has no parseable priority or location",
])("mixed real and unparsed finding text stays open: %s", (second) => {
  const value = input({
    head: SHA.reviewed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 2 new" },
    ],
  });
  const findings = openFindings(value, [
    {
      id: "201",
      at: NOW,
      url: "https://example.invalid/review/201",
      body: `Reviewer: rev2\nRESULT #7: 0/0 resolved, 2 new\nP2 src/first.ts:10 first defect\n${second}\nHistorical summary: the old P2 and P3 remain resolved.`,
    },
  ]);
  expect(findings).toHaveLength(2);
  if (second.startsWith("[P2]"))
    expect(findings[1]!.file).toBe("src/second.ts");
  else expect(findings[1]!.file).toBeNull();
  const replied = withReplies(
    findings,
    [
      {
        id: "reply",
        at: NOW + 1,
        url: "https://example.invalid/comment/1",
        body: "[builder] src/first.ts:10 fixed in synthetic commit",
      },
    ],
    "builder",
    7,
  );
  expect(replied.filter((finding) => !finding.reply)).toHaveLength(1);
});

test.each(["pending", "sent", "failed"] as const)(
  "a PR-scoped pass preserves another PR's %s coordinator receipt",
  (state) => {
    const f = setup({ seedCycle: false, settings, scope: [7] });
    const action = {
      key: `8:${SHA.reviewed}:judgment:steward:attribution`,
      pr: 8,
      head: SHA.reviewed,
      kind: "judgment" as const,
      target: "steward",
      text: "NEEDS-REVIEW #8: attribution held",
    };
    addAction(f.crew, action, NOW - 200);
    setAction(f.crew, action.key, state, NOW - 100, "existing receipt", true);
    const before = getAction(f.crew, action.key);
    f.passInput(input({ head: SHA.reviewed, posts: [] }));
    expect(getAction(f.crew, action.key)).toEqual(before);
  },
);

test.each(["action", "run", "both"])(
  "legacy admitted %s state without cycle rows holds reconciliation",
  (kind) => {
    const f = setup({ seedCycle: false, settings });
    const action = {
      key: `7:${SHA.reviewed}:review:rev2`,
      pr: 7,
      head: SHA.reviewed,
      kind: "review" as const,
      target: "rev2",
      text: "Review #7",
    };
    if (kind !== "run") {
      addAction(f.crew, action, NOW - 1_000_000);
      setAction(f.crew, action.key, "done", NOW - 500_000);
    }
    if (kind !== "action") {
      const id = addRun(
        f.crew,
        {
          actionKey: action.key,
          pr: 7,
          reviewer: "rev2",
          head: SHA.reviewed,
          log: "synthetic.log",
          round: 1,
        },
        NOW - 1_000_000,
      );
      finishRun(f.crew, id, 0, null, NOW - 500_000);
    }
    const before = f.crew.query("SELECT * FROM round ORDER BY round").all();
    f.passInput(input({ head: SHA.reviewed, posts: [] }));
    expect(f.crew.query("SELECT * FROM round ORDER BY round").all()).toEqual(
      before,
    );
    expect(f.spawned).toEqual([]);
    expect(
      actionsIn(f.crew, ["pending", "sent"]).some(
        (entry) => entry.kind === "judgment" && entry.target === "steward",
      ),
    ).toBe(true);
  },
);
