import { setClockForTests } from "../clock";

/**
 * Installs a clock on `web/src/clock.ts` that follows real time but can jump
 * ahead: `advance(ms)` moves `now`/`monotonic` forward and runs every clock
 * timer that falls due, in due order, instead of the fixture waiting the real
 * duration. Timers keep their real deadlines too, so code that is not advanced
 * still behaves normally.
 */
export function installAdvanceableClock() {
  let skew = 0;
  let nextId = 1;
  const timers = new Map<
    number,
    { due: number; callback: () => void; real: number }
  >();
  const monotonic = () => performance.now() + skew;
  // Wall time follows the same reading, so both move by exactly the same
  // amount: integer Date.now() drifts up to 1 ms against performance.now().
  const wallOrigin = Date.now() - performance.now();
  const fire = (id: number) => {
    const timer = timers.get(id);
    if (!timer) return;
    timers.delete(id);
    clearTimeout(timer.real);
    timer.callback();
  };
  const restore = setClockForTests({
    now: () => wallOrigin + monotonic(),
    monotonic,
    setTimeout(callback, delayMs = 0) {
      const id = nextId++;
      const real = setTimeout(() => fire(id), delayMs) as unknown as number;
      timers.set(id, { due: monotonic() + delayMs, callback, real });
      return id;
    },
    clearTimeout(id) {
      const timer = id === undefined ? undefined : timers.get(id);
      if (!timer || id === undefined) return;
      clearTimeout(timer.real);
      timers.delete(id);
    },
  });
  return {
    advance(ms: number) {
      const target = monotonic() + ms;
      // Step to each due time in order, so a timer a callback schedules is due
      // relative to that callback, as with real time.
      for (;;) {
        const next = [...timers]
          .filter(([, timer]) => timer.due <= target)
          .sort(([, a], [, b]) => a.due - b.due)[0];
        if (!next) break;
        skew = Math.max(skew, next[1].due - performance.now());
        fire(next[0]);
      }
      skew = Math.max(skew, target - performance.now());
    },
    restore,
  };
}
