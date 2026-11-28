import { expect, test } from "bun:test";
import { clock, injectClock, type Clock } from "./clock";

test("time and scheduling use the injected port and restore its previous owner", () => {
  const calls: unknown[] = [];
  const fake = {
    now: () => 42,
    monotonic: () => 7,
    setTimeout: (fn: unknown, ms: number) => {
      calls.push([fn, ms]);
      return 8;
    },
    clearTimeout: (id: number) => calls.push(id),
    setInterval: (fn: unknown, ms: number) => {
      calls.push([fn, ms]);
      return 9;
    },
    clearInterval: (id: number) => calls.push(id),
    requestAnimationFrame: (fn: unknown) => {
      calls.push(fn);
      return 10;
    },
    cancelAnimationFrame: (id: number) => calls.push(id),
  } as unknown as Clock;
  const restore = injectClock(fake);
  try {
    const run = () => {};
    expect(clock.now()).toBe(42);
    expect(clock.monotonic()).toBe(7);
    expect(clock.setTimeout(run, 100)).toBe(8);
    expect(clock.setInterval(run, 200)).toBe(9);
    expect(clock.requestAnimationFrame(run)).toBe(10);
    clock.clearTimeout(8);
    clock.clearInterval(9);
    clock.cancelAnimationFrame(10);
    expect(calls).toEqual([[run, 100], [run, 200], run, 8, 9, 10]);
    const nested = injectClock({ ...fake, now: () => 100 });
    expect(clock.now()).toBe(100);
    nested();
    expect(clock.now()).toBe(42);
  } finally {
    restore();
  }
});
