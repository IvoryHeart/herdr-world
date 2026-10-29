import { afterEach, expect, test } from "bun:test";
import { setup, cleanupDeliveries } from "./crew-round-delivery-fixture";
import {
  fixture,
  cleanupFixtures,
  reviewPost,
  finding,
} from "./crew-round-fixture";
import { config, confirm, input, NOW, SHA } from "./gate/cases";
import { evaluate } from "./gate/predicate";
import { crewVerdict } from "./crew/round-readiness";
import { processPrompt } from "./crew/evaluator";
import { QUIET_MS } from "./crew/round-policy";
import { openFindings, withReplies, type CrewPost } from "./crew/review-facts";
import {
  evaluations,
  reviewCycles,
  saveCycle,
  saveEvaluation,
} from "./crew/round-policy-store";
import {
  actionsIn,
  addAction,
  addRun,
  roundFor,
  setAction,
  setMeta,
  setRunPid,
} from "./crew/store";

afterEach(() => {
  cleanupDeliveries();
  cleanupFixtures();
});

test("upgrade retains queued reviewers and drains their full first reviews after a push", () => {
  const f = setup({ reviewers: ["rev2", "rev-astra"], seedCycle: false });
  for (const target of ["rev2", "rev-astra"])
    addAction(
      f.crew,
      {
        key: `7:${SHA.reviewed}:review:${target}`,
        pr: 7,
        head: SHA.reviewed,
        kind: "review",
        target,
        text: "full first review",
      },
      NOW,
    );
  const key = `7:${SHA.reviewed}:review:rev2`;
  const id = addRun(
    f.crew,
    {
      actionKey: key,
      pr: 7,
      head: SHA.reviewed,
      reviewer: "rev2",
      round: 1,
      log: "synthetic.log",
    },
    NOW,
  );
  setRunPid(f.crew, id, 999);
  setAction(f.crew, key, "running", NOW);
  f.passInput(input({ head: SHA.reviewed, posts: [] }));
  expect(reviewCycles(f.crew, 7)[0]!.reviewers).toEqual(["rev2", "rev-astra"]);
  f.passInput(
    input({ head: SHA.fixed, posts: [confirm("rev2", SHA.reviewed)] }),
    NOW + 60_000,
  );
  expect(f.spawned).toHaveLength(1);
  expect(f.spawned[0]).toContain("rev-astra");
  expect(f.spawned[0]).toContain(SHA.reviewed);
  expect(f.spawned[0]).not.toContain("--since");
});

test("a reviewer RESULT cannot complete a fresh-fixer process on that reviewer's seat", () => {
  const f = setup();
  f.pass();
  f.comment(
    `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nProcess: fresh-fixer\nSeat: rev2\nEVALUATION #7: no-go — fresh persona fixes recovery`,
  );
  f.pass();
  expect(f.spawned.map((argv) => argv[2])).toEqual(["evaluate", "process"]);
  expect(
    actionsIn(f.crew, ["running"]).find((action) => action.kind === "process")
      ?.attempts,
  ).toBe(1);
});

test("follow-up findings stay out of author prompts throughout an admitted scoped round", () => {
  const f = setup();
  f.pass();
  f.comment(
    `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nRequired: none\nFollow-up: rev2:101:1 -> https://github.com/example-org/widgets/issues/9\nEVALUATION #7: go — confirm disposition`,
  );
  f.pass(SHA.reviewed, NOW + QUIET_MS + 1);
  const next = f.pass(SHA.reviewed, NOW + 2 * QUIET_MS);
  expect(next.some((action) => action.kind === "fix")).toBe(false);
  expect(reviewCycles(f.crew, 7).at(-1)!.ordinal).toBe(3);
});

test("mixed old and new confirmations cannot release same-head round readiness", () => {
  const f = setup({ reviewers: ["rev2", "rev-astra"] });
  const old = [
    { reviewer: "rev2", commit: SHA.reviewed, result: "0/0 resolved, 1 new" },
    confirm("rev-astra", SHA.reviewed),
  ];
  const baseline = input({ head: SHA.reviewed, posts: old });
  const round = roundFor(f.crew, 7, SHA.reviewed, NOW, true);
  saveCycle(f.crew, {
    pr: 7,
    head: SHA.reviewed,
    ordinal: 3,
    round: round.round,
    since: SHA.reviewed,
    reviewers: ["rev2", "rev-astra"],
    scope: [],
    ignoredSources: baseline.history.map((claim) => claim.url),
    trigger: { replies: [], quietSince: NOW, reason: "evaluator go" },
  });
  saveEvaluation(f.crew, {
    pr: 7,
    checkpoint: 2,
    head: SHA.reviewed,
    round: 1,
    findings: [],
    status: "go",
    required: [],
  });
  setMeta(
    f.crew,
    `mark:7:${SHA.reviewed}:crew/merge-ready`,
    JSON.stringify({ state: "success", description: "old readiness" }),
  );
  const mixed = input({
    head: SHA.reviewed,
    posts: [...old, confirm("rev2", SHA.reviewed)],
  });
  const actions = f.passInput(mixed);
  expect(actions.some((action) => action.kind === "ready")).toBe(false);
  expect(
    f.calls.some(
      (argv) =>
        argv.includes("context=crew/merge-ready") &&
        argv.includes("state=pending"),
    ),
  ).toBe(true);
  const complete = input({
    head: SHA.reviewed,
    posts: [
      ...old,
      confirm("rev2", SHA.reviewed),
      confirm("rev-astra", SHA.reviewed),
    ],
  });
  expect(
    f
      .passInput(complete, NOW + 60_000)
      .some((action) => action.kind === "ready"),
  ).toBe(true);
});

