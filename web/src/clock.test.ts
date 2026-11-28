import { afterEach, expect, test } from "bun:test";
import { clock, setClockForTests } from "./clock";

let restore = () => {};
afterEach(() => restore());

test("the clock reads the page's timers at call time and accepts a test clock", () => {
  const scheduled: number[] = [];
  restore = setClockForTests({
    now: () => 42,
    monotonic: () => 7,
    setTimeout: (_callback, delayMs) => {
      scheduled.push(delayMs ?? 0);
      return 1;
    },
  });
  expect(clock.now()).toBe(42);
  expect(clock.monotonic()).toBe(7);
  expect(clock.setTimeout(() => {}, 250)).toBe(1);
  expect(scheduled).toEqual([250]);
  restore();
  const before = Date.now();
  expect(clock.now()).toBeGreaterThanOrEqual(before);
});

test("page timers run through the shared clock", async () => {
  const fired = Promise.withResolvers<void>();
  const id = clock.setTimeout(() => fired.resolve(), 0);
  expect(typeof id).not.toBe("undefined");
  await fired.promise;
  let ticks = 0;
  const done = Promise.withResolvers<void>();
  const interval = clock.setInterval(() => {
    if (++ticks === 2) {
      clock.clearInterval(interval);
      done.resolve();
    }
  }, 1);
  await done.promise;
  expect(ticks).toBe(2);
});
