export type BridgeHttpUrl = (path: string, query?: URLSearchParams) => string;

type PasswordPromptHandler = (origin: string) => Promise<string | null>;
type AuthenticatedFetchOptions = {
  timeoutMs?: number;
};

const bridgeSessions = new Map<string, string>();
const pendingPasswordPrompts = new Map<string, Promise<string | null>>();
const bridgeReauthenticationNeeded = new Set<string>();
let passwordPromptHandler: PasswordPromptHandler | null = null;

export class BridgeAuthenticationError extends Error {
  constructor(message = "Bridge password required or rejected") {
    super(message);
    this.name = "BridgeAuthenticationError";
  }
}

export class BridgeDiagnosticError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeDiagnosticError";
  }
}

export function setBridgePasswordPromptHandler(handler: PasswordPromptHandler | null) {
  passwordPromptHandler = handler;
}

export function clearBridgeSession(input: string | URL) {
  const origin = bridgeOrigin(input);
  if (origin) {
    bridgeSessions.delete(origin);
    bridgeReauthenticationNeeded.delete(origin);
  }
}

export function bridgeWebSocketProtocols(input: string | URL): string[] {
  const origin = bridgeOrigin(input);
  const token = origin ? bridgeSessions.get(origin) : undefined;
  return token ? [`herdr-world-auth.${token}`] : [];
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { timeoutMs }: AuthenticatedFetchOptions = {},
): Promise<Response> {
  const origin = bridgeOrigin(input);
  const first = await fetchWithSession(input, init, origin, timeoutMs);
  if (first.status !== 401 || !origin || isAuthenticationEndpoint(input)) {
    return first;
  }

  bridgeSessions.delete(origin);
  bridgeReauthenticationNeeded.add(origin);
  let prompt = pendingPasswordPrompts.get(origin);
  if (!prompt) {
    prompt = passwordPromptHandler ? passwordPromptHandler(origin) : Promise.resolve(null);
    pendingPasswordPrompts.set(origin, prompt);
  }
  const password = await prompt;
  pendingPasswordPrompts.delete(origin);
  if (password === null) {
    throw new BridgeAuthenticationError();
  }
  await authenticateBridge(origin, password, init.signal ?? undefined, timeoutMs);
  const retry = await fetchWithSession(input, init, origin, timeoutMs);
  if (retry.status === 401) {
    bridgeSessions.delete(origin);
    bridgeReauthenticationNeeded.add(origin);
    throw new BridgeAuthenticationError();
  }
  return retry;
}

/**
 * Check a session after a WebSocket reconnect. Browsers do not expose the
 * handshake's HTTP 401 to WebSocket clients, so a failed socket alone cannot
 * trigger the normal password prompt. The status endpoint lets us distinguish
 * an expired bridge session from a temporarily unavailable bridge.
 */
export async function refreshBridgeAuthentication(input: string | URL): Promise<boolean> {
  const origin = bridgeOrigin(input);
  if (!origin || (!bridgeSessions.has(origin) && !bridgeReauthenticationNeeded.has(origin))) {
    return false;
  }
  let response: Response;
  try {
    response = await fetchWithSession(`${origin}/api/auth/status`, {}, origin);
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const payload = (await response.json().catch(() => null)) as {
    required?: unknown;
    authenticated?: unknown;
  } | null;
  if (payload?.required !== true || payload.authenticated === true) {
    bridgeReauthenticationNeeded.delete(origin);
    return false;
  }

  bridgeSessions.delete(origin);
  bridgeReauthenticationNeeded.add(origin);
  let prompt = pendingPasswordPrompts.get(origin);
  if (!prompt) {
    prompt = passwordPromptHandler ? passwordPromptHandler(origin) : Promise.resolve(null);
    pendingPasswordPrompts.set(origin, prompt);
  }
  const password = await prompt;
  pendingPasswordPrompts.delete(origin);
  if (password === null) throw new BridgeAuthenticationError();
  await authenticateBridge(origin, password);
  bridgeReauthenticationNeeded.delete(origin);
  return true;
}

async function fetchWithSession(
  input: RequestInfo | URL,
  init: RequestInit,
  origin: string | null,
  timeoutMs?: number,
) {
  const headers = new Headers(init.headers);
  const token = origin ? bridgeSessions.get(origin) : undefined;
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (timeoutMs === undefined) return fetch(input, { ...init, headers });

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) {
    abortFromCaller();
  } else {
    init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timer = globalThis.setTimeout(() => {
    controller.abort(abortError());
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, headers, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function abortError() {
  return typeof DOMException === "function"
    ? new DOMException("Bridge request timed out", "AbortError")
    : undefined;
}

async function authenticateBridge(
  origin: string,
  password: string,
  callerSignal?: AbortSignal,
  timeoutMs?: number,
) {
  if (new TextEncoder().encode(password).length > 1024) {
    throw new BridgeAuthenticationError("Bridge password is too long");
  }
  let response: Response;
  try {
    response = await fetchWithSession(`${origin}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
      signal: callerSignal,
    }, null, timeoutMs ?? 5000);
  } catch {
    throw new BridgeAuthenticationError("Bridge authentication is unavailable");
  } finally {
    password = "";
  }
  if (!response.ok) {
    throw new BridgeAuthenticationError(
      response.status === 429 ? "Too many bridge password attempts; retry shortly" : undefined,
    );
  }
  const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
  if (!payload || typeof payload.token !== "string" || payload.token.length < 32) {
    throw new BridgeAuthenticationError("Bridge authentication response is invalid");
  }
  bridgeSessions.set(origin, payload.token);
}

function bridgeOrigin(input: string | URL | RequestInfo): string | null {
  try {
    const url = typeof Request !== "undefined" && input instanceof Request
      ? new URL(input.url)
      : new URL(String(input), globalThis.location?.origin ?? "http://localhost");
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

function isAuthenticationEndpoint(input: RequestInfo | URL) {
  try {
    const value = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    return new URL(value, globalThis.location?.origin ?? "http://localhost").pathname.startsWith("/api/auth/");
  } catch {
    return false;
  }
}

export async function apiErrorMessage(response: Response): Promise<string | null> {
  try {
    const parsed = (await response.json()) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
  } catch {
    // Fall through to the status-based error.
  }
  return null;
}
