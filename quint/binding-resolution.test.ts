import { expect, test } from "bun:test";
import {
  replayBindingResolution,
  validateBindingTrace,
} from "./binding-resolution";
import type { TraceState } from "./replay";

const initial = {
  policy: "board",
  native: 0,
  witness: 0,
  state: "unresolved",
  source: 0,
  terminal: 0,
  present: true,
  duplicate: false,
  health: "current",
  gen: 1,
  inc: 0,
  lost: false,
  followedLost: false,
  endedByListing: false,
  allowed: false,
  absenceSafe: true,
  retargetSafe: true,
  preserved: true,
};
const trace = () =>
  [
    { op: "init", binding: initial },
    {
      op: "observeComplete",
      binding: { ...initial, state: "attached", allowed: true },
    },
  ] as unknown as TraceState[];
test("binding trace replay compares the production resolver with modeled state and authority", async () => {
  validateBindingTrace(trace());
  expect([...(await replayBindingResolution(trace()))]).toEqual([]);
  const wrong = trace();
  wrong[1]!.binding.native = 1;
  let failure: unknown;
  try {
    await replayBindingResolution(wrong);
  } catch (error) {
    failure = error;
  }
  expect((failure as { observation: string }).observation).toBe(
    "binding.target",
  );
});
test("binding trace validation refuses malformed evidence domains and unknown operations", () => {
  const wrong = trace();
  wrong[1]!.binding.gen = 0;
  expect(() => validateBindingTrace(wrong)).toThrow();
  const foreign = trace();
  foreign[1]!.op = "guessByLabel";
  expect(() => validateBindingTrace(foreign)).toThrow();
});
