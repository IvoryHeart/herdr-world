import type { TownScene } from "./scene/townScene";

/**
 * Presses, scrolls and zooms on the town hold back a reflow (townScene.ts):
 * listens on `host` and the window, and returns the cleanup.
 */
export function holdTownReflowOnInput(scene: TownScene, host: HTMLElement) {
  const touch = () => scene.touch();
  const down = () => scene.pointerDown();
  const up = () => scene.pointerUp();
  host.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", up, true);
  host.addEventListener("wheel", touch, { capture: true, passive: true });
  return () => {
    host.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("pointercancel", up, true);
    host.removeEventListener("wheel", touch, true);
  };
}
