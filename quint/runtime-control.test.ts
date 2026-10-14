import { expect, test } from "bun:test";
import { replayRuntimeControl, type ControlState } from "./runtime-control";
import { parseTrace } from "./traces";

const initial: ControlState = {
  gen: 0,
  phase: "down",
  factory: 0,
  runtimeFactory: -1,
  runtimeGen: -1,
  mode: "none",
  blocked: false,
};
function trace(actions: [string, Partial<ControlState>][]) {
  let control = initial;
  const states = [{ op: "init", control }];
  for (const [op, change] of actions) {
    control = { ...control, ...change };
    states.push({ op, control });
  }
  return parseTrace("runtime-control", JSON.stringify({ states }));
}

test("administrative replay preserves replacement ownership after failed cleanup and removes failed runtimes", async () => {
  const states = trace([
    ["start", { gen: 1, phase: "ready", runtimeGen: 1, runtimeFactory: 0 }],
    ["currentError", { gen: 2, phase: "error" }],
    ["obsoleteError", {}],
    ["stop", { gen: 3, phase: "stopping", mode: "stop" }],
    ["duplicateStop", {}],
    [
      "failCleanup",
      { phase: "error", mode: "none", runtimeFactory: -1, runtimeGen: -1 },
    ],
    ["replace", { gen: 4, factory: 1, phase: "down" }],
    ["start", { gen: 5, phase: "ready", runtimeFactory: 1, runtimeGen: 5 }],
    ["remove", { gen: 6, phase: "stopping", mode: "remove" }],
    ["deniedStart", {}],
    [
      "failCleanup",
      { phase: "removed", mode: "none", runtimeFactory: -1, runtimeGen: -1 },
    ],
  ]);
  const witnesses = await replayRuntimeControl(states);
  for (const witness of [
    "currentFailure",
    "duplicate",
    "failedCleanup",
    "replaced",
    "removed",
    "reentrantStart",
    "reentrantStop",
  ])
    expect(witnesses.has(witness)).toBe(true);
});

test("shutdown rejects reentrant peer admission and remains closed after cleanup failure", async () => {
  const states = trace([
    ["start", { gen: 1, phase: "ready", runtimeGen: 1, runtimeFactory: 0 }],
    [
      "shutdown",
      { gen: 2, phase: "stopping", blocked: true, mode: "shutdown" },
    ],
    ["deniedStart", {}],
    [
      "failCleanup",
      { phase: "error", mode: "none", runtimeFactory: -1, runtimeGen: -1 },
    ],
    ["clearError", { phase: "down" }],
    ["deniedStart", {}],
  ]);
  const witnesses = await replayRuntimeControl(states);
  expect(witnesses.has("shutdownReentry")).toBe(true);
});

test("administrative trace validation rejects cleanup without an owned pending retirement", () => {
  expect(() => trace([["finishCleanup", {}]])).toThrow("precondition");
});
