import { authenticatedFetch } from "./bridgeApi";

export const BRIDGE_FETCH_TIMEOUT_MS = 5000;

export type FetchWithTimeoutInit = RequestInit & {
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  { timeoutMs = BRIDGE_FETCH_TIMEOUT_MS, ...init }: FetchWithTimeoutInit = {},
) {
  return authenticatedFetch(input, init, { timeoutMs });
}