test("a workflow finding can be confirmed after its fix reply and quiet period", () => {
  const f = fixture();
  f.setFiles([".github/workflows/ci.yml"]);
  f.setPosts([
    {
      ...reviewPost,
      body: reviewPost.body.replace(
        "src/widget.ts",
        ".github/workflows/ci.yml",
      ),
    },
    { id: "102", body: "[builder]\nrev2:101:1 fixed", at: NOW, url: "reply" },
  ]);
  f.pass();
  expect(
    f
      .pass(undefined, NOW + QUIET_MS)
      .some((action) => action.kind === "confirm"),
  ).toBe(true);
});

for (const repeated of ["\nP2 src/widget.ts:10 broken recovery", ""])
  test(`a retained finding needs a new reply after its latest rejection (${repeated ? "restated" : "fraction only"})`, () => {
    const gateInput = input({
      head: SHA.reviewed,
      posts: [
        {
          reviewer: "rev2",
          commit: SHA.reviewed,
          result: "0/1 resolved, 0 new",
        },
      ],
    });
    const retained: CrewPost = {
      ...reviewPost,
      id: "103",
      at: NOW + 60_000,
      body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/1 resolved, 0 new${repeated}`,
    };
    const oldReply: CrewPost = {
      id: "102",
      body: "[builder]\nrev2:101:1 fixed",
      at: NOW,
      url: "old-reply",
    };
    const findings = openFindings(gateInput, [reviewPost, oldReply, retained]);
    expect(findings[0]!.id).toBe(finding.id);
    expect(
      withReplies(findings, [oldReply], "builder", 7)[0]!.reply,
    ).toBeUndefined();
    expect(
      withReplies(
        findings,
        [{ ...oldReply, id: "104", at: NOW + 60_001, url: "new-reply" }],
        "builder",
        7,
      )[0]!.reply,
    ).toBe("new-reply");
  });

test("mandatory fixes require post-verdict replies and a quiet period starting at the verdict", () => {
  const f = fixture(2);
  f.reply();
  f.pass(f.value(SHA.reviewed));
  const go: CrewPost = {
    id: "201",
    at: NOW + QUIET_MS,
    url: "verdict",
    body: `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nRequired: rev2:101:1\nEVALUATION #7: go — fix recovery`,
  };
  const oldReply: CrewPost = {
    id: "102",
    at: NOW,
    body: "[builder]\nrev2:101:1 fixed",
    url: "old-reply",
  };
  f.setPosts([reviewPost, oldReply, go]);
  const first = f.pass(f.value(SHA.reviewed), go.at);
  expect(reviewCycles(f.db, 7)).toHaveLength(1);
  expect(first.some((action) => action.kind === "fix")).toBe(true);
  f.setPosts([
    reviewPost,
    oldReply,
    go,
    { ...oldReply, id: "202", at: go.at + 1, url: "new-reply" },
  ]);
  f.pass(f.value(SHA.reviewed), go.at + QUIET_MS - 1);
  expect(reviewCycles(f.db, 7)).toHaveLength(1);
  f.pass(f.value(SHA.reviewed), go.at + QUIET_MS);
  expect(reviewCycles(f.db, 7).at(-1)!.ordinal).toBe(3);
});

test("a review cycle has one fix prompt and answered findings do not prompt again on pushes", () => {
  const f = fixture();
  const first = f.pass().find((action) => action.kind === "fix")!;
  const next = f
    .pass(f.value(SHA.other), NOW + 60_000)
    .find((action) => action.kind === "fix")!;
  expect(first.key).toBe(next.key);
  f.reply();
  expect(
    f
      .pass(f.value(SHA.fixed), NOW + 120_000)
      .some((action) => action.kind === "fix"),
  ).toBe(false);
  expect(
    f
      .pass(f.value(SHA.other), NOW + 180_000)
      .some((action) => action.kind === "fix"),
  ).toBe(false);
});

