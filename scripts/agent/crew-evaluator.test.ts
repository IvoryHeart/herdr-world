import { afterEach, describe, expect, test } from "bun:test";
import { NOW, SHA } from "./gate/cases";
import {
  fixture,
  finding,
  reviewPost,
  cleanupFixtures,
} from "./crew-round-fixture";
import type { CrewPost } from "./crew/review-facts";
import { evaluationVerdict } from "./crew/evaluator";
import { QUIET_MS, reportOwnerDecision } from "./crew/round-policy";
import {
  evaluations,
  reviewCycles,
  saveEvaluation,
  type Evaluation,
} from "./crew/round-policy-store";

afterEach(cleanupFixtures);

function verdict(
  evaluation: Evaluation,
  outcome: "go" | "no-go",
  middle: string,
): CrewPost {
  return {
    id: "201",
    at: NOW + 1,
    url: "https://github.com/example-org/widgets/pull/7#issuecomment-201",
    body: `[evaluator]\nEvaluation: ${evaluation.checkpoint}\nEvaluated commit: ${evaluation.head}\n${middle}\nEVALUATION #7: ${outcome} — concrete next step`,
  };
}

describe("evaluator and process holds", () => {
  test("two non-converging rounds start one evaluator, holding round 3 across pushes", () => {
    const f = fixture(2);
    for (const head of [SHA.fixed, SHA.fixed, SHA.other]) {
      const actions = f.pass(f.value(head));
      expect(actions.map((action) => action.kind)).toEqual(["evaluate"]);
    }
    expect(evaluations(f.db, 7)).toHaveLength(1);
    expect(reviewCycles(f.db, 7)).toHaveLength(1);
    expect(evaluations(f.db, 7)[0]).toMatchObject({
      checkpoint: 2,
      status: "evaluating",
      head: SHA.fixed,
    });
  });

  test("go scopes the next round to mandatory findings and follows the reply/quiet trigger", () => {
    const f = fixture(2);
    f.reply();
    f.pass();
    const evaluation = evaluations(f.db, 7)[0]!;
    f.setPosts([
      reviewPost,
      {
        id: "102",
        body: "[builder]\nrev2:101:1 fixed",
        at: NOW + 2,
        url: "reply",
      },
      verdict(evaluation, "go", "Required: rev2:101:1"),
    ]);
    expect(
      f
        .pass(undefined, NOW + QUIET_MS + 1)
        .some((action) => action.kind === "confirm"),
    ).toBe(true);
    expect(evaluations(f.db, 7)[0]!.status).toBe("go");
    expect(reviewCycles(f.db, 7).at(-1)!.scope).toEqual(["rev2:101:1"]);
  });

  test("go must disposition every finding once and link follow-up issues", () => {
    const evaluation: Evaluation = {
      pr: 7,
      checkpoint: 2,
      head: SHA.fixed,
      round: 2,
      findings: [finding],
      status: "evaluating",
    };
    expect(
      evaluationVerdict(
        verdict(evaluation, "go", "Required: none"),
        evaluation,
      ),
    ).toBeNull();
    expect(
      evaluationVerdict(
        verdict(
          evaluation,
          "go",
          "Required: none\nFollow-up: rev2:101:1 -> https://github.com/example-org/widgets/issues/9",
        ),
        evaluation,
      ),
    ).toMatchObject({ required: [], verdict: "go" });
    expect(
      evaluationVerdict(
        {
          ...verdict(evaluation, "go", "Required: rev2:101:1"),
          body: "> " + verdict(evaluation, "go", "Required: rev2:101:1").body,
        },
        evaluation,
      ),
    ).toBeNull();
  });

  test("no-go starts a process, holds reviews across pushes and releases only on its report", () => {
    const f = fixture(2);
    f.pass();
    const evaluation = evaluations(f.db, 7)[0]!;
    const post = verdict(
      evaluation,
      "no-go",
      "Process: splitter\nSeat: splitter\nReason: isolate the contract change",
    );
    f.setPosts([reviewPost, post]);
    const held = f.pass();
    expect(held.map((action) => action.kind)).toEqual(["judgment", "process"]);
    expect(evaluations(f.db, 7)[0]).toMatchObject({
      status: "process",
      process: "splitter",
      seat: "splitter",
    });
    expect(
      f
        .pass(f.value(SHA.other), NOW + QUIET_MS)
        .some((action) => action.kind === "confirm"),
    ).toBe(false);
    f.setPosts([
      reviewPost,
      post,
      {
        id: "301",
        at: NOW + 2,
        url: "process-report",
        body: "[splitter]\nEvaluation: 2\nPROCESS #7: done — replacements ready",
      },
    ]);
    f.pass(undefined, NOW + 2 * QUIET_MS);
    expect(evaluations(f.db, 7)[0]!.status).toBe("reported");
  });

  test("a different persona is required for fresh-fixer; design/restart processes are supported", () => {
    const evaluation: Evaluation = {
      pr: 7,
      checkpoint: 2,
      head: SHA.fixed,
      round: 2,
      findings: [finding],
      status: "evaluating",
    };
    for (const process of ["fresh-fixer", "visionary", "restart"]) {
      const value = evaluationVerdict(
        verdict(evaluation, "no-go", `Process: ${process}\nSeat: visionary`),
        evaluation,
      );
      expect(value).toMatchObject({
        verdict: "no-go",
        process,
        seat: "visionary",
      });
    }
    const f = fixture(2);
    f.pass();
    f.setPosts([
      reviewPost,
      verdict(
        evaluations(f.db, 7)[0]!,
        "no-go",
        "Process: fresh-fixer\nSeat: builder",
      ),
    ]);
    const actions = f.pass();
    expect(actions.some((action) => action.kind === "process")).toBe(false);
    expect(
      actions.some((action) => action.text.includes("different persona")),
    ).toBe(true);
  });

  test("an owner answer at reception releases an owner-decision hold", () => {
    const f = fixture(2);
    f.pass();
    f.setPosts([
      reviewPost,
      verdict(
        evaluations(f.db, 7)[0]!,
        "no-go",
        "Process: owner\nReason: contract decision",
      ),
    ]);
    const actions = f.pass();
    expect(actions).toHaveLength(1);
    expect(actions[0]!.text).toContain("reception");
    reportOwnerDecision(
      f.db,
      actions[0]!,
      "Keep this API and fix the recovery case",
    );
    expect(evaluations(f.db, 7)[0]).toMatchObject({
      status: "reported",
      report: "Keep this API and fix the recovery case",
    });
  });

  test("the evaluator runs again after two further non-converging rounds", () => {
    const f = fixture(4);
    saveEvaluation(f.db, {
      pr: 7,
      checkpoint: 2,
      head: SHA.reviewed,
      round: 1,
      findings: [finding],
      status: "reported",
      report: "prior process",
    });
    expect(f.pass().map((action) => action.kind)).toEqual(["evaluate"]);
    expect(evaluations(f.db, 7).map((entry) => entry.checkpoint)).toEqual([
      2, 4,
    ]);
  });
});
