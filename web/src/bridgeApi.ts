export type BridgeHttpUrl = (path: string, query?: URLSearchParams) => string;

type PasswordPromptHandler = (origin: string) => Promise<string | null>;
type AuthenticatedFetchOptions = {
  timeoutMs?: number;
};
type BridgeSessionSnapshot = {
  token: string | undefined;
  generation: number;
};
type SessionFetchResult = {
  response: Response;
  session: BridgeSessionSnapshot | null;
};

const bridgeSessions = new Map<string, string>();
const bridgeSessionGenerations = new Map<string, number>();
const pendingAuthentications = new Map<string, Promise<void>>();
const bridgeReauthenticationNeeded = new Set<string>();
const bridgeSessionStoragePrefix = "herdrWeb.bridgeSession.v1:";
let passwordPromptHandler: PasswordPromptHandler | null = null;

export class BridgeAuthenticationError extends Error {
  constructor(message = "Password required or rejected by this Herdr") {
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
    forgetBridgeSession(origin);
    bridgeReauthenticationNeeded.delete(origin);
  }
}

export function bridgeWebSocketProtocols(input: string | URL): string[] {
  const origin = bridgeOrigin(input);
  const token = origin ? bridgeSession(origin) : undefined;
  return token ? [`herdr-world-auth.${token}`] : [];
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  { timeoutMs }: AuthenticatedFetchOptions = {},
): Promise<Response> {
  const origin = bridgeOrigin(input);
  const first = await fetchWithSession(input, init, origin, timeoutMs);
  if (first.response.status !== 401 || !origin || isAuthenticationEndpoint(input)) {
    return first.response;
  }

  const currentUnauthorized = await invalidateCurrentUnauthorized(
    input,
    init,
    origin,
    timeoutMs,
    first,
  );
  if (currentUnauthorized.response.status !== 401) return currentUnauthorized.response;
  bridgeReauthenticationNeeded.add(origin);
  await authenticateBridgeSession(origin, init.signal ?? undefined, timeoutMs);
  const retry = await fetchWithSession(input, init, origin, timeoutMs);
  if (retry.response.status === 401) {
    const currentRetry = await invalidateCurrentUnauthorized(
      input,
      init,
      origin,
      timeoutMs,
      retry,
    );
    if (currentRetry.response.status !== 401) return currentRetry.response;
    bridgeReauthenticationNeeded.add(origin);
    throw new BridgeAuthenticationError();
  }
  return retry.response;
}

/**
 * Check a session after a WebSocket reconnect. Browsers do not expose the
 * handshake's HTTP 401 to WebSocket clients, so a failed socket alone cannot
 * trigger the normal password prompt. The status endpoint lets us distinguish
 * an expired bridge session from a temporarily unavailable bridge.
 */
export async function refreshBridgeAuthentication(input: string | URL): Promise<boolean> {
  const origin = bridgeOrigin(input);
  if (!origin || (!bridgeSession(origin) && !bridgeReauthenticationNeeded.has(origin))) {
    return false;
  }
  while (true) {
    let attempt: SessionFetchResult;
    try {
      attempt = await fetchWithSession(`${origin}/api/auth/status`, {}, origin);
    } catch {
      return false;
    }
    if (!attempt.response.ok) return false;
    const payload = (await attempt.response.json().catch(() => null)) as {
      required?: unknown;
      authenticated?: unknown;
    } | null;
    if (payload?.required !== true || payload.authenticated === true) {
      bridgeReauthenticationNeeded.delete(origin);
      return false;
    }
    if (!attempt.session || !forgetBridgeSession(origin, attempt.session)) {
      continue;
    }

    bridgeReauthenticationNeeded.add(origin);
    await authenticateBridgeSession(origin);
    bridgeReauthenticationNeeded.delete(origin);
    return true;
  }
}

