import { installTestClock, realTimeClock, type TestClock } from "./testClock";

/**
 * The Hosts filter fixture's clock. Imported first: the page runs on a
 * running test clock (see testClock.ts), with CSS transitions and animations
 * off, except for the cases listed here, which still run on real time.
 */
const REAL_TIME = new Map([
  // #238: WorldControlPlane re-renders synchronously without end on test time.
  ["spaces-navigator", "#238"],
]);

const operation = new URL(location.href).searchParams.get("operation") ?? "";
export const clock: TestClock = REAL_TIME.has(operation)
  ? realTimeClock()
  : installTestClock(window, performance, { running: true });
if (!REAL_TIME.has(operation)) {
  const style = document.createElement("style");
  style.textContent =
    "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.append(style);
}
