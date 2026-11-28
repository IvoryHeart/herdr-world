import { installTestClock } from "./testClock";
import { injectClock } from "../../clock";

/**
 * Import first in a fixture that runs on test time (see testClock.ts). Its
 * page then has no CSS transitions or animations either: they run on real
 * time, and checks read the end state.
 */
export const clock = installTestClock();
Object.assign(window, { __herdrTestStep: () => clock.frame() });
// Layout/control fixtures keep the same local date at noon. Day/night
// contracts select their explicit sky mode; wall time never changes GPU work.
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const epoch = noon.getTime() - clock.now();
Date.now = () => epoch + clock.now();
injectClock({
  now: () => epoch + clock.now(),
  monotonic: () => clock.now(),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: (callback, delay) => window.setInterval(callback, delay),
  clearInterval: window.clearInterval.bind(window),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
});
const style = document.createElement("style");
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.append(style);
/** CSS contract checks await native animation.finished events. */
export const restoreNativeMotion = () => style.remove();
