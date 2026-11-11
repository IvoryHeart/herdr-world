import { validateTrace } from "./traces";
import { expect, test } from "bun:test";
import {
  CoreProtocolFake,
  coreFaults,
  replayCore,
  validateCoreTrace,
} from "./herdr-core-runtime";
import { expectObservationMismatch } from "./observations";

function trace(actions: (string | [string, number])[]) {
  const fake = new CoreProtocolFake();
  const states = [{ c: structuredClone(fake.state), op: "init", target: 0 }];
  for (const action of actions) {
    const [op, target] = typeof action === "string" ? [action, 0] : action;
    fake.apply(op, target);
    states.push({ c: structuredClone(fake.state), op, target });
  }
  return states;
}

test("relative deltas and creation survive missed and old callbacks", () => {
  const states = trace([
    "connect",
    "baseline",
    ["x", 0],
    ["create", 1],
    "missed",
    "receive",
    "receive",
  ]);
  expect(states.at(-1)!.c.mirror.map((t) => [t.x, t.y])).toEqual([
    [1, 0],
    [0, 0],
  ]);
  expect(replayCore(states).has("missedCut")).toBe(true);
  const lost = structuredClone(states);
  lost.at(-1)!.c.mirror[0]!.x = 0;
  return expectObservationMismatch(() => replayCore(lost), ["core.state"]);
});

test("queued session delivery is refused after kept replacement", async () => {
  const states = trace([
    "connect",
    "baseline",
    "capture",
    "dispatch",
    "disconnect",
    "replace",
    "deliver",
  ]);
  expect(replayCore(states).has("queueFenced")).toBe(true);
  await expectObservationMismatch(
    () => replayCore(states, true),
    ["core.state"],
  );
});

test("original leases cannot be replaced by another profile on the same core", () => {
  for (const retire of [
    ["switchProfile"],
    ["restart", "connect", "baseline"],
  ]) {
    const states = trace([
      "connect",
      "baseline",
      "capture",
      ...retire,
      "dispatch",
    ]);
    replayCore(states);
    expect(states.at(-1)!.c.attempts).toBe(0);
  }
});

test("restart accepts a smaller baseline and never replays an uncertain write", () => {
  const states = trace([
    "connect",
    "baseline",
    "x",
    "receive",
    "capture",
    "dispatch",
    "restart",
    "connect",
    "baseline",
    "recover",
  ]);
  replayCore(states);
  expect(states.at(-1)!.c).toMatchObject({
    cursor: 0,
    attempts: 1,
    uncertain: true,
    ready: true,
  });
});

test("heartbeat gaps and absent endpoints cannot become actionable", () => {
  const gap = trace(["connect", "baseline", "x", "drop", "heartbeat"]);
  expect(replayCore(gap).has("gapRetired")).toBe(true);
  expect(replayCore(trace(["absent", "connect"])).has("existingOnly")).toBe(
    true,
  );
});

test("the eleven ordering/authority and five observe faults are registered; malformed traces are errors", () => {
  expect(new Set(coreFaults).size).toBe(16);
  expect(() => validateCoreTrace([{ op: "init", c: {}, target: 0 }])).toThrow();
  const states = trace(["connect", "baseline"]);
  states[1]!.target = 7;
  expect(() => replayCore(states)).toThrow();
});

test("canonical trace admission accepts the registered core design case", () => {
  const states = trace(["connect", "baseline", "capture", "dispatch"]);
  expect(() => validateTrace("herdr-core-runtime", states)).not.toThrow();
});

test("removed terminal addresses cannot be created again", () => {
  const fake = new CoreProtocolFake(false, 3);
  fake.apply("connect");
  fake.apply("baseline");
  fake.apply("create", 1);
  fake.apply("remove", 1);
  expect(() => fake.apply("create", 1)).toThrow();
});

test("a watch adopts the pane's grid before each paint and follows it to headless", () => {
  const states = trace([
    "connect",
    "baseline",
    ["pane", 0],
    ["watch", 1],
    "frame",
    "frame",
    "stall",
    ["pane", 1],
    "output",
    "drain",
    "frame",
    "frame",
    ["pane", 2],
    "frame",
    "frame",
    "viewport",
  ]);
  const last = states.at(-1)!.c;
  expect(last).toMatchObject({
    grid: 2,
    shown: 2,
    misdrawn: false,
    typed: false,
  });
  const witnesses = replayCore(states);
  for (const name of ["watchAdopted", "stallReleased", "headlessFollowed"])
    expect(witnesses.has(name)).toBe(true);
  // Recorded drawing on the wrong grid is caught by the replay.
  const wrong = structuredClone(states);
  wrong.at(-3)!.c.shown = 1;
  return expectObservationMismatch(() => replayCore(wrong), ["core.state"]);
});

test("an unconfirmed path is refused; an observer alone goes headless", () => {
  const refused = trace(["connect", "baseline", ["watch", 0]]);
  expect(refused.at(-1)!.c.watching).toBe(false);
  expect(replayCore(refused).has("unconfirmedRefused")).toBe(true);
  const alone = trace(["connect", "baseline", ["watch", 1], "frame", "frame"]);
  expect(alone.at(-1)!.c).toMatchObject({ grid: 2, shown: 2, misdrawn: false });
  expect(replayCore(alone).has("observerAlone")).toBe(true);
});
