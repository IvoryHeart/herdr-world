import type { TownClock } from "./scene/ports";

/** The page's own clock, for the scene model in the browser. */
export const townBrowserClock: TownClock = {
  now: () => performance.now(),
  after(ms, run) {
    const timer = window.setTimeout(run, ms);
    return () => window.clearTimeout(timer);
  },
  wall: () => Date.now(),
};
