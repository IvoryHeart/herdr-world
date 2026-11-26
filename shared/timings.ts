/**
 * Product timer durations (#1419): one table for every timer the service and
 * the browser run (reads, re-reads, deadlines, debounce, backoff, heartbeats).
 *
 * Production code reads a duration with `timing(name)` each time it arms a
 * timer, never a copy taken at import. Tests run the same real timers with
 * the test set in `shared/testing/timings.ts`, where every duration is a few
 * milliseconds and every order below still holds. Only test code and the test
 * service launcher may switch the set (`check:test-waits` enforces it); no
 * build, setting or URL can.
 *
 * Bounds that only fire when something fails (request timeouts) are not
 * waits a test takes and stay with their callers.
 */
export const PRODUCTION_TIMINGS = {
  /** A sibling World reads the open questions of homes on its runtimes. */
  askPeerPollMs: 5_000,
  /** After a failed sibling read, the last good list stays this long. */
  askPeerGraceMs: 15_000,
  /**
   * An offline connection-registry edit or World startup waits this long for
   * another process's ownership before it reports busy.
   */
  registryBusyWaitMs: 5_000,
  /** Browser-local creation waits this long for its source terminal. */
  creationPreparationMs: 20_000,
} as const;

export type TimingName = keyof typeof PRODUCTION_TIMINGS;
export type Timings = { readonly [name in TimingName]: number };

/** Orders every timing set keeps: `[shorter, longer]`. */
export const TIMING_ORDER: readonly (readonly [TimingName, TimingName])[] = [
  // A failed read keeps the last list for a few reads, so items do not flicker.
  ["askPeerPollMs", "askPeerGraceMs"],
];

let active: Timings = PRODUCTION_TIMINGS;

/** The duration a product timer arms now. */
export function timing(name: TimingName): number {
  return active[name];
}

/**
 * @internal Test code only: switches every timer to `set`, or back to the
 * production values with `null`. Use `useTestTimings()` from
 * `shared/testing/timings.ts`.
 */
export function setTimingsForTests(set: Timings | null) {
  active = set ?? PRODUCTION_TIMINGS;
}
