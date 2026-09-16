function parseAuthority(value: string): URL | null {
  try {
    const authority = new URL(`http://${value}`);
    if (
      authority.username ||
      authority.password ||
      authority.pathname !== "/" ||
      authority.search ||
      authority.hash
    ) {
      return null;
    }
    return authority;
  } catch {
    return null;
  }
}

function parseBrowserOrigin(value: string): URL | null {
  try {
    const origin = new URL(value);
    if (
      (origin.protocol !== "http:" && origin.protocol !== "https:") ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function listenerIsLoopback(host: string): boolean {
  return isLoopbackHostname(parseAuthority(host)?.hostname ?? host);
}

/**
 * Enforces the browser-controlled authority boundary without asking users to
 * maintain Host or Origin allow-lists. Originless native clients remain usable;
 * browsers always send Origin for WebSocket handshakes.
 */
export function browserWebSocketAdmissionError(
  request: Request,
  listenerHost: string,
): Response | null {
  const authority = parseAuthority(request.headers.get("host") ?? "");
  if (!authority)
    return new Response("invalid request authority", { status: 400 });

  if (
    listenerIsLoopback(listenerHost) &&
    !isLoopbackHostname(authority.hostname)
  ) {
    return new Response("forbidden", { status: 403 });
  }

  const rawOrigin = request.headers.get("origin");
  if (rawOrigin === null) return null;
  const origin = parseBrowserOrigin(rawOrigin);
  if (!origin || origin.host.toLowerCase() !== authority.host.toLowerCase()) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}
