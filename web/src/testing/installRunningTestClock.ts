import { installTestClock } from "../world/testing/testClock";

/**
 * Import first in a browser fixture that runs on test time but awaits the
 * app itself (store refreshes, fake RPCs, commands with deadlines): the page
 * runs on the running test clock (see testClock.ts), so its timers, frames
 * and `performance.now` advance in 16 ms steps as fast as the page handles
 * them. CSS transitions and animations are off too: they run on real time,
 * and checks read the end state.
 *
 * Fixtures wait with `clock.advance(ms)` for a stretch of test time and
 * `clock.until(condition, message)` for a state, never with real timers.
 */
export const clock = installTestClock(window, performance, { running: true });
window.__HERDR_TEST_CLOCK__ = clock;
const style = document.createElement("style");
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.append(style);
