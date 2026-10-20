/**
 * A view's event trace for debugging: a bounded ring of what happened, so a
 * bug report can carry the exact sequence and become a test. Board records
 * normalised input, gesture transitions, effects, frame reasons, saves and
 * errors; Town records taps, peeks, moves and renderer errors. Records stay
 * in the page and leave it only when the user copies them.
 *
 * Development builds only: views reach this module through `DEVTOOLS` (see
 * flag.ts), so release builds contain none of it. Off by default; on with
 * `?debug=<view>` or the view's menu.
 */

import { worldLocalStorage } from "../../browserStorage";
import type { GestureEffect, GestureEvent } from "../interaction/gesture";
import type { TraceEntry, ViewTrace } from "./flag";

export type TracedView = "board" | "town";

/** Marks this module in a bundle; the release asset check looks for it. */
export const DEVTOOLS_MARKER = "herdr-world-devtools";

/** Where a view remembers that its trace is on (Board's key predates Town's). */
export const traceKey = (view: TracedView) => `herdr-world.${view}.trace`;

export function createTrace(
  view: TracedView,
  capacity = 400,
  now: () => number = () => performance.now(),
): ViewTrace {
  let ring: TraceEntry[] = [];
  const listeners = new Set<() => void>();
  const start = now();
  const trace: ViewTrace = {
    enabled: false,
    record(kind, detail) {
      if (!trace.enabled) return;
      ring.push({ t: Math.round(now() - start), kind, detail });
      if (ring.length > capacity) ring = ring.slice(-capacity);
      for (const listener of listeners) listener();
    },
    entries: () => ring,
    clear() {
      ring = [];
      for (const listener of listeners) listener();
    },
    export(context) {
      return JSON.stringify(
        { version: 1, tool: DEVTOOLS_MARKER, view, context, entries: ring },
        null,
        1,
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return trace;
}

/** Whether a view's trace starts on: the URL asks for it, or the user did. */
export function traceRequested(
  view: TracedView,
  search: string,
  stored: string | null,
) {
  return new URLSearchParams(search).get("debug") === view || stored === "on";
}

/** A view's trace, on when the URL or the remembered choice says so. */
export function openTrace(view: TracedView): ViewTrace {
  const trace = createTrace(view);
  let stored: string | null = null;
  try {
    stored = worldLocalStorage.getItem(traceKey(view));
  } catch {
    // Storage unavailable: only the URL can turn tracing on.
  }
  trace.enabled = traceRequested(view, window.location.search, stored);
  return trace;
}

/** Turn a view's trace on or off, and remember the choice. */
export function rememberTrace(view: TracedView, trace: ViewTrace, on: boolean) {
  trace.enabled = on;
  if (!on) trace.clear();
  try {
    worldLocalStorage.setItem(traceKey(view), on ? "on" : "off");
  } catch {
    // Storage unavailable: the choice lasts for this page.
  }
}

/** Asks a view to turn its trace on or off (from the common settings menu). */
export const TRACE_TOGGLE_EVENT = "herdr-world:trace-toggle";

/** Whether a view's trace is remembered as on. */
export function traceRemembered(view: TracedView) {
  try {
    return worldLocalStorage.getItem(traceKey(view)) === "on";
  } catch {
    return false;
  }
}

/** Turn a view's trace on or off from outside the view. */
export function requestTrace(view: TracedView, on: boolean) {
  try {
    worldLocalStorage.setItem(traceKey(view), on ? "on" : "off");
  } catch {
    // Storage unavailable: the open view still hears the request.
  }
  window.dispatchEvent(
    new CustomEvent(TRACE_TOGGLE_EVENT, { detail: { view, on } }),
  );
}

/** Continuous gesture effects a trace leaves out: one per pointer move. */
const QUIET_EFFECTS = new Set([
  "panBy",
  "moveCard",
  "moveString",
  "pinch",
  "moveHost",
  "stopCamera",
]);

/**
 * Record one step of a view's gesture machine: its input (not every move),
 * a mode transition, and its effects other than the continuous ones, so a
 * failed gesture can be replayed. A view whose targets are live objects
 * passes describe() to record a summary of each target instead.
 */
export function traceGesture<T>(
  trace: ViewTrace,
  before: string,
  after: string,
  event: GestureEvent<T>,
  effects: readonly GestureEffect<T>[],
  describe?: (target: T) => unknown,
) {
  if (!trace.enabled) return;
  const summary = (value: object) =>
    describe && "target" in value
      ? { ...value, target: describe(value.target as T) }
      : value;
  if (event.type !== "move") trace.record("input", summary(event));
  if (after !== before) trace.record("gesture", `${before} → ${after}`);
  for (const effect of effects)
    if (!QUIET_EFFECTS.has(effect.type))
      trace.record("effect", summary(effect));
}
