/**
 * World's same-origin route to a running IDE server (`/ide/<instance>/…`).
 * The browser only ever talks to World: every request and WebSocket upgrade
 * has already passed World's sign-in and origin checks, and World forwards
 * it to the one private Unix socket the instance owns. Nothing the browser
 * sends can name another upstream.
 *
 * Header rules (design #988):
 * - World's own cookies never reach the IDE; only the IDE's own cookies do.
 * - The upstream connection token is added here and never sent to the
 *   browser: its `vscode-tkn` cookie is dropped from every response.
 * - The IDE's other cookies are scoped to its route, so they cannot shadow
 *   World's.
 * - A response may not widen a service worker's scope, and a redirect may
 *   not leave the instance's route.
 * - Every response also carries World's frame policy: browsers enforce
 *   both policies, so the IDE can frame only its own origin and VS Code's
 *   webview origin, whatever its own policy allows.
 * - The workbench page gets World's theme defaults (`workbench-theme.ts`),
 *   so VS Code's light/dark follows World's theme.
 * - The workbench's own WebSocket handshake carries the token too: VS Code
 *   reads it from the cookie it never gets, so World fills it into the
 *   first message of each IDE socket (`withConnectionToken`).
 */

import type { IdeProviderId } from "./providers";
import {
  isPageRequest,
  isWorkbenchPage,
  themedWorkbenchBody,
} from "./workbench-theme";

export const IDE_ROUTE_PREFIX = "/ide/";
const INSTANCE_ID = /^[A-Za-z0-9_-]{16,64}$/;

/** Request headers that describe this hop, not the request. */
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "authorization",
  "cookie",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-accept",
  "content-length",
]);

/** Response headers World never passes to the browser. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "service-worker-allowed",
  "set-cookie",
  "content-length",
]);

/** Cookies an IDE sets for itself; anything else in the jar is World's. */
const IDE_COOKIE = /^(vscode-|code-server-)/;
export const IDE_TOKEN_COOKIE = "vscode-tkn";
/**
 * VS Code's own webview origin. Stock VS Code and OpenVSCode Server frame
 * webviews (Markdown preview, extension panels) and the web worker
 * extension host from `https://<hash>.vscode-cdn.net`, a fresh subdomain per
 * webview. The one exception to World's one-origin frame rule, and only on
 * IDE pages (#1053): that content stays cross-origin to World, so it can't
 * reach World's window, storage, cookies or API, and its service worker's
 * scope is its own origin.
 */
export const IDE_WEBVIEW_FRAME_ORIGIN = "https://*.vscode-cdn.net";
/** Added beside the IDE's own policy; the stricter of the two wins. */
export const IDE_FRAME_POLICY = `frame-src 'self' blob: data: ${IDE_WEBVIEW_FRAME_ORIGIN}`;

export function parseIdeRoute(
  pathname: string,
): { instanceId: string; rest: string } | null {
  if (!pathname.startsWith(IDE_ROUTE_PREFIX)) return null;
  const tail = pathname.slice(IDE_ROUTE_PREFIX.length);
  const slash = tail.indexOf("/");
  const instanceId = slash === -1 ? tail : tail.slice(0, slash);
  if (!INSTANCE_ID.test(instanceId)) return null;
  return { instanceId, rest: slash === -1 ? "" : tail.slice(slash) };
}

export function ideBasePath(instanceId: string) {
  return `${IDE_ROUTE_PREFIX}${instanceId}`;
}

export type IdeUpstream = {
  instanceId: string;
  provider: IdeProviderId;
  socketPath: string;
  /** Present for providers that check a connection token. */
  token: string | null;
  /** code-server is served at its root; VS Code knows its base path. */
  stripsBasePath: boolean;
};

function parseCookieHeader(header: string | null): [string, string][] {
  if (!header) return [];
  const cookies: [string, string][] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    cookies.push([name, part.slice(index + 1).trim()]);
  }
  return cookies;
}

/** The path the upstream sees for a browser path under the instance route. */
export function upstreamPath(upstream: IdeUpstream, pathname: string) {
  if (!upstream.stripsBasePath) return pathname;
  const route = parseIdeRoute(pathname);
  return route?.rest ? route.rest : "/";
}

