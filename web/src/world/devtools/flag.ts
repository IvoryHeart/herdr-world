/**
 * Whether this build carries World's development tools: the per-view event
 * trace, its overlay and the renderer counters. Vite defines
 * `__HERDR_WORLD_DEVTOOLS__` as false for release builds (see vite.config.ts),
 * so every `DEVTOOLS && …` branch, and the devtools modules it alone reaches,
 * drop out of the shipped bundle. Builds that do not define it (development,
 * the browser fixtures, unit tests) keep the tools.
 *
 * This is the only devtools file a release build contains.
 */
// Declared here as well as in vite-env.d.ts: World modules that use DEVTOOLS
// are also compiled by projects without the Vite types (scripts, quint).
declare const __HERDR_WORLD_DEVTOOLS__: boolean | undefined;

export const DEVTOOLS: boolean =
  typeof __HERDR_WORLD_DEVTOOLS__ === "undefined"
    ? true
    : __HERDR_WORLD_DEVTOOLS__;

export type TraceEntry = { t: number; kind: string; detail?: unknown };

/** A view's event trace; in a release build, the inert one below. */
export type ViewTrace = {
  enabled: boolean;
  record(kind: string, detail?: unknown): void;
  entries(): readonly TraceEntry[];
  clear(): void;
  /** The trace as text for a bug report. */
  export(context: Record<string, unknown>): string;
  subscribe(listener: () => void): () => void;
};

/** A trace that records nothing, for release builds. */
export const NO_TRACE: ViewTrace = {
  enabled: false,
  record() {},
  entries: () => [],
  clear() {},
  export: () => "",
  subscribe: () => () => {},
};
