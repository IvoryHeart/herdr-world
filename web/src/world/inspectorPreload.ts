/**
 * The Inspector window's code and styles, shared by its lazy component and
 * by views that expect an open soon (an open Needs you list), so opening
 * Chat from them shows no loading shell and loads no stylesheet mid-view.
 */
export const loadWorkspaceInspector = () =>
  import("../components/WorkspaceInspectorHost");

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
