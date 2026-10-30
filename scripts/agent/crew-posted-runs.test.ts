import { afterEach, expect, test } from "bun:test";
import {
  reviewerResults,
  type Post,
} from "../../server/src/sources/pullRequestDetail";
import { cleanupDeliveries, setup } from "./crew-round-delivery-fixture";
import {
  activeRuns,
  addAction,
  addRun,
  finishRun,
  getAction,
  getRun,
  setAction,
  setRunResult,
} from "./crew/store";
import { runSession } from "./crew/review";
import { evaluations, saveCycle } from "./crew/round-policy-store";
import { input, NOW, SHA } from "./gate/cases";

afterEach(cleanupDeliveries);

function review(
  body = `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 1 new`,
): Post {
  return {
    id: "synthetic-result",
    body,
    commit: SHA.fixed,
    at: NOW + 1,
    url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-201",
  };
}

test("a reviewer finishes on its own RESULT after a push, even when gate binding is unknown", () => {
  const f = setup({ seedCycle: false });
  f.passInput(input({ head: SHA.reviewed, posts: [] }));
  const run = activeRuns(f.crew)[0]!;
  const post = review();
  const history = reviewerResults(
    7,
    [post],
    [{ oid: SHA.fixed, at: NOW }],
    SHA.fixed,
  );
  expect(history[0]).toMatchObject({ commit: null, outcome: "unknown" });
  f.passInput(
    { ...input({ head: SHA.fixed, posts: [] }), history, reviewPosts: [post] },
    NOW + 60_000,
  );
  expect(getRun(f.crew, run.id)).toMatchObject({
    head: SHA.reviewed,
    exitCode: 0,
    finishedAt: NOW + 60_000,
    result: "RESULT #7: 0/0 resolved, 1 new",
  });
  expect(getAction(f.crew, run.actionKey)?.state).toBe("done");
  expect(activeRuns(f.crew).some((entry) => entry.id === run.id)).toBe(false);
  f.passInput(
    { ...input({ head: SHA.fixed, posts: [] }), history, reviewPosts: [post] },
    NOW + 20 * 60_000,
  );
  expect(getAction(f.crew, `${run.actionKey}|stuck`)).toBeNull();
  expect(history[0]?.outcome).toBe("unknown");
});

test.each([
  `Reviewer: rev2\nReviewed commit: ${SHA.other}\nRESULT #7: 0/0 resolved, 0 new`,
  `Reviewer: rev-astra\nReviewed commit: ${SHA.reviewed}\nRESULT #7: 0/0 resolved, 0 new`,
  `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #8: 0/0 resolved, 0 new`,
  `Reviewer: rev2\nReviewed commit: ${SHA.reviewed}\nRESULT #7: pending`,
  `> Reviewer: rev2\n> Reviewed commit: ${SHA.reviewed}\n> RESULT #7: 0/0 resolved, 0 new`,
])(
  "unrelated or invalid RESULT evidence cannot finish a pinned reviewer: %s",
  (body) => {
    const f = setup({ seedCycle: false });
    f.passInput(input({ head: SHA.reviewed, posts: [] }));
    const run = activeRuns(f.crew)[0]!;
    f.passInput(
      { ...input({ head: SHA.fixed, posts: [] }), reviewPosts: [review(body)] },
      NOW + 60_000,
    );
    expect(getRun(f.crew, run.id)?.finishedAt).toBeNull();
  },
);

test.each([false, true])(
  "a same-head confirmation finishes only on its fresh post (fresh: %s)",
  (fresh) => {
    const f = setup({ seedCycle: false });
    const older = {
      ...review(),
      commit: SHA.reviewed,
      url: "https://github.com/example-org/widgets/pull/7#pullrequestreview-101",
      at: NOW - 1,
    };
    const action = {
      key: `7:${SHA.reviewed}:confirm:rev2:round-3`,
      pr: 7,
      head: SHA.reviewed,
      kind: "confirm" as const,
      target: "rev2",
      text: "Confirm the mandatory fixes",
    };
    saveCycle(f.crew, {
      pr: 7,
      head: SHA.reviewed,
      round: 1,
      ordinal: 3,
      reviewers: ["rev2"],
      reviewActions: [action],
      ignoredSources: [String(older.url)],
      trigger: {
        replies: [],
        quietSince: NOW,
        reason: "same-head confirmation",
      },
    });
    addAction(f.crew, action, NOW);
    setAction(f.crew, action.key, "running", NOW);
    const id = addRun(
      f.crew,
      {
        actionKey: action.key,
        pr: 7,
        head: SHA.reviewed,
        reviewer: "rev2",
        log: "synthetic.log",
      },
      NOW,
    );
    f.passInput(
      {
        ...input({ head: SHA.fixed, posts: [] }),
        history: reviewerResults(
          7,
          [older],
          [{ oid: SHA.reviewed, at: 0 }],
          SHA.fixed,
        ),
        reviewPosts: fresh ? [older, review()] : [older],
      },
      NOW + 60_000,
    );
    expect(getRun(f.crew, id)?.finishedAt).toBe(fresh ? NOW + 60_000 : null);
  },
);

