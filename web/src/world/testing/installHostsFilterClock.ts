import { installTestClock } from "./testClock";

/**
 * The Hosts filter fixture's clock. Imported first: the page runs on a
 * running test clock (see testClock.ts), with CSS transitions and animations
 * off.
 */
export const clock = installTestClock(window, performance, { running: true });
const style = document.createElement("style");
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.append(style);
