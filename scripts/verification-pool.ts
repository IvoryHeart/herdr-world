import assert from "node:assert/strict";

/** Fail fast, stop admission and await all started workers' cancellation/drain. */
export async function runVerificationPool<T, R>(
  items: readonly T[],
  workers: number,
  signal: AbortSignal,
  execute: (item: T, signal: AbortSignal) => Promise<R>,
) {
  assert(
    Number.isSafeInteger(workers) && workers >= 1 && workers <= 4,
    "Invalid verification worker count",
  );
  signal.throwIfAborted();
  const control = new AbortController();
  const combined = AbortSignal.any([signal, control.signal]);
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (!combined.aborted) {
        const index = cursor++;
        if (index >= items.length) return;
        try {
          results[index] = await execute(items[index]!, combined);
        } catch (error) {
          failure ??= error;
          control.abort(error);
        }
      }
    }),
  );
  if (failure !== undefined) throw failure;
  combined.throwIfAborted();
  assert.equal(cursor >= items.length, true, "Incomplete verification pool");
  return results;
}
