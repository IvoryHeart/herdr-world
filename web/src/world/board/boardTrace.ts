/**
 * Board's event trace for debugging: a bounded ring of what happened —
 * normalised input, gesture transitions, effects, frame reasons, saves and
 * errors — so a bug report can carry the exact sequence and become a test.
 * Off by default; on with `?debug=board` or the ⋯ menu.
 */

export type TraceEntry = { t: number; kind: string; detail?: unknown };

export type BoardTrace = {
  enabled: boolean;
  record(kind: string, detail?: unknown): void;
  entries(): readonly TraceEntry[];
  clear(): void;
  /** The trace as text for a bug report. */
  export(context: Record<string, unknown>): string;
  subscribe(listener: () => void): () => void;
};

export const TRACE_KEY = "herdr-world.board.trace";

export function createTrace(
  capacity = 400,
  now: () => number = () => performance.now(),
): BoardTrace {
  let ring: TraceEntry[] = [];
  const listeners = new Set<() => void>();
  const start = now();
  const trace: BoardTrace = {
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
      return JSON.stringify({ version: 1, context, entries: ring }, null, 1);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return trace;
}

/** Whether tracing starts on: the URL asks for it, or the user turned it on. */
export function traceRequested(search: string, stored: string | null) {
  return (
    new URLSearchParams(search).get("debug") === "board" || stored === "on"
  );
}
