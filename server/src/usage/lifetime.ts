/** One deadline and cancellation owner for the complete usage operation. */
export function usageScope(parent?: AbortSignal, timeoutMs = 20_000) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Usage collection cancelled"));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    abort,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
