import type { WorkspaceInspectorHost as Host } from "../components/WorkspaceInspectorHost";

type Loader = () => Promise<unknown>;

let loader: Loader | null = null;
let loaded: typeof Host | null = null;

/**
 * The Inspector window registers how it loads its code and styles, so views
 * that expect an open soon (an open Needs you list) can fetch them early
 * without importing the Inspector's module graph themselves.
 */
export function registerWorkspaceInspectorLoader(load: Loader) {
  loader = load;
}

/** Recorded by the loader once the Inspector's code is at hand. */
export function workspaceInspectorLoaded(host: typeof Host) {
  loaded = host;
}

/**
 * The Inspector once its code has loaded: a window opened after that renders
 * it directly instead of through the lazy component, which would show its
 * loading shell for a frame even with the code at hand.
 */
export const loadedWorkspaceInspector = () => loaded;

/**
 * Fetch the Inspector when the browser is idle, if the Inspector window is
 * part of this page; a failure retries on open.
 */
export function preloadWorkspaceInspector(): () => void {
  const load = () => void loader?.().catch(() => {});
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(load, { timeout: 2_000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(load, 200);
  return () => clearTimeout(id);
}
