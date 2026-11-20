import { expect, test } from "bun:test";
import { replayTapLockCounterexample } from "./claude-tap-lock";

test("counterexample: a stale tap holder lowers the replacement owner's committed reading", () => {
  expect(replayTapLockCounterexample().commits).toEqual([20, 23, 22]);
});
