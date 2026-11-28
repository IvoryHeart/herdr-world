/**
 * Time and deferred work, with no imports: the SQLite storage worker loads this
 * module, and every module it pulls in is parsed again by each worker start.
 */

/** Time for everything the composition root constructs. */
export type Clock = {
  /** Milliseconds since the epoch: timestamps and persisted deadlines. */
  now(): number;
  /** Milliseconds from an arbitrary origin: durations and in-process waits. */
  monotonic(): number;
};

/**
 * Deferred work. A durable deadline is persisted wall time: schedule
 * `min(60_000, max(0, deadline - clock.now()))` and re-arm on each wake until
 * `clock.now() >= deadline`. Timers stop while the machine sleeps; the cap
 * bounds lateness to 60 s.
 */
export type Scheduler = {
  schedule(
    callback: () => void,
    delayMs: number,
  ): { cancel(): void; unref?(): void };
};

/** Yield to native input/I/O without waiting for elapsed fixture time. */
export type TaskTurn = () => Promise<void>;
export const systemTaskTurn: TaskTurn = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

export const systemClock: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
};

export const systemScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(timer), unref: () => timer.unref() };
  },
};
