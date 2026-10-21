import { DEVTOOLS } from "./flag";

declare global {
  interface Window {
    /** Set by browser fixtures; `"counters"` collects counters only. */
    __HERDR_WORLD_RENDERER_DEBUG__?: boolean | "counters";
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
