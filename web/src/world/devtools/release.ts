/**
 * What release builds get in place of trace.ts and TraceOverlay.tsx: the same
 * names, doing nothing. vite.config.ts aliases both modules here unless
 * development tools are enabled, so no instrumentation code ships even when
 * several views import it. Must not contain the devtools marker.
 */
import type { ViewTrace } from "./flag";
import { NO_TRACE } from "./flag";

export type TracedView = "board" | "town";
export const TRACE_TOGGLE_EVENT = "";
export const traceKey: (view: TracedView) => string = () => "";
export const openTrace: (view: TracedView) => ViewTrace = () => NO_TRACE;
export const rememberTrace: (
  view: TracedView,
  trace: ViewTrace,
  on: boolean,
) => void = () => {};
export const traceRemembered: (view: TracedView) => boolean = () => false;
export const requestTrace: (view: TracedView, on: boolean) => void = () => {};
export const TraceOverlay: (props: unknown) => null = () => null;
export const traceGesture: (...args: unknown[]) => void = () => {};
