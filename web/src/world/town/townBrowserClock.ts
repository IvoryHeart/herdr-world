import { clock } from "../../clock";
import type { TownClock, TownFrames } from "./scene/ports";

/** The page's own clock, for the scene model in the browser. */
export const townBrowserClock: TownClock = {
  now: () => clock.monotonic(),
  after(ms, run) {
    const timer = clock.setTimeout(run, ms);
    return () => clock.clearTimeout(timer);
  },
  wall: () => clock.now(),
};

/** The page's animation frames. */
export const townBrowserFrames: TownFrames = {
  next(run) {
    const frame = clock.requestAnimationFrame(() => run());
    return () => clock.cancelAnimationFrame(frame);
  },
};

/** Yield an ordinary task between renderer setup steps so pending input runs. */
export const nextTownTask = () =>
  new Promise<void>((resolve) => clock.setTimeout(resolve, 0));
