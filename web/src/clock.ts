/** Time belongs to an injected port. The default delegates to this page. */
export interface Clock {
  now(): number;
  monotonic(): number;
  setTimeout(callback: () => void, delay?: number): number;
  clearTimeout(timer: number | undefined): void;
  setInterval(callback: () => void, delay?: number): number;
  clearInterval(timer: number | undefined): void;
  requestAnimationFrame: typeof globalThis.requestAnimationFrame;
  cancelAnimationFrame: typeof globalThis.cancelAnimationFrame;
}

const native: Clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  setTimeout: (callback, delay) =>
    globalThis.setTimeout(callback, delay) as unknown as number,
  clearTimeout: (timer) =>
    (globalThis.clearTimeout as (timer: unknown) => void)(timer),
  setInterval: (callback, delay) =>
    globalThis.setInterval(callback, delay) as unknown as number,
  clearInterval: (timer) =>
    (globalThis.clearInterval as (timer: unknown) => void)(timer),
  requestAnimationFrame: (callback) =>
    globalThis.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => globalThis.cancelAnimationFrame(id),
};
let current = native;
export const clock: Clock = {
  now: () => current.now(),
  monotonic: () => current.monotonic(),
  setTimeout: (...args) => current.setTimeout(...args),
  clearTimeout: (...args) => current.clearTimeout(...args),
  setInterval: (...args) => current.setInterval(...args),
  clearInterval: (...args) => current.clearInterval(...args),
  requestAnimationFrame: (callback) => current.requestAnimationFrame(callback),
  cancelAnimationFrame: (id) => current.cancelAnimationFrame(id),
};

/** @internal Install at composition/test setup, restoring the prior owner on cleanup. */
export function injectClock(replacement: Partial<Clock>): () => void {
  const previous = current;
  current = { ...previous, ...replacement };
  return () => {
    current = previous;
  };
}
