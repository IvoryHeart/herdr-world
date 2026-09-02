import { authenticatedFetch } from "./bridgeApi";

export const BRIDGE_FETCH_TIMEOUT_MS = 5000;

export type FetchWithTimeoutInit = RequestInit & {
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  { timeoutMs = BRIDGE_FETCH_TIMEOUT_MS, signal, ...init }: FetchWithTimeoutInit = {},
) {
  const controller = new AbortController();
  const abortFromCaller = () => {
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    controller.abort(abortError());
  }, timeoutMs);
  try {
    return await authenticatedFetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

function abortError() {
  return typeof DOMException === "function"
    ? new DOMException("Bridge request timed out", "AbortError")
    : undefined;
}
