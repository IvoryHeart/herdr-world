import { installTestClock } from "./testClock";

/**
 * Import first in a fixture that runs on test time (see testClock.ts). Its
 * page then has no CSS transitions or animations either: they run on real
 * time, and checks read the end state.
 */
export const clock = installTestClock();
const style = document.createElement("style");
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.append(style);
