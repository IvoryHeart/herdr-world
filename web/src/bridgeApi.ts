export type BridgeHttpUrl = (path: string, query?: URLSearchParams) => string;

type PasswordPromptHandler = (origin: string) => Promise<string | null>;

const bridgeSessions = new Map<string, string>();
const pendingPasswordPrompts = new Map<string, Promise<string | null>>();
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
  if (origin) bridgeSessions.delete(origin);
}

export function bridgeWebSocketProtocols(input: string | URL): string[] {
  const origin = bridgeOrigin(input);
  const token = origin ? bridgeSessions.get(origin) : undefined;
  return token ? [`herdr-world-auth.${token}`] : [];
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const origin = bridgeOrigin(input);
  const first = await fetchWithSession(input, init, origin);
  if (first.status !== 401 || !origin || isAuthenticationEndpoint(input)) {
    return first;
  }

  bridgeSessions.delete(origin);
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
  await authenticateBridge(origin, password);
  const retry = await fetchWithSession(input, init, origin);
  if (retry.status === 401) {
    bridgeSessions.delete(origin);
    throw new BridgeAuthenticationError();
  }
  return retry;
}

async function fetchWithSession(
  input: RequestInfo | URL,
  init: RequestInit,
  origin: string | null,
) {
  const headers = new Headers(init.headers);
  const token = origin ? bridgeSessions.get(origin) : undefined;
  if (token) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function authenticateBridge(origin: string, password: string) {
  if (new TextEncoder().encode(password).length > 1024) {
    throw new BridgeAuthenticationError("Bridge password is too long");
  }
  let response: Response;
  try {
    response = await fetch(`${origin}/api/auth/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(5000),
    });
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
    if (typeof Request !== "undefined" && input instanceof Request) return new URL(input.url).origin;
    return new URL(String(input), globalThis.location?.origin ?? "http://localhost").origin;
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
