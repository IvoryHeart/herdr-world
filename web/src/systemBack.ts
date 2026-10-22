import { useEffect, useRef } from "react";
import { useLayoutPreferences } from "./layoutPreferences";

/**
 * Phone Back closes popups, then nested navigation, then panels and terminal screens.
 * Equal levels close newest first.
 */
export type SystemBackLevel = "screen" | "panel" | "navigation" | "popup";
const LEVELS: Record<SystemBackLevel, number> = {
  screen: 0,
  panel: 1,
  navigation: 2,
  popup: 3,
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
  useEffect(() => {
    if (!mobile) {
      closedOnScreen = true;
      scheduleReconcile();
    }
  }, [mobile]);
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
let leaving = false;
let reconcileScheduled = false;
// history.back() is asynchronous; until our own Back lands, the current entry
// is stale and a popstate is ours, not the user's.
let backPending = false;
// A route pushed while our Back is in flight; the traversal would undo it, so
// it is pushed when the traversal lands.
let deferredRoute: { state: Record<string, unknown>; url: URL } | null = null;

let ownBackTimer: ReturnType<typeof setTimeout> | undefined;
// A traversal that cannot move fires no popstate; stop waiting for it after
// this long, so later routes and guards are not held back forever.
const OWN_BACK_TIMEOUT_MS = 1_000;

function goOwnBack(delta: number) {
  backPending = true;
  clearTimeout(ownBackTimer);
  ownBackTimer = setTimeout(() => {
    if (backPending) landOwnBack();
  }, OWN_BACK_TIMEOUT_MS);
  window.history.go(delta);
}

/** Our traversal landed (or never will): push a deferred route, reconcile. */
function landOwnBack() {
  clearTimeout(ownBackTimer);
  backPending = false;
  const route = deferredRoute;
  deferredRoute = null;
  // The page may have returned to where it is since the route was chosen.
  if (route && route.url.pathname !== window.location.pathname)
    pushRoute(route.state, route.url);
  previousState = window.history.state;
  reconcile();
}

/** Whether a Back of our own is still traversing history. */
export function isBackPending() {
  return backPending;
}

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
  if (backPending || leaving) return;
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
    goOwnBack(layers.size - depth);
  }
  closedOnScreen = false;
}

if (typeof window !== "undefined") {
  previousState = window.history.state;
  if (isGuard(previousState)) {
    closedOnScreen = true;
    scheduleReconcile();
  }
  window.addEventListener("pagehide", () => {
    leaving = true;
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
    closedOnScreen = true;
    scheduleReconcile();
  });
  window.addEventListener("popstate", (event) => {
    const from = previousState;
    previousState = event.state;
    if (backPending) {
      // Pushed before other popstate listeners read the location.
      landOwnBack();
      return;
    }
    // Direction within one guard run: a higher guard of the same pair means
    // Forward; anything else (a lower entry, or arriving from a route above
    // the run) means Back.
    const id = baseId(event.state);
    const depth = guardDepth(event.state);
    const samePair = id !== undefined && baseId(from) === id;
    const forward = samePair && depth > guardDepth(from);
    if (forwardBase !== id) forwardBase = undefined;
    if (layers.size === 0) {
      if (forward && depth > 0) {
        // Continue Forward past the leftover guards, toward any route above.
        forwardBase = id;
        window.history.forward();
        return;
      }
      if (forwardBase !== undefined && samePair) {
        // Forward ended inside the run and the user went Back: skip the rest
        // of the run and its page, which all look alike, in one press.
        forwardBase = undefined;
        goOwnBack(-(depth + 1));
        return;
      }
      forwardBase = undefined;
      // A leftover guard reached going Back returns to its page.
      if (depth > 0) {
        goOwnBack(-depth);
      }
      return;
    }
    forwardBase = undefined;
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
  if (backPending) {
    deferredRoute = { state, url };
    return;
  }
  if (isGuard(window.history.state))
    window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
  previousState = window.history.state;
  // A route replaces any leftover guard the user had moved Forward onto.
  forwardBase = undefined;
  scheduleReconcile();
}