export function upstreamRequestHeaders(
  incoming: Headers,
  upstream: IdeUpstream,
): Headers {
  const headers = new Headers();
  incoming.forEach((value, name) => {
    if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  const cookies = parseCookieHeader(incoming.get("cookie")).filter(
    ([name]) => IDE_COOKIE.test(name) && name !== IDE_TOKEN_COOKIE,
  );
  if (upstream.token) cookies.push([IDE_TOKEN_COOKIE, upstream.token]);
  if (cookies.length)
    headers.set(
      "cookie",
      cookies.map(([name, value]) => `${name}=${value}`).join("; "),
    );
  return headers;
}

/**
 * Rewrite one upstream Set-Cookie for the browser: drop the token and any
 * cookie that is not the IDE's, and pin the rest to the instance route.
 */
export function scopeIdeCookie(
  setCookie: string,
  instanceId: string,
): string | null {
  const [pair, ...attributes] = setCookie.split(";");
  const index = pair.indexOf("=");
  if (index <= 0) return null;
  const name = pair.slice(0, index).trim();
  if (!IDE_COOKIE.test(name) || name === IDE_TOKEN_COOKIE) return null;
  const kept = attributes
    .map((attribute) => attribute.trim())
    .filter((attribute) => {
      const key = attribute.split("=")[0].trim().toLowerCase();
      return key !== "path" && key !== "domain" && attribute !== "";
    });
  return [pair.trim(), ...kept, `Path=${ideBasePath(instanceId)}`].join("; ");
}

/**
 * A redirect stays on World's origin and inside the instance route; code-
 * server's root-relative redirects get the route prefix back.
 */
export function scopeIdeLocation(
  location: string,
  upstream: IdeUpstream,
  requestUrl: URL,
): string | null {
  const base = ideBasePath(upstream.instanceId);
  let target: URL;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return null;
  }
  if (target.origin !== requestUrl.origin) return null;
  let pathname = target.pathname;
  if (upstream.stripsBasePath && !pathname.startsWith(`${base}/`))
    pathname = `${base}${pathname}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  return `${pathname}${target.search}${target.hash}`;
}

export function ideResponseHeaders(
  upstreamHeaders: Headers,
  upstream: IdeUpstream,
  requestUrl: URL,
): Headers | null {
  const headers = new Headers();
  upstreamHeaders.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase()))
      headers.append(name, value);
  });
  for (const cookie of upstreamHeaders.getSetCookie()) {
    const scoped = scopeIdeCookie(cookie, upstream.instanceId);
    if (scoped) headers.append("set-cookie", scoped);
  }
  const location = upstreamHeaders.get("location");
  if (location !== null) {
    const scoped = scopeIdeLocation(location, upstream, requestUrl);
    if (scoped === null) return null;
    headers.set("location", scoped);
  }
  headers.append("content-security-policy", IDE_FRAME_POLICY);
  // Authenticated IDE pages are never for a shared cache.
  if (!headers.has("cache-control"))
    headers.set("cache-control", "private, no-cache");
  return headers;
}

/** Forward one HTTP request to the instance's socket. */
export async function proxyIdeHttp(
  req: Request,
  url: URL,
  upstream: IdeUpstream,
): Promise<Response> {
  const path = upstreamPath(upstream, url.pathname);
  const requestHeaders = upstreamRequestHeaders(req.headers, upstream);
  // A page comes back unencoded so World can add its theme defaults.
  const page = isPageRequest(req.method, req.headers);
  if (page) requestHeaders.set("accept-encoding", "identity");
  let response: Response;
  try {
    response = await fetch(`http://localhost${path}${url.search}`, {
      unix: upstream.socketPath,
      method: req.method,
      headers: requestHeaders,
      body:
        req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
      decompress: false,
    } as RequestInit);
  } catch {
    return new Response("The IDE server isn't answering.", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  const headers = ideResponseHeaders(response.headers, upstream, url);
  if (!headers) {
    await response.body?.cancel();
    return new Response("The IDE tried to redirect outside its route.", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }
  let body: BodyInit | null = req.method === "HEAD" ? null : response.body;
  if (body && page && isWorkbenchPage(req.method, response.headers)) {
    try {
      body = await themedWorkbenchBody(response.body);
    } catch {
      return new Response("The IDE server isn't answering.", {
        status: 502,
        headers: { "cache-control": "no-store" },
      });
    }
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** What a browser IDE WebSocket carries through Bun's upgrade. */
export type IdeSocketData = {
  kind: "ide";
  sessionToken: string | null;
  instanceId: string;
  upstreamUrl: string;
  upstreamHeaders: Record<string, string>;
  /** Filled into the workbench's handshake; never sent to the browser. */
  handshakeToken: string | null;
};

/** The upstream URL and headers for a browser WebSocket upgrade. */
export function ideSocketTarget(
  req: Request,
  url: URL,
  upstream: IdeUpstream,
): {
  upstreamUrl: string;
  upstreamHeaders: Record<string, string>;
  handshakeToken: string | null;
} {
  const headers = upstreamRequestHeaders(req.headers, upstream);
  headers.delete("sec-websocket-protocol");
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name] = value;
  });
  return {
    upstreamUrl: `ws+unix://${upstream.socketPath}:${upstreamPath(upstream, url.pathname)}${url.search}`,
    upstreamHeaders: record,
    handshakeToken: upstream.token,
  };
}

/** VS Code's protocol header: type u8, id u32, ack u32, length u32. */
const PROTOCOL_HEADER_BYTES = 13;
const CONTROL_MESSAGE = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The workbench opens every remote socket with a control message
 * `{"type":"auth","auth":<token>,…}`, the token read from the `vscode-tkn`
 * cookie. World keeps that cookie from the browser (the token stays on
 * World's side), so the browser sends a placeholder and the server would
 * refuse it ("auth mismatch"). Put the real token in; anything else passes
 * unchanged.
 */
export function withConnectionToken(
  data: string | ArrayBufferLike | Uint8Array,
  token: string,
): string | ArrayBufferLike | Uint8Array {
  if (typeof data === "string") return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length <= PROTOCOL_HEADER_BYTES || bytes[0] !== CONTROL_MESSAGE)
    return data;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(9) !== bytes.length - PROTOCOL_HEADER_BYTES) return data;
  let message: unknown;
  try {
    message = JSON.parse(decoder.decode(bytes.subarray(PROTOCOL_HEADER_BYTES)));
  } catch {
    return data;
  }
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "auth"
  )
    return data;
  const body = encoder.encode(JSON.stringify({ ...message, auth: token }));
  const out = new Uint8Array(PROTOCOL_HEADER_BYTES + body.length);
  out.set(bytes.subarray(0, 9));
  new DataView(out.buffer).setUint32(9, body.length);
  out.set(body, PROTOCOL_HEADER_BYTES);
  return out;
}

