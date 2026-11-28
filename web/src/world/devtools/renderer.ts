import { DEVTOOLS } from "./flag";

declare global {
  interface Window {
    /** Set by browser fixtures; `"counters"` collects counters only. */
    __HERDR_WORLD_RENDERER_DEBUG__?: boolean | "counters";
    /** World model work by kind, while the counters are on. */
    __HERDR_WORLD_WORK__?: Record<string, number>;
    /**
     * Set false by browser checks of behaviour, not pixels: Town keeps its
     * whole scene, frames and counters but submits nothing to WebGL.
     */
    __HERDR_TOWN_PIXELS__?: boolean;
  }
}

/**
 * Whether Town's renderer publishes per-node debug snapshots: a fixture asks
 * for them, or `?debug=town` is in the URL. Development builds only; a
 * release build answers false and drops the code behind it.
 */
export function worldRendererDebugEnabled() {
  if (!DEVTOOLS || typeof window === "undefined") return false;
  if (window.__HERDR_WORLD_RENDERER_DEBUG__ === true) return true;
  try {
    return new URLSearchParams(window.location.search).get("debug") === "town";
  } catch {
    return false;
  }
}

/** Whether the renderer keeps acceptance counters (without node snapshots). */
export function worldRendererCountersEnabled() {
  return (
    DEVTOOLS &&
    typeof window !== "undefined" &&
    (window.__HERDR_WORLD_RENDERER_DEBUG__ === "counters" ||
      worldRendererDebugEnabled())
  );
}

/**
 * Count World model work (preparations, construction units, projections) for
 * browser fixtures' work ceilings. Unlike a timing, a count does not depend on
 * how fast the machine is. Collected only while the counters are on.
 */
export function countWorldWork(kind: string, units = 1) {
  if (!worldRendererCountersEnabled()) return;
  const work = (window.__HERDR_WORLD_WORK__ ??= {});
  work[kind] = (work[kind] ?? 0) + units;
}

/**
 * Whether Town submits its frames to WebGL. Browser checks of behaviour
 * (navigation, rooms, controls, focus, terminals) turn it off: the scene,
 * its frames and its counters stay the same, but test Chrome's software GPU
 * (SwiftShader) no longer paints every frame, which was most of a Town case's
 * time. Golden images, the frame budget and visual checks keep the pixels.
 * Release builds always draw.
 */
export function townPixelsEnabled() {
  return (
    !DEVTOOLS ||
    typeof window === "undefined" ||
    window.__HERDR_TOWN_PIXELS__ !== false
  );
}
