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
 *
 * @internal Exported for the timing tests; production code calls `timing`.
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
  /** Ranger's durable storage retries a held lock this often... */
  durableLockRetryMs: 100,
  /** ...for this long, then reports that the storage already has an owner. */
  durableLockWaitMs: 12_000,
  /** A live owner renews its durable storage lock this often. */
  durableLockRenewMs: 2_000,
  /** A lock not renewed for this long belongs to a crashed owner. */
  durableLockStaleMs: 10_000,
  /** Browser-local creation waits this long for its source terminal. */
  creationPreparationMs: 20_000,
} as const;

export type TimingName = keyof typeof PRODUCTION_TIMINGS;
/** @internal */
export type Timings = { readonly [name in TimingName]: number };

/** @internal Orders every timing set keeps: `[shorter, longer]`. */
export const TIMING_ORDER: readonly (readonly [TimingName, TimingName])[] = [
  // A failed read keeps the last list for a few reads, so items do not flicker.
  ["askPeerPollMs", "askPeerGraceMs"],
  // A live owner's lock never looks stale; a crashed one's is taken over
  // before the wait gives up.
  ["durableLockRenewMs", "durableLockStaleMs"],
  ["durableLockStaleMs", "durableLockWaitMs"],
  ["durableLockRetryMs", "durableLockWaitMs"],
];

/**
 * @internal
 * Test values that cannot be a few milliseconds: a library refuses less
 * (proper-lockfile clamps `stale` to at least 2 s and `update` to at least
 * 1 s), or an order above such a minimum needs more.
 */
export const TIMING_FLOORS: { readonly [name in TimingName]?: number } = {
  durableLockRenewMs: 1_000,
  durableLockStaleMs: 2_000,
  // Outlasts the stale floor, so a crashed owner's lock is taken over.
  durableLockWaitMs: 2_500,
};

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
