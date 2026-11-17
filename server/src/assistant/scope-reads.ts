const MAX_SCOPE_READS = 8;

/** Keep admission reads bounded, ordered and fail-closed without queued work escaping. */
export async function mapScopeReads<T, R>(
  items: readonly T[],
  read: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (!controller.signal.aborted && next < items.length) {
      const index = next++;
      try {
        results[index] = await read(items[index]!, index, controller.signal);
      } catch (error) {
        // Preserve the first failure and stop every leased read and queued item.
        controller.abort(error);
      }
    }
  }
  try {
    // Only these fixed workers are concurrent. Leased reads stop promptly on
    // abort; uncancellable transport calls are still bounded by this limit.
    await Promise.all(
      Array.from({ length: Math.min(MAX_SCOPE_READS, items.length) }, worker),
    );
    controller.signal.throwIfAborted();
    return results;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
