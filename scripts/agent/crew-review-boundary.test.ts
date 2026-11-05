import { afterEach, expect, test } from "bun:test";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import { actionsIn } from "./crew/store";
import { openFindings } from "./crew/review-facts";
import { saveEvaluation } from "./crew/round-policy-store";
import { confirm, input, NOW, SHA } from "./gate/cases";

afterEach(cleanupDeliveries);

const settings = {
  readyAsk: false,
  reviewStarts: { "7": { head: SHA.reviewed, at: NOW - 100 } },
  reviewJudgmentSeat: "steward",
};
const asks = (calls: string[][]) =>
  calls.filter((argv) => argv[0] === "herdr-world" && argv[1] === "ask");

function operator(f: ReturnType<typeof setup>) {
  const original = f.deps.run;
  f.deps.run = (argv) => {
    const result = original(argv);
    return argv.join(" ") === "herdr agent list"
      ? {
          code: 0,
          stdout:
            '{"result":{"agents":[{"name":"steward","agent_status":"idle","focused":false}]}}',
          stderr: "",
        }
      : result;
  };
}

test("pre-boundary manual RESULTs stay history and cannot satisfy or block the fresh round", () => {
  const f = setup({ seedCycle: false, settings });
  const value = input({
    head: SHA.reviewed,
    posts: [
      confirm("rev2", SHA.reviewed),
      { reviewer: null, commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    ],
  });
  for (const claim of value.history) claim.at = NOW - 1_000;
  for (const claim of value.item!.pr!.reviewers) claim.at = NOW - 1_000;
  const original = structuredClone(value);
  f.passInput(value);
  expect(f.spawned.map((argv) => argv[2])).toEqual(["review"]);
  expect(asks(f.calls)).toEqual([]);
  expect(value).toEqual(original);
});

test("a post-boundary unsigned RESULT is held and routed once to the configured seat, never the owner", () => {
  const f = setup({ seedCycle: false, settings });
  operator(f);
  const value = input({
    head: SHA.reviewed,
    posts: [
      confirm("rev2", SHA.reviewed),
      { reviewer: null, commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    ],
  });
  for (const claim of value.history) claim.at = NOW - 1;
  for (const claim of value.item!.pr!.reviewers) claim.at = NOW - 1;
  f.passInput(value);
  f.passInput(value, NOW + 60_000);
  expect(asks(f.calls)).toEqual([]);
  expect(
    f.calls
      .filter((argv) => argv[0] === "herdr" && argv[2] === "prompt")
      .map((argv) => argv[3]),
  ).toEqual(["steward"]);
  expect(
    actionsIn(f.crew, ["sent"]).some(
      (action) => action.kind === "judgment" && action.target === "steward",
    ),
  ).toBe(true);
  expect(
    f.calls.some(
      (argv) =>
        argv.includes("context=crew/merge-ready") &&
        argv.includes("state=success"),
    ),
  ).toBe(false);
  const clear = input({
    head: SHA.reviewed,
    posts: [confirm("rev2", SHA.reviewed)],
  });
  clear.history[0]!.at = NOW + 1;
  clear.item!.pr!.reviewers[0]!.at = NOW + 1;
  f.passInput(clear, NOW + 120_000);
  expect(
    actionsIn(f.crew, ["pending", "sent"]).some(
      (action) => action.kind === "judgment" && action.target === "steward",
    ),
  ).toBe(false);
});

test("historical P-level summary prose is not a new finding in the fresh crew review", () => {
  const value = input({
    head: SHA.reviewed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    ],
  });
  const findings = openFindings(value, [
    {
      id: "201",
      at: NOW,
      url: "https://example.invalid/review/201",
      body: `Reviewer: rev2\nRESULT #7: 0/0 resolved, 1 new\nP2 src/current.ts:10 current failure\nHistorical dispositions: the old P2 and P3 remain resolved.\nThe unresolved P2 above and UI readiness remain held.`,
    },
  ]);
  expect(findings.map((finding) => finding.file)).toEqual(["src/current.ts"]);
});

test("a configured coordinator never suppresses a real post-boundary finding", () => {
  const f = setup({ seedCycle: false, settings });
  f.passInput(input({ head: SHA.reviewed, posts: [] }));
  f.comment(
    `Reviewer: rev2\nRESULT #7: 0/0 resolved, 1 new\nP2 src/current.ts:10 current failure`,
    NOW + 1,
  );
  const value = input({
    head: SHA.reviewed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    ],
  });
  value.history[0]!.at = NOW + 1;
  value.item!.pr!.reviewers[0]!.at = NOW + 1;
  f.passInput(value, NOW + 100);
  const fix = actionsIn(f.crew, ["pending", "sent"]).find(
    (action) => action.kind === "fix",
  );
  expect(fix?.text).toContain("src/current.ts:10");
  expect(fix?.text).not.toContain("src/widget.ts");
  expect(f.spawned.filter((argv) => argv[2] === "review")).toHaveLength(1);
  expect(asks(f.calls)).toEqual([]);
});

