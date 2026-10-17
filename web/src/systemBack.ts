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
// Pairs guards with the page entry below them, so a leftover guard reached by
// Forward can continue Forward instead of returning to that page.
const BASE = "herdrBackBase";
const layers = new Set<Layer>();
let openings = 0;
let bases = 0;
let previousState: unknown;
// Set while continuing Forward past a leftover guard; if Forward could not
// move, the next Back also skips the paired page entry, which looks the same.
let forwardBase: string | undefined;
// Whether a layer closed since the last reconcile other than by unmounting.
let closedOnScreen = false;
let reconcileScheduled = false;
// history.back() is asynchronous; until our own Back lands, the current entry
// is stale and a popstate is ours, not the user's.
let backPending = false;

function isGuard(state: unknown) {
  return typeof state === "object" && state !== null && GUARD in state;
}

/**
 * How many guard entries sit above the page's own entry. Each open layer has
 * one, pushed when it opens, so the user's Back consumes one guard per layer
 * and never has to push another: browsers skip history entries a page adds
 * without a user gesture (Chrome's back-button intervention), and a guard
 * re-pushed while handling Back would make the next Back skip the page.
 */
function baseId(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !(BASE in state)) return;
  const value = (state as Record<string, unknown>)[BASE];
  return typeof value === "string" ? value : undefined;
}

function guardDepth(state: unknown) {
  if (!isGuard(state)) return 0;
  const depth = (state as Record<string, unknown>)[GUARD];
  return typeof depth === "number" && depth > 0 ? depth : 1;
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
  const depth = guardDepth(window.history.state);
  if (layers.size > 0) forwardBase = undefined;
  if (layers.size > depth) {
    const state: unknown = window.history.state;
    let base: Record<string, unknown>;
    if (depth === 0) {
      base = {
        ...(typeof state === "object" && state ? state : {}),
        [BASE]: `${Date.now()}:${++bases}`,
      };
      window.history.replaceState(base, "");
    } else base = { ...(state as Record<string, unknown>) };
    for (let next = depth + 1; next <= layers.size; next += 1)
      window.history.pushState({ ...base, [GUARD]: next }, "");
    previousState = window.history.state;
  } else if (layers.size < depth && closedOnScreen) {
    // Layers closed on screen take their guards with them.
    backPending = true;
    window.history.go(layers.size - depth);
  }
  closedOnScreen = false;
}

if (typeof window !== "undefined") {
  previousState = window.history.state;
  window.addEventListener("popstate", (event) => {
    const from = previousState;
    previousState = event.state;
    if (backPending) {
      backPending = false;
      reconcile();
      return;
    }
    if (forwardBase !== undefined) {
      const id = forwardBase;
      forwardBase = undefined;
      if (
        layers.size === 0 &&
        !isGuard(event.state) &&
        baseId(event.state) === id
      ) {
        backPending = true;
        window.history.back();
        return;
      }
    }
    const depth = guardDepth(event.state);
    if (layers.size === 0) {
      if (depth === 0) return;
      // A leftover guard with nothing open, for example one left below a
      // route opened from a layer. Keep moving the way the user went:
      // Forward from its page (or a lower guard) continues Forward; Back
      // returns to the page's own entry.
      const id = baseId(event.state);
      if (id !== undefined && baseId(from) === id && guardDepth(from) < depth) {
        forwardBase = id;
        window.history.forward();
        return;
      }
      backPending = true;
      window.history.go(-depth);
      return;
    }
    if (layers.size <= depth) {
      // Forward onto a guard: nothing to close.
      scheduleReconcile();
      return;
    }
    // The user's Back consumed guards: close as many top layers.
    while (layers.size > depth) {
      let top: Layer | undefined;
      for (const layer of layers)
        if (
          !top ||
          layer.level > top.level ||
          (layer.level === top.level && layer.order > top.order)
        )
          top = layer;
      layers.delete(top!);
      top!.close();
    }
    scheduleReconcile();
  });
}

/**
 * Takes the same step as the phone's Back while layers are open: closes the
 * topmost one through history. Returns false when there is nothing to close.
 */
export function stepBack(): boolean {
  if (
    layers.size === 0 ||
    backPending ||
    guardDepth(window.history.state) === 0
  )
    return false;
  window.history.back();
  return true;
}

/**
 * Adds a route entry. A guard left by a layer is replaced rather than kept
 * below the route, so Back from the route reaches the page before it.
 */
export function pushRoute(state: Record<string, unknown>, url: URL) {
  if (isGuard(window.history.state))
    window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
  previousState = window.history.state;
  scheduleReconcile();
}
