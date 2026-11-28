import { setClockForTests } from "../clock";

/**
 * Installs a held clock on `web/src/clock.ts`: `now`/`monotonic` start at the
 * real reading and then move only when the fixture calls `advance(ms)`, which
 * runs every clock timer that falls due, in due order. A clock window (a
 * repeat-dismissal guard) therefore lasts exactly as long as the fixture says,
 * however slowly a loaded browser delivers its input.
 */
export function installAdvanceableClock() {
  let elapsed = 0;
  let nextId = 1;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const origin = performance.now();
  const monotonic = () => origin + elapsed;
  // Wall time follows the same reading, so both move by exactly the same
  // amount: integer Date.now() drifts up to 1 ms against performance.now().
  const wallOrigin = Date.now() - origin;
  const restore = setClockForTests({
    now: () => wallOrigin + monotonic(),
    monotonic,
    setTimeout(callback, delayMs = 0) {
      const id = nextId++;
      timers.set(id, { due: monotonic() + delayMs, callback });
      return id;
    },
    clearTimeout(id) {
      if (id !== undefined) timers.delete(id);
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
        const [id, timer] = next;
        elapsed = Math.max(elapsed, timer.due - origin);
        timers.delete(id);
        timer.callback();
      }
      elapsed = target - origin;
    },
    restore,
  };
}
