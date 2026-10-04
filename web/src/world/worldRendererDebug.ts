import { officeDebugEnabled } from "../officeDebug";

declare global {
  interface Window {
    __HERDR_WORLD_RENDERER_DEBUG__?: boolean | "counters";
  }
}

export function worldRendererDebugEnabled() {
  return (
    typeof window !== "undefined" &&
    (window.__HERDR_WORLD_RENDERER_DEBUG__ === true || officeDebugEnabled())
  );
}

export function worldRendererCountersEnabled() {
  return (
    typeof window !== "undefined" &&
    (window.__HERDR_WORLD_RENDERER_DEBUG__ === "counters" ||
      worldRendererDebugEnabled())
  );
}