function authenticateBridgeSession(
  origin: string,
  callerSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<void> {
  const existing = pendingAuthentications.get(origin);
  if (existing) {
    return existing;
  }
  const created = (async () => {
    const password = passwordPromptHandler
      ? await passwordPromptHandler(origin)
      : null;
    if (password === null) {
      throw new BridgeAuthenticationError();
    }
    await authenticateBridge(origin, password, callerSignal, timeoutMs);
    bridgeReauthenticationNeeded.delete(origin);
  })();
  pendingAuthentications.set(origin, created);
  void created.then(
    () => clearPendingAuthentication(origin, created),
    () => clearPendingAuthentication(origin, created),
  );
  return created;
}

function clearPendingAuthentication(origin: string, pending: Promise<void>) {
  if (pendingAuthentications.get(origin) === pending) {
    pendingAuthentications.delete(origin);
  }
}

async function fetchWithSession(
  input: RequestInfo | URL,
  init: RequestInit,
  origin: string | null,
  timeoutMs?: number,
): Promise<SessionFetchResult> {
  const headers = new Headers(init.headers);
  const session = origin ? bridgeSessionSnapshot(origin) : null;
  const token = session?.token;
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (timeoutMs === undefined) {
    return { response: await fetch(input, { ...init, headers }), session };
  }

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
    return {
      response: await fetch(input, { ...init, headers, signal: controller.signal }),
      session,
    };
  } finally {
    globalThis.clearTimeout(timer);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function abortError() {
  return typeof DOMException === "function"
    ? new DOMException("Herdr connection timed out", "AbortError")
    : undefined;
}

async function authenticateBridge(
  origin: string,
  password: string,
  callerSignal?: AbortSignal,
  timeoutMs?: number,
) {
  if (new TextEncoder().encode(password).length > 1024) {
    throw new BridgeAuthenticationError("Password is too long");
  }
  let response: Response;
  try {
    response = (await fetchWithSession(`${origin}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
      signal: callerSignal,
    }, null, timeoutMs ?? 5000)).response;
  } catch {
    throw new BridgeAuthenticationError("Herdr authentication is unavailable");
  } finally {
    password = "";
  }
  if (!response.ok) {
    throw new BridgeAuthenticationError(
      response.status === 429 ? "Too many password attempts; retry shortly" : undefined,
    );
  }
  const payload = (await response.json().catch(() => null)) as { token?: unknown } | null;
  if (!payload || !isBridgeSessionToken(payload.token)) {
    throw new BridgeAuthenticationError("Herdr authentication response is invalid");
  }
  rememberBridgeSession(origin, payload.token);
}

function bridgeSession(origin: string): string | undefined {
  const current = bridgeSessions.get(origin);
  if (current) return current;

  const storage = bridgeSessionStorage();
  if (!storage) return undefined;
  try {
    const stored = storage.getItem(bridgeSessionStorageKey(origin));
    if (!isBridgeSessionToken(stored)) {
      if (stored !== null) storage.removeItem(bridgeSessionStorageKey(origin));
      return undefined;
    }
    bridgeSessions.set(origin, stored);
    advanceBridgeSessionGeneration(origin);
    return stored;
  } catch {
    return undefined;
  }
}

function rememberBridgeSession(origin: string, token: string) {
  bridgeSessions.set(origin, token);
  advanceBridgeSessionGeneration(origin);
  try {
    bridgeSessionStorage()?.setItem(bridgeSessionStorageKey(origin), token);
  } catch {
    // Storage may be unavailable; the in-memory session still works until reload.
  }
}

function forgetBridgeSession(origin: string, expected?: BridgeSessionSnapshot) {
  if (expected && (
    (bridgeSessionGenerations.get(origin) ?? 0) !== expected.generation ||
    bridgeSessions.get(origin) !== expected.token
  )) {
    return false;
  }
  bridgeSessions.delete(origin);
  advanceBridgeSessionGeneration(origin);
  try {
    bridgeSessionStorage()?.removeItem(bridgeSessionStorageKey(origin));
  } catch {
    // Storage may be unavailable or blocked.
  }
  return true;
}

function bridgeSessionSnapshot(origin: string): BridgeSessionSnapshot {
  const token = bridgeSession(origin);
  return {
    token,
    generation: bridgeSessionGenerations.get(origin) ?? 0,
  };
}

function advanceBridgeSessionGeneration(origin: string) {
  bridgeSessionGenerations.set(origin, (bridgeSessionGenerations.get(origin) ?? 0) + 1);
}

async function invalidateCurrentUnauthorized(
  input: RequestInfo | URL,
  init: RequestInit,
  origin: string,
  timeoutMs: number | undefined,
  initial: SessionFetchResult,
) {
  let attempt = initial;
  while (attempt.response.status === 401) {
    if (attempt.session && forgetBridgeSession(origin, attempt.session)) return attempt;
    attempt = await fetchWithSession(input, init, origin, timeoutMs);
  }
  return attempt;
}

function bridgeSessionStorage(): Storage | null {
  try {
    return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function bridgeSessionStorageKey(origin: string) {
  return `${bridgeSessionStoragePrefix}${encodeURIComponent(origin)}`;
}

function isBridgeSessionToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 64;
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
