import { expect, test } from "bun:test";
import { clock } from "../clock";
import { installAdvanceableClock } from "./advanceableClock";

test("advancing runs due clock timers in order and moves both readings", () => {
  const time = installAdvanceableClock();
  try {
    const fired: string[] = [];
    const before = clock.monotonic();
    const wall = clock.now();
    clock.setTimeout(() => fired.push("late"), 900);
    clock.setTimeout(() => {
      fired.push("early");
      clock.setTimeout(() => fired.push("chained"), 100);
    }, 400);
    const cancelled = clock.setTimeout(() => fired.push("cancelled"), 300);
    clock.clearTimeout(cancelled);
    time.advance(550);
    expect(fired).toEqual(["early", "chained"]);
    expect(clock.monotonic() - before).toBe(550);
    expect(clock.now() - wall).toBe(550);
    time.advance(400);
    expect(fired).toEqual(["early", "chained", "late"]);
  } finally {
    time.restore();
  }
});

test("a held clock does not move or fire timers on real time", async () => {
  const time = installAdvanceableClock();
  try {
    let fired = false;
    const before = clock.monotonic();
    clock.setTimeout(() => {
      fired = true;
    }, 1);
    // Real time passes across a macrotask; the held clock does not.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(clock.monotonic()).toBe(before);
    expect(fired).toBe(false);
    time.advance(1);
    expect(fired).toBe(true);
  } finally {
    time.restore();
  }
});
