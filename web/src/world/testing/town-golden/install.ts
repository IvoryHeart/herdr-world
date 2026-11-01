import { installTestClock } from "../testClock";

// Import before React, Pixi or the scheduler capture the page's time sources.
export const clock = installTestClock(window, performance, { startAt: 0 });
Date.now = () => 1_800_000_000_000 + clock.now();
let seed = 0x746f776e;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
};
window.__HERDR_WORLD_RENDERER_DEBUG__ = "counters";
const style = document.createElement("style");
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }";
document.head.append(style);