test.each(["go", "no-go"])(
  "an evaluator's %s finishes its pinned run even when a new head cannot be reconciled",
  (outcome) => {
    const f = setup();
    f.pass();
    const run = activeRuns(f.crew)[0]!;
    const original = f.deps.run;
    f.deps.run = (argv) =>
      argv.includes("--is-ancestor")
        ? { code: 1, stdout: "", stderr: "" }
        : original(argv);
    const disposition =
      outcome === "go" ? "Required: rev2:101:1" : "Process: owner";
    const post = review(
      `[evaluator]\nEvaluation: 2\nEvaluated commit: ${SHA.reviewed}\n${disposition}\nEVALUATION #7: ${outcome} — concrete next step`,
    );
    f.passInput(
      { ...input({ head: SHA.fixed, posts: [] }), reviewPosts: [post] },
      NOW + 60_000,
    );
    expect(getRun(f.crew, run.id)).toMatchObject({
      head: SHA.reviewed,
      exitCode: 0,
      finishedAt: NOW + 60_000,
      result: `EVALUATION #7: ${outcome} — concrete next step`,
    });
    expect(getAction(f.crew, run.actionKey)?.state).toBe("done");
    expect(evaluations(f.crew, 7)[0]?.status).toBe("evaluating");
  },
);

test.each(["head", "checkpoint", "disposition"])(
  "an evaluator result with the wrong %s cannot finish its run",
  (wrong) => {
    const f = setup();
    f.pass();
    const run = activeRuns(f.crew)[0]!;
    const post = review(
      `[evaluator]\nEvaluation: ${wrong === "checkpoint" ? 4 : 2}\nEvaluated commit: ${wrong === "head" ? SHA.other : SHA.reviewed}\nRequired: ${wrong === "disposition" ? "none" : "rev2:101:1"}\nEVALUATION #7: go — next round`,
    );
    f.passInput(
      { ...input({ head: SHA.fixed, posts: [] }), reviewPosts: [post] },
      NOW + 60_000,
    );
    expect(getRun(f.crew, run.id)?.finishedAt).toBeNull();
  },
);

test.each(["reviewer", "evaluator"])(
  "a posted %s result ends its interactive harness and worker wait",
  async (kind) => {
    const f = setup({ seedCycle: kind === "evaluator" });
    if (kind === "evaluator") f.pass();
    else f.passInput(input({ head: SHA.reviewed, posts: [] }));
    const run = activeRuns(f.crew)[0]!;
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
    process.on("SIGTERM", () => {});
    console.log("ready");
    setInterval(() => {}, 1000);
  `,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    try {
      await child.stdout.getReader().read();
      const session = runSession(
        f.crew,
        run.id,
        { model: "claude-opus-5-5" },
        "synthetic task",
        process.cwd(),
        () => {},
        {
          exitOnResult: true,
          spawn: () => child,
        },
      );
      const line =
        kind === "reviewer"
          ? "RESULT #7: 0/0 resolved, 0 new"
          : "EVALUATION #7: go — next round";
      setRunResult(f.crew, run.id, line);
      finishRun(f.crew, run.id, 0, null, NOW + 1);
      expect(await session).toMatchObject({ code: 0 });
      expect(child.signalCode).toBe("SIGKILL");
      expect(getRun(f.crew, run.id)).toMatchObject({
        result: line,
        exitCode: 0,
        harness: "claude",
      });
      expect(getRun(f.crew, run.id)?.session).toBeTruthy();
    } finally {
      child.kill("SIGKILL");
      await child.exited;
    }
  },
  15_000,
);
