/**
 * The browser's one clock: production code reads time and schedules work only
 * through it (AGENTS.md), never through `Date.now`, `performance.now`,
 * `setTimeout`, `setInterval` or `requestAnimationFrame` directly. Each call
 * resolves the page's timers when it runs, so a test clock installed on the
 * page (`world/testing/testClock.ts`) drives every caller, and a unit test can
 * substitute its own with `setClockForTests`.
 */
export type WebClock = {
  /** Milliseconds since the epoch: timestamps and persisted deadlines. */
  now(): number;
  /** Milliseconds from an arbitrary origin: durations and in-page waits. */
  monotonic(): number;
  setTimeout(callback: () => void, delayMs?: number): number;
  clearTimeout(id: number | undefined): void;
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(id: number | undefined): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number | undefined): void;
};

const page: WebClock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
  setInterval: (callback, delayMs) =>
    globalThis.setInterval(callback, delayMs) as unknown as number,
  clearInterval: (id) => globalThis.clearInterval(id),
  requestAnimationFrame: (callback) =>
    globalThis.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => {
    if (id !== undefined) globalThis.cancelAnimationFrame(id);
  },
};

let current: WebClock = page;

/** Delegates to the installed clock at call time. */
export const clock: WebClock = {
  now: () => current.now(),
  monotonic: () => current.monotonic(),
  setTimeout: (callback, delayMs) => current.setTimeout(callback, delayMs),
  clearTimeout: (id) => current.clearTimeout(id),
  setInterval: (callback, delayMs) => current.setInterval(callback, delayMs),
  clearInterval: (id) => current.clearInterval(id),
  requestAnimationFrame: (callback) => current.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => current.cancelAnimationFrame(id),
};

/** Replace parts of the clock; returns the restore. @internal */
export function setClockForTests(replacement: Partial<WebClock>) {
  const previous = current;
  current = { ...previous, ...replacement };
  return () => {
    current = previous;
  };
}
