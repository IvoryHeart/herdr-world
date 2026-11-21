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

export function normalizePublicOrigin(
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const origin = parseBrowserOrigin(value.trim());
  if (!origin) {
    throw new Error("public origin must be an HTTP(S) origin without a path");
  }
  return origin.origin;
}

/**
 * Enforces the browser-controlled authority boundary without asking users to
 * maintain Host or Origin allow-lists. Originless native clients remain usable.
 * A loopback deployment may name one exact public proxy origin explicitly.
 */
export function browserRequestAdmissionError(
  request: Request,
  listenerHost: string,
  publicOrigin?: string,
): Response | null {
  const authority = parseAuthority(request.headers.get("host") ?? "");
  if (!authority)
    return new Response("invalid request authority", { status: 400 });

  const configuredOrigin = publicOrigin
    ? parseBrowserOrigin(publicOrigin)
    : null;
  const usesConfiguredProxyAuthority =
    configuredOrigin !== null &&
    configuredOrigin.host.toLowerCase() === authority.host.toLowerCase();

  if (
    listenerIsLoopback(listenerHost) &&
    !isLoopbackHostname(authority.hostname) &&
    !usesConfiguredProxyAuthority
  ) {
    return new Response("forbidden", { status: 403 });
  }

  const rawOrigin = request.headers.get("origin");
  if (rawOrigin === null) return null;
  const origin = parseBrowserOrigin(rawOrigin);
  if (
    !origin ||
    origin.host.toLowerCase() !== authority.host.toLowerCase() ||
    (usesConfiguredProxyAuthority &&
      origin.origin.toLowerCase() !== configuredOrigin.origin.toLowerCase())
  ) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}
