import { useEffect, useRef } from "react";
import { useLayoutPreferences } from "./layoutPreferences";

/**
 * How a layer stacks for the phone's Back: a screen (a terminal) sits below
 * a panel (Composer, workspace list), which sits below a popup (menu, sheet).
 * Back closes the highest open layer; equal levels close newest first.
 */
export type SystemBackLevel = "screen" | "panel" | "popup";
const LEVELS: Record<SystemBackLevel, number> = {
  screen: 0,
  panel: 1,
  popup: 2,
};

type Layer = { level: number; order: number; close: () => void };

/**
 * Lets the phone's Back gesture or button close an open mobile layer before
 * it leaves the page. While any layer is open, the current history entry is
 * one guard entry at the current URL. Back pops it and closes only the top
 * layer; the guard returns while layers remain. When the last layer closes
 * on screen, the guard is removed again, so the next Back leaves the page's
 * route in one press.
 */
export function useSystemBack(
  open: boolean,
  close: () => void,
  level: SystemBackLevel,
) {
  const { mobile } = useLayoutPreferences();
  const closeRef = useRef(close);
  closeRef.current = close;
  const active = mobile && open;
  // Declared first so its cleanup runs first: unmounting the app is not the
  // user closing a layer, and must not move history on its own.
  const unmounting = useRef(false);
  useEffect(() => {
    unmounting.current = false;
    return () => {
      unmounting.current = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const layer: Layer = {
      level: LEVELS[level],
      order: ++openings,
      close: () => closeRef.current(),
    };
    layers.add(layer);
    scheduleReconcile();
    return () => {
      layers.delete(layer);
      if (!unmounting.current) closedOnScreen = true;
      scheduleReconcile();
    };
  }, [active, level]);
}

const GUARD = "herdrBack";
const layers = new Set<Layer>();
let openings = 0;
// Whether a layer closed since the last reconcile other than by unmounting.
let closedOnScreen = false;
let reconcileScheduled = false;
// history.back() is asynchronous; until our own Back lands, the current entry
// is stale and a popstate is ours, not the user's.
let backPending = false;

function isGuard(state: unknown) {
  return typeof state === "object" && state !== null && GUARD in state;
}

// Effects of one React commit run together; reconcile once after all of them,
// so layers that open and close in the same commit settle as one change.
function scheduleReconcile() {
  if (reconcileScheduled) return;
  reconcileScheduled = true;
  queueMicrotask(reconcile);
}

function reconcile() {
  reconcileScheduled = false;
  if (backPending) return;
  const guarded = isGuard(window.history.state);
  if (layers.size > 0 && !guarded) {
    const base: unknown = window.history.state;
    window.history.pushState(
      { ...(typeof base === "object" && base ? base : {}), [GUARD]: true },
      "",
    );
  } else if (layers.size === 0 && guarded && closedOnScreen) {
    backPending = true;
    window.history.back();
  }
  closedOnScreen = false;
}

if (typeof window !== "undefined")
  window.addEventListener("popstate", (event) => {
    if (backPending) {
      backPending = false;
      reconcile();
      return;
    }
    // Forward onto a guard, or Back with nothing open: settle the entry.
    if (isGuard(event.state) || layers.size === 0) {
      scheduleReconcile();
      return;
    }
    let top: Layer | undefined;
    for (const layer of layers)
      if (
        !top ||
        layer.level > top.level ||
        (layer.level === top.level && layer.order > top.order)
      )
        top = layer;
    // The user's Back already removed the guard: nothing to undo.
    layers.delete(top!);
    top!.close();
    scheduleReconcile();
  });

/**
 * Adds a route entry. A guard left by a layer is replaced rather than kept
 * below the route, so Back from the route reaches the page before it.
 */
export function pushRoute(state: Record<string, unknown>, url: URL) {
  if (isGuard(window.history.state))
    window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
  scheduleReconcile();
}