test("a fresh accepted crew head is preserved without another review", () => {
  const f = setup({ seedCycle: false, settings });
  f.passInput(input({ head: SHA.reviewed, posts: [] }));
  const clear = input({
    head: SHA.reviewed,
    posts: [confirm("rev2", SHA.reviewed)],
  });
  clear.history[0]!.at = NOW + 1;
  clear.item!.pr!.reviewers[0]!.at = NOW + 1;
  f.passInput(clear, NOW + 100);
  f.passInput(clear, NOW + 200);
  expect(f.spawned).toHaveLength(1);
});

test("an explicit evaluator owner decision still reaches the owner", () => {
  const f = setup({
    settings: {
      ...settings,
      reviewStarts: {
        "7": { head: SHA.reviewed, at: NOW - 2_000_000 },
      },
    },
  });
  saveEvaluation(f.crew, {
    pr: 7,
    checkpoint: 2,
    head: SHA.reviewed,
    round: 1,
    findings: [],
    status: "process",
    process: "owner",
    next: "Choose the product direction",
  });
  f.passInput(
    input({ head: SHA.reviewed, posts: [confirm("rev2", SHA.reviewed)] }),
  );
  expect(asks(f.calls)).toHaveLength(1);
  expect(asks(f.calls)[0]![2]).toContain(
    "Reply at reception with the decision",
  );
});

test.each(["future", "rewritten", "old crew cycle"])(
  "an unproved adoption boundary stays held for the coordinator: %s",
  (reason) => {
    const f = setup({
      seedCycle: reason === "old crew cycle",
      settings: {
        ...settings,
        reviewStarts: {
          "7": {
            head: SHA.reviewed,
            at: reason === "future" ? NOW + 1 : NOW - 100,
          },
        },
      },
    });
    operator(f);
    const original = f.deps.run;
    if (reason === "rewritten")
      f.deps.run = (argv) => {
        const result = original(argv);
        return argv.includes("--is-ancestor")
          ? { code: 1, stdout: "", stderr: "" }
          : result;
      };
    f.passInput(
      input({
        head: reason === "rewritten" ? SHA.other : SHA.reviewed,
        posts: [
          confirm("rev2", reason === "rewritten" ? SHA.other : SHA.reviewed),
        ],
      }),
    );
    expect(f.spawned).toEqual([]);
    expect(asks(f.calls)).toEqual([]);
    expect(
      f.calls.some((argv) => argv[2] === "prompt" && argv[3] === "steward"),
    ).toBe(true);
    expect(
      f.calls.some(
        (argv) =>
          argv.includes("context=crew/merge-ready") &&
          argv.includes("state=success"),
      ),
    ).toBe(false);
  },
);

test("an unavailable coordinator holds attribution locally without an owner fallback", () => {
  const f = setup({ seedCycle: false, settings });
  const value = input({
    head: SHA.reviewed,
    posts: [
      confirm("rev2", SHA.reviewed),
      { reviewer: null, commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    ],
  });
  for (const claim of value.history) claim.at = NOW - 1;
  f.passInput(value);
  expect(asks(f.calls)).toEqual([]);
  expect(
    actionsIn(f.crew, ["pending"]).some(
      (action) => action.kind === "judgment" && action.target === "steward",
    ),
  ).toBe(true);
});
