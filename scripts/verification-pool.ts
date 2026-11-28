import assert from "node:assert/strict";

/** Fail fast, stop admission and await all started workers' cancellation/drain. */
export async function runVerificationPool<T, R>(
  items: readonly T[],
  workers: number,
  signal: AbortSignal,
  execute: (item: T, signal: AbortSignal) => Promise<R>,
  withWorker?: (
    work: (signal?: AbortSignal) => Promise<void>,
    signal: AbortSignal,
  ) => Promise<void>,
  /** The next item starts only while the running items' weights plus its own
   * fit the budget; an item alone always starts. Items still start in order. */
  admission?: { weight: (item: T) => number; budget: number },
) {
  assert(
    Number.isSafeInteger(workers) && workers >= 1 && workers <= 4,
    "Invalid verification worker count",
  );
  if (admission)
    for (const item of items)
      assert(
        Number.isFinite(admission.weight(item)) &&
          admission.weight(item) > 0 &&
          admission.weight(item) <= admission.budget,
        "Item exceeds pool memory budget",
      );
  signal.throwIfAborted();
  const control = new AbortController();
  const combined = AbortSignal.any([signal, control.signal]);
  const results = new Array<R>(items.length);
  let cursor = 0;
  let failure: unknown;
  let running = 0;
  let used = 0;
  const waiting = new Set<() => void>();
  const fits = (item: T) =>
    !admission ||
    running === 0 ||
    used + admission.weight(item) <= admission.budget;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      const work = async (workerSignal = combined) => {
        while (!workerSignal.aborted) {
          if (cursor >= items.length) return;
          if (!fits(items[cursor]!)) {
            // Wake when a running item finishes or the pool stops.
            await new Promise<void>((resolve) => {
              const wake = () => {
                waiting.delete(wake);
                workerSignal.removeEventListener("abort", wake);
                resolve();
              };
              waiting.add(wake);
              workerSignal.addEventListener("abort", wake, { once: true });
            });
            continue;
          }
          const index = cursor++;
          const weight = admission?.weight(items[index]!) ?? 0;
          running++;
          used += weight;
          try {
            results[index] = await execute(items[index]!, workerSignal);
          } catch (error) {
            // Stop admission before the failed worker retires its resource.
            failure ??= error;
            control.abort(error);
            throw error;
          } finally {
            running--;
            used -= weight;
            for (const wake of [...waiting]) wake();
          }
        }
        workerSignal.throwIfAborted();
      };
      try {
        if (withWorker) await withWorker(work, combined);
        else await work();
      } catch (error) {
        failure ??= error;
        control.abort(error);
      }
    }),
  );
  if (failure !== undefined) throw failure;
  combined.throwIfAborted();
  assert.equal(cursor >= items.length, true, "Incomplete verification pool");
  return results;
}
