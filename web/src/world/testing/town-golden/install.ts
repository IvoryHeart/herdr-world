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
// Town's DOM overlays (signs, plaques, the + Add room doorway) are compositor
// layers scaled by the camera's zoom. Chrome fixes a layer's raster scale once
// that scale changes outside a CSS animation, so overlays painted while the
// camera settles keep whichever intermediate zoom the real-time compositor
// happened to commit, and their edges differ by one colour level from run to
// run. They stay unpainted (layout and measurements unchanged) until the
// fixture reaches its checkpoint, so their layers are rastered once, at the
// settled camera (TownGolden.browser.tsx reveals them).
style.textContent =
  "*, *::before, *::after { transition: none !important; animation: none !important; }" +
  ".golden-settling .town-world, .golden-settling .town-world * { visibility: hidden !important; }";
document.head.append(style);
document.documentElement.classList.add("golden-settling");
