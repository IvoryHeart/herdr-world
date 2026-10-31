import { expect, test } from "bun:test";
import { checkServiceRule, replayObservationBase } from "./observation-base";
import { validateObservationTrace } from "./observation-traces";
import type { TraceState } from "./replay";

test("real service exhausts the finite incarnation/generation/token admission table", () => {
  expect(() => checkServiceRule()).not.toThrow();
});

function unchangedTrace(): TraceState[] {
  const initial = {
    inc: 0,
    gen: [1, 1],
    token: [0, 0],
    epoch: 0,
    heldInc: -1,
    contentInc: [-1, -1],
    heldGen: [-1, -1],
    heldToken: [-1, -1],
    live: [true, true],
    actionable: [false, false],
    phase: "idle",
    issued: 0,
    captured: -1,
    baseInc: -1,
    baseGen: [-1, -1],
    baseToken: [-1, -1],
    replyInc: -1,
    replyGen: [-1, -1],
    replyToken: [-1, -1],
    confirms: [false, false],
    fresh: true,
    validConfirmation: true,
  };
  const admitted = {
    ...initial,
    issued: 1,
    heldInc: 0,
    contentInc: [0, 0],
    heldGen: [1, 1],
    heldToken: [0, 0],
    actionable: [true, true],
  };
  const row = (op: string, s: typeof initial, outcome = "none") => ({
    op,
    s,
    host: -1,
    outcome,
  });
  return [
    row("init", initial),
    row("request", { ...initial, phase: "requested", issued: 1, captured: 0 }),
    row("reply", {
      ...initial,
      phase: "replied",
      issued: 1,
      captured: 0,
      replyInc: 0,
      replyGen: [1, 1],
      replyToken: [0, 0],
    }),
    row("apply", admitted, "complete"),
    row("request", {
      ...admitted,
      phase: "requested",
      issued: 2,
      captured: 0,
      baseInc: 0,
      baseGen: [1, 1],
      baseToken: [0, 0],
    }),
    row("reply", {
      ...admitted,
      phase: "replied",
      issued: 2,
      captured: 0,
      baseInc: 0,
      baseGen: [1, 1],
      baseToken: [0, 0],
      replyInc: 0,
      replyGen: [1, 1],
      replyToken: [0, 0],
      confirms: [true, true],
    }),
    row("apply", { ...admitted, issued: 2 }, "unchanged"),
  ] as unknown as TraceState[];
}

test("production replay observes a complete bootstrap then an unchanged confirmation", async () => {
  const trace = unchangedTrace();
  validateObservationTrace(trace);
  expect([...(await replayObservationBase(trace))]).toEqual(["unchangedSkip"]);
});

test("base trace validation rejects malformed cardinality and unknown actions", () => {
  const malformed = unchangedTrace();
  malformed[1]!.s.gen = [1];
  expect(() => validateObservationTrace(malformed)).toThrow();
  const foreign = unchangedTrace();
  foreign[1]!.op = "foreign";
  expect(() => validateObservationTrace(foreign)).toThrow();
});