type BrowserSocket = {
  data: IdeSocketData;
  send(data: string | ArrayBufferLike | Uint8Array): unknown;
  close(code?: number, reason?: string): void;
};

/**
 * Pipes one browser WebSocket to its upstream. Frames the browser sends
 * before the upstream opens wait in order; nothing is replayed after either
 * side closes.
 */
export class IdeSocketBridge {
  private upstream: WebSocket | null = null;
  private pending: (string | ArrayBufferLike | Uint8Array)[] = [];
  private closed = false;
  private first = true;

  constructor(
    private readonly browser: BrowserSocket,
    private readonly connect: (
      url: string,
      headers: Record<string, string>,
    ) => WebSocket = (url, headers) =>
      new WebSocket(url, { headers } as unknown as string[]),
  ) {}

  open() {
    const { upstreamUrl, upstreamHeaders } = this.browser.data;
    let socket: WebSocket;
    try {
      socket = this.connect(upstreamUrl, upstreamHeaders);
    } catch {
      this.close(1011, "IDE server unavailable");
      return;
    }
    socket.binaryType = "arraybuffer";
    this.upstream = socket;
    socket.onopen = () => {
      if (this.closed) return socket.close();
      for (const message of this.pending) socket.send(message as string);
      this.pending = [];
    };
    socket.onmessage = (event) => {
      if (!this.closed) this.browser.send(event.data as string | ArrayBuffer);
    };
    socket.onclose = (event) => this.close(event.code, event.reason);
    socket.onerror = () => this.close(1011, "IDE server unavailable");
  }

  message(data: string | ArrayBufferLike | Uint8Array) {
    if (this.closed) return;
    const token = this.browser.data.handshakeToken;
    if (this.first) {
      this.first = false;
      if (token) data = withConnectionToken(data, token);
    }
    const upstream = this.upstream;
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(data as string);
    else this.pending.push(data);
  }

  /** Close both sides once; a reserved code becomes a normal one. */
  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    this.pending = [];
    const safeCode =
      code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
    try {
      this.upstream?.close(safeCode === 1011 ? 1000 : safeCode);
    } catch {
      // Already closing.
    }
    try {
      this.browser.close(safeCode, reason.slice(0, 120));
    } catch {
      // Already closed.
    }
  }

  get isClosed() {
    return this.closed;
  }
}