for (const file of [
  ".github/workflows/ci.yml",
  "scripts/ci-verification.ts",
  "scripts/check-pr-body.ts",
])
  test(`gate changes need a scoped confirmation: ${file}`, () => {
    const f = fixture();
    f.setFiles([file]);
    const clean = input({
      head: SHA.fixed,
      posts: [confirm("rev2", SHA.reviewed)],
    });
    f.pass(clean);
    expect(
      crewVerdict(
        f.db,
        evaluate(clean, { ...config, reviewers: { default: ["rev2"] } }, NOW),
        clean,
      ).state,
    ).not.toBe("READY");
    expect(
      f.pass(clean, NOW + QUIET_MS).some((action) => action.kind === "confirm"),
    ).toBe(true);
  });

test("one read outage is silent, persistent failures escalate, and recovery resets the count", () => {
  const f = fixture();
  const original = f.deps.run;
  const fail = () => {
    f.deps.run = (argv) =>
      argv[0] === "gh"
        ? { code: 1, stdout: "", stderr: "temporary" }
        : original(argv);
  };
  fail();
  expect(f.pass().some((action) => action.kind === "judgment")).toBe(false);
  expect(
    f
      .pass(undefined, NOW + 60_000)
      .some((action) => action.kind === "judgment"),
  ).toBe(false);
  expect(
    f
      .pass(undefined, NOW + 120_000)
      .some((action) => action.kind === "judgment"),
  ).toBe(true);
  f.deps.run = original;
  f.pass(undefined, NOW + 180_000);
  fail();
  expect(
    f
      .pass(undefined, NOW + 240_000)
      .some((action) => action.kind === "judgment"),
  ).toBe(false);
});

test("a fresh-fixer on a reviewer seat hands accepted replies to the next confirmation round", () => {
  const f = setup();
  f.pass();
  f.comment(
    `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\nProcess: fresh-fixer\nSeat: rev2\nEVALUATION #7: no-go — use a fresh persona`,
  );
  f.pass();
  expect(processPrompt(config.repo, evaluations(f.crew, 7)[0]!)).toContain(
    "[fixer #7]",
  );
  f.comment("[fixer #7]\nrev2:101:1 fixed in bbbbbbb", NOW + 2);
  f.comment(
    "[rev2]\nEvaluation: 2\nPROCESS #7: done — recovery fixed",
    NOW + 3,
  );
  expect(
    f.pass(SHA.fixed, NOW + 60_000).some((action) => action.kind === "fix"),
  ).toBe(false);
  f.pass(SHA.fixed, NOW + 60_000 + QUIET_MS);
  expect(evaluations(f.crew, 7)[0]!.status).toBe("reported");
  expect(f.spawned.map((argv) => argv[2])).toEqual([
    "evaluate",
    "process",
    "review",
  ]);
});

test("a repeated rejection after a scoped round cannot reuse consumed replies for round 4", () => {
  const f = fixture(3);
  saveEvaluation(f.db, {
    pr: 7,
    checkpoint: 2,
    head: SHA.reviewed,
    round: 1,
    status: "go",
    findings: [finding],
    required: [finding.id],
    verdictAt: NOW - 120_000,
  });
  const oldReply: CrewPost = {
    id: "102",
    at: NOW,
    body: "[builder]\nrev2:101:1 fixed",
    url: "old-reply",
  };
  f.setPosts([
    reviewPost,
    oldReply,
    {
      ...reviewPost,
      id: "103",
      at: NOW + 60_000,
      body: `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/1 resolved, 0 new`,
    },
  ]);
  const rejected = input({
    head: SHA.reviewed,
    posts: [
      { reviewer: "rev2", commit: SHA.reviewed, result: "0/1 resolved, 0 new" },
    ],
  });
  f.pass(rejected, NOW + 120_000);
  f.pass(rejected, NOW + 120_000 + QUIET_MS);
  expect(reviewCycles(f.db, 7)).toHaveLength(1);
  expect(reviewCycles(f.db, 7)[0]!.ordinal).toBe(3);
});

test("rewritten ancestry escalates immediately rather than entering transient retries", () => {
  const f = fixture();
  const original = f.deps.run;
  f.deps.run = (argv) =>
    argv.includes("--is-ancestor")
      ? { code: 1, stdout: "", stderr: "" }
      : original(argv);
  expect(
    f
      .pass()
      .some(
        (action) =>
          action.kind === "judgment" &&
          action.text.includes("rewritten history"),
      ),
  ).toBe(true);
});
