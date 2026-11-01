import type { WorkspaceInspectorHost as Host } from "../components/WorkspaceInspectorHost";

let loaded: typeof Host | null = null;

/**
 * The Inspector window's code and styles, shared by its lazy component and
 * by views that expect an open soon (an open Needs you list), so opening
 * Chat from them shows no loading shell and loads no stylesheet mid-view.
 */
export const loadWorkspaceInspector = () =>
  import("../components/WorkspaceInspectorHost").then((module) => {
    loaded = module.WorkspaceInspectorHost;
    return module;
  });

/**
 * The Inspector once its code has loaded: a window opened after that renders
 * it directly instead of through the lazy component, which would show its
 * loading shell for a frame even with the code at hand.
 */
export const loadedWorkspaceInspector = () => loaded;

/** Fetch the Inspector when the browser is idle; a failure retries on open. */
export function preloadWorkspaceInspector(): () => void {
  const load = () => void loadWorkspaceInspector().catch(() => {});
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(load, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(load, 200);
  return () => clearTimeout(id);
}
