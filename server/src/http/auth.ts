import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  assertValidAuthPassword,
  assertValidAuthPin,
} from "../config/auth-token";
import { worldCliToken } from "../config/session-secret";
import { readJsonBody } from "./json-body";
import { renderLoginPage } from "./login-page";

/**
 * Before #1250 every World used this one name. Browsers share cookies across
 * ports of a host, so Worlds on one host logged each other out; a session
 * this World signed under it still counts once and moves to the new name.
 */
const LEGACY_AUTH_COOKIE = "herdr_world_auth";
const AUTH_COOKIE_PREFIX = `${LEGACY_AUTH_COOKIE}_`;
const AUTH_COOKIE_ID_LABEL = "herdr-world session cookie name";
/**
 * Other Worlds' live session cookies a browser keeps on one host. Every
 * fresh preview has its own secret and so its own cookie; without a bound
 * they would pile up for their lifetime until request headers outgrow the
 * server's limit (Bun answers 431 at about 16 KB, some 80 cookies). One is
 * about 210 bytes, so 48 stay near 10 KB: the bound only bites for a
 * browser that has held dozens of Worlds within a month, never for the few
 * a person switches between.
 */
const OTHER_WORLD_COOKIES_KEPT = 48;
const HOUR_SECONDS = 60 * 60;
/** Longest return path a login carries; longer ones land on `/`. */
const RETURN_PATH_MAX_LENGTH = 2048;
const RETURN_PATH_BASE = "http://world.invalid";
const AUTH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 20;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_COOLDOWN_MS = 5 * 60_000;
const LOGIN_MAX_IPS = 4096;
const LOGIN_MAX_BODY_BYTES = 16 * 1024;
const PIN_MAX_FAILURES = 10;
const PIN_COOLDOWN_MS = 60 * 60_000;

interface LoginAttempts {
  count: number;
  failures: number;
  windowEndsAt: number;
  blockedUntil: number;
  expiresAt: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(
    padded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

/**
 * The session cookie name of the World with this signing secret. Cookies
 * are scoped to a host but not to its port, so each World names its own: a
 * short digest of its secret, stable across restarts and ports, that tells
 * nothing about the secret itself.
 */
function authCookieName(sessionSecret: string): string {
  const id = createHmac("sha256", Buffer.from(sessionSecret, "hex"))
    .update(AUTH_COOKIE_ID_LABEL)
    .digest("hex")
    .slice(0, 12);
  return `${AUTH_COOKIE_PREFIX}${id}`;
}

function thisHour(): number {
  return Math.floor(Date.now() / 1000 / HOUR_SECONDS);
}

/**
 * A World session cookie's value: the signed token, then the hour this
 * World last set it (`<token>.h<hour>`), which only orders pruning and is
 * not signed. The legacy cookie holds the bare token.
 */
function readCookieValue(value: string): { token: string; seenHour?: number } {
  const parts = value.split(".");
  const seen = parts[2]?.match(/^h(\d{1,9})$/);
  return parts.length === 3 && seen
    ? { token: `${parts[0]}.${parts[1]}`, seenHour: Number(seen[1]) }
    : { token: value };
}

/**
 * Another World's cookie as pruning sees it: the hour it was last set (else
 * its token's issue hour), and whether it can still sign anyone in. Only
 * the unsigned payload is readable here, so a cookie whose payload is not
 * a World token's, or whose expiry has passed, is dead for every World.
 */
function otherWorldCookie(value: string): { seenHour: number; live: boolean } {
  const { token, seenHour } = readCookieValue(value);
  try {
    const { iat, exp } = JSON.parse(base64UrlDecode(token.split(".")[0]!)) as {
      iat?: unknown;
      exp?: unknown;
    };
    if (typeof iat !== "number" || typeof exp !== "number")
      return { seenHour: -1, live: false };
    return {
      seenHour: seenHour ?? Math.floor(iat / HOUR_SECONDS),
      live: exp > Date.now() / 1000,
    };
  } catch {
    return { seenHour: -1, live: false };
  }
}

/** Every World session cookie in a Cookie header, by name. */
function worldCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== LEGACY_AUTH_COOKIE && !key.startsWith(AUTH_COOKIE_PREFIX))
      continue;
    if (!cookies.has(key)) cookies.set(key, part.slice(separator + 1).trim());
  }
  return cookies;
}

/**
 * The same-origin path and query a login returns to, or null when `raw` is
 * not one: only a relative path (no scheme, no `//`, no backslash, no
 * control character), never the login page, and never with a `token`.
 * @internal Exported for its open-redirect tests.
 */
export function safeReturnPath(raw: string | null): string | null {
  if (
    !raw ||
    raw.length > RETURN_PATH_MAX_LENGTH ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    // Backslashes read as slashes, and browsers drop tabs and newlines
    // from addresses, so `/\t/host` would become `//host`.
    raw.includes("\\") ||
    hasControlCharacter(raw)
  )
    return null;
  let url: URL;
  try {
    url = new URL(raw, RETURN_PATH_BASE);
  } catch {
    return null;
  }
  if (url.origin !== RETURN_PATH_BASE) return null;
  if (url.searchParams.has("token")) url.searchParams.delete("token");
  const path = `${url.pathname}${url.search}`;
  // Dot segments can normalise `/.//host` into `//host`.
  if (path.startsWith("//") || path.includes("\\")) return null;
  if (url.pathname === "/login") return null;
  return path;
}

function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** `/login`, carrying the request's own path and query when it has one. */
function loginLocation(url: URL): string {
  const next = safeReturnPath(`${url.pathname}${url.search}`);
  return next && next !== "/"
    ? `/login?next=${encodeURIComponent(next)}`
    : "/login";
}

export function createAuthHandlers(args: {
  authRequired?: boolean;
  password: string;
  sessionSecret: string;
  pin?: string;
  urlLoginToken?: string;
  /** Host command that prints the generated token, shown on the login page. */
  tokenCommand?: string;
  secureCookies?: boolean;
}) {
  const authRequired = args.authRequired ?? true;
  if (authRequired) {
    assertValidAuthPassword(args.password);
    if (!/^[a-f0-9]{64}$/.test(args.sessionSecret)) {
      throw new Error(
        "Authentication requires a 256-bit session signing secret.",
      );
    }
  }
  if (args.pin !== undefined) assertValidAuthPin(args.pin);
  // ponytail: process-local IP limits; use shared storage for multiple replicas.
  const loginAttempts = new Map<string, LoginAttempts>();
  // PIN throttling must never consume the password/token recovery budget.
  const pinAttempts = new Map<string, LoginAttempts>();
  let pinFailures = 0;
  let pinBlockedUntil = 0;

  function checkPinCooldown(): Response | null {
    const now = Date.now();
    if (pinBlockedUntil > now) return tooManyAttempts(pinBlockedUntil - now);
    if (pinBlockedUntil) {
      pinFailures = 0;
      pinBlockedUntil = 0;
    }
    return null;
  }

  function failPinLogin() {
    if (++pinFailures >= PIN_MAX_FAILURES) {
      pinBlockedUntil = Date.now() + PIN_COOLDOWN_MS;
    }
  }

  function tooManyAttempts(waitMs: number): Response {
    return Response.json(
      { error: "too many login attempts" },
      {
        status: 429,
        headers: {
          "retry-after": String(Math.max(1, Math.ceil(waitMs / 1000))),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      },
    );
  }

  function checkCooldown(
    attempts: LoginAttempts,
    now: number,
  ): Response | null {
    if (attempts.blockedUntil > now) {
      return tooManyAttempts(attempts.blockedUntil - now);
    }
    if (attempts.blockedUntil) {
      attempts.failures = 0;
      attempts.blockedUntil = 0;
    }
    return null;
  }

  function beginLogin(
    ip = "unknown",
    records = loginAttempts,
  ): LoginAttempts | Response {
    const now = Date.now();
    for (const [address, attempts] of records) {
      if (attempts.expiresAt <= now) records.delete(address);
    }
    let attempts = records.get(ip);
    if (!attempts) {
      // Fail closed rather than evicting an IP's active cooldown.
      if (records.size >= LOGIN_MAX_IPS) {
        return tooManyAttempts(LOGIN_WINDOW_MS);
      }
      attempts = {
        count: 0,
        failures: 0,
        windowEndsAt: now + LOGIN_WINDOW_MS,
        blockedUntil: 0,
        expiresAt: now + LOGIN_COOLDOWN_MS,
      };
      records.set(ip, attempts);
    }
    attempts.expiresAt = now + LOGIN_COOLDOWN_MS;
    const cooldown = checkCooldown(attempts, now);
    if (cooldown) return cooldown;
    if (attempts.windowEndsAt <= now) {
      attempts.count = 0;
      attempts.windowEndsAt = now + LOGIN_WINDOW_MS;
    }
    if (attempts.count >= LOGIN_MAX_ATTEMPTS) {
      return tooManyAttempts(attempts.windowEndsAt - now);
    }
    attempts.count++;
    return attempts;
  }

  function failLogin(attempts: LoginAttempts) {
    attempts.failures++;
    if (attempts.failures >= LOGIN_MAX_FAILURES) {
      attempts.blockedUntil = Date.now() + LOGIN_COOLDOWN_MS;
      attempts.expiresAt = attempts.blockedUntil;
    }
  }

  function parseCookie(header: string | null, name: string): string | null {
    if (!header) return null;
    for (const part of header.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key !== name) continue;
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
    return null;
  }

  function sign(payload: string): string {
    return createHmac("sha256", Buffer.from(args.sessionSecret, "hex"))
      .update(payload)
      .digest("hex");
  }

  function signedToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = base64UrlEncode(
      JSON.stringify({
        iat: now,
        exp: now + AUTH_TOKEN_TTL_SECONDS,
        nonce: randomBytes(16).toString("hex"),
      }),
    );
    return `${payload}.${sign(payload)}`;
  }

  const cookieName = authRequired
    ? authCookieName(args.sessionSecret)
    : `${AUTH_COOKIE_PREFIX}open`;

  function cookieAttributes(maxAge: number): string {
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${args.secureCookies ? "; Secure" : ""}`;
  }

  function clearCookie(name: string): string {
    return `${name}=; ${cookieAttributes(0)}`;
  }

  /** Seconds the token has left, from its verified payload. */
  function remainingSeconds(token: string): number {
    try {
      const { exp } = JSON.parse(base64UrlDecode(token.split(".")[0]!)) as {
        exp: number;
      };
      return Math.max(1, exp - Math.floor(Date.now() / 1000));
    } catch {
      return AUTH_TOKEN_TTL_SECONDS;
    }
  }

  /**
   * This World's cookie set to `token`, stamped with this hour, for the
   * time the token has left. Moving a legacy session keeps its token, so Web
   * Push and open sockets keep their session; the legacy name is then
   * cleared. Other Worlds' cookies that can no longer sign anyone in go;
   * live ones beyond the kept number go least recently seen first: they are
   * other Worlds' logins, so only a bound, never all of them.
   */
  function sessionCookieHeaders(
    req: Request,
    token: string,
  ): [string, string][] {
    const fromLegacy = ownLegacySession(req);
    const headers: [string, string][] = [
      [
        "set-cookie",
        `${cookieName}=${token}.h${thisHour()}; ${cookieAttributes(remainingSeconds(token))}`,
      ],
    ];
    if (fromLegacy)
      headers.push(["set-cookie", clearCookie(LEGACY_AUTH_COOKIE)]);
    const live: { name: string; seenHour: number }[] = [];
    for (const [name, value] of worldCookies(req.headers.get("cookie"))) {
      if (name === cookieName || (fromLegacy && name === LEGACY_AUTH_COOKIE))
        continue;
      const other = otherWorldCookie(value);
      if (other.live) live.push({ name, seenHour: other.seenHour });
      else headers.push(["set-cookie", clearCookie(name)]);
    }
    const excess = live.length - OTHER_WORLD_COOKIES_KEPT;
    if (excess > 0)
      for (const { name } of live
        .sort((left, right) => left.seenHour - right.seenHour)
        .slice(0, excess))
        headers.push(["set-cookie", clearCookie(name)]);
    return headers;
  }

  function authCookieHeaders(req: Request): [string, string][] {
    // Reauthentication keeps every live tab on the same session token, and
    // leaves a current cookie and its expiry alone.
    const session = authedSession(req);
    if (!session) return sessionCookieHeaders(req, signedToken());
    return currentCookie(req, session)
      ? []
      : sessionCookieHeaders(req, session.token);
  }

  function secretsEqual(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  function isValidSignedToken(token: string): boolean {
    const [payload, signature, ...extra] = token.split(".");
    if (!payload || !signature || extra.length > 0) return false;
    const expected = sign(payload);
    const actualBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (actualBuffer.length !== expectedBuffer.length) return false;
    if (!timingSafeEqual(actualBuffer, expectedBuffer)) return false;
    try {
      const decoded = JSON.parse(base64UrlDecode(payload)) as { exp?: unknown };
      return (
        typeof decoded.exp === "number" &&
        decoded.exp > Math.floor(Date.now() / 1000)
      );
    } catch {
      return false;
    }
  }

  /**
   * This World's session in the request: its own cookie, or else the legacy
   * shared one when this World signed it. No other name is ever accepted, so
   * logout can clear every session cookie a later request could use.
   */
  function authedSession(
    req: Request,
  ): { token: string; legacy: boolean; seenHour?: number } | null {
    if (!authRequired) return null;
    const header = req.headers.get("cookie");
    const own = parseCookie(header, cookieName);
    if (own !== null) {
      const { token, seenHour } = readCookieValue(own);
      if (isValidSignedToken(token)) return { token, legacy: false, seenHour };
    }
    const legacy = parseCookie(header, LEGACY_AUTH_COOKIE);
    if (legacy !== null && isValidSignedToken(legacy))
      return { token: legacy, legacy: true };
    return null;
  }

  /** Whether the legacy shared cookie holds a session this World signed. */
  function ownLegacySession(req: Request): boolean {
    if (!authRequired) return false;
    const legacy = parseCookie(req.headers.get("cookie"), LEGACY_AUTH_COOKIE);
    return legacy !== null && isValidSignedToken(legacy);
  }

  function isAuthed(req: Request): boolean {
    return !authRequired || authedSession(req) !== null;
  }

  function sessionToken(req: Request): string | null {
    const own = parseCookie(req.headers.get("cookie"), cookieName);
    return (
      authedSession(req)?.token ??
      (own === null ? null : readCookieValue(own).token)
    );
  }

  /**
   * Cookie headers for a signed-in page load: the legacy session moves to
   * this World's name, and this World's cookie is stamped once an hour so
   * pruning keeps the Worlds in use. They go on the page itself, never a
   * redirect, so a browser that refuses the cookie cannot loop.
   */
  function sessionCookieRefresh(req: Request): [string, string][] {
    if (req.method !== "GET") return [];
    const session = authedSession(req);
    if (!session || currentCookie(req, session)) return [];
    return sessionCookieHeaders(req, session.token);
  }

  /** This World's own cookie, set this hour, with no legacy session left. */
  function currentCookie(
    req: Request,
    session: { seenHour?: number },
  ): boolean {
    return session.seenHour === thisHour() && !ownLegacySession(req);
  }

  /** Failed agent CLI tokens, kept apart so they never lock out a login. */
  const bearerAttempts = new Map<string, LoginAttempts>();
  const cliToken = authRequired ? worldCliToken(args.sessionSecret) : "";

  /**
   * A local client's `Authorization: Bearer` token for the agent CLI
   * endpoint: derived from the session secret (worldCliToken), never the
   * login credential itself. Wrong tokens get the login throttle, counted
   * per address on their own.
   */
  function bearerAuth(req: Request, ip = "unknown"): true | Response | null {
    const header = req.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return null;
    const existing = bearerAttempts.get(ip);
    const cooldown = existing ? checkCooldown(existing, Date.now()) : null;
    if (cooldown) return cooldown;
    if (cliToken && secretsEqual(header.slice(7), cliToken)) return true;
    const attempts = beginLogin(ip, bearerAttempts);
    if (attempts instanceof Response) return attempts;
    failLogin(attempts);
    return Response.json({ error: "wrong token" }, { status: 401 });
  }

  function handleLogout(req: Request): Response {
    if (req.method !== "POST") {
      return new Response("method not allowed", {
        status: 405,
        headers: { allow: "POST" },
      });
    }
    const logoutHeader =
      req.headers.get("x-herdr-world-logout") ??
      req.headers.get("x-roamgate-logout");
    if (
      logoutHeader !== "1" ||
      req.headers.get("sec-fetch-site") === "cross-site"
    )
      return new Response("forbidden", { status: 403 });
    const headers: [string, string][] = [
      ["set-cookie", clearCookie(cookieName)],
      ["cache-control", "no-store"],
    ];
    // A legacy session this World signed would sign the browser back in.
    if (ownLegacySession(req))
      headers.push(["set-cookie", clearCookie(LEGACY_AUTH_COOKIE)]);
    return new Response(null, { status: 204, headers });
  }

  function handleTokenLogin(req: Request, ip = "unknown"): Response | null {
    if (!authRequired || !args.urlLoginToken || req.method !== "GET") {
      return null;
    }
    const url = new URL(req.url);
    const suppliedToken = url.searchParams.get("token");
    if (suppliedToken === null) return null;
    const attempts = beginLogin(ip);
    if (attempts instanceof Response) return attempts;
    url.searchParams.delete("token");

    const valid = secretsEqual(suppliedToken, args.urlLoginToken);
    if (valid) attempts.failures = 0;
    else failLogin(attempts);
    const location = valid
      ? (safeReturnPath(`${url.pathname}${url.search}`) ?? "/")
      : loginLocation(url);
    return new Response(null, {
      status: 303,
      headers: [
        ["location", location],
        ...(valid ? authCookieHeaders(req) : []),
        ["cache-control", "no-store"],
        ["referrer-policy", "no-referrer"],
      ],
    });
  }

  async function handleCredentialLogin(
    req: Request,
    ip: string,
    usePin: boolean,
  ): Promise<Response> {
    if (usePin && !args.pin) return new Response("not found", { status: 404 });
    if (!authRequired) return Response.json({ ok: true });
    if (usePin) {
      const cooldown = checkPinCooldown();
      if (cooldown) return cooldown;
    }
    const records = usePin ? pinAttempts : loginAttempts;
    const attempts = beginLogin(ip, records);
    if (attempts instanceof Response) return attempts;
    let body: any;
    let invalidBodyStatus = 0;
    try {
      body = await readJsonBody(req, LOGIN_MAX_BODY_BYTES);
    } catch (error) {
      invalidBodyStatus = error instanceof RangeError ? 413 : 400;
    }
    // A slow body must not authorize using an expired or replaced IP record.
    if (records.get(ip) !== attempts || attempts.expiresAt <= Date.now()) {
      return tooManyAttempts(LOGIN_WINDOW_MS);
    }
    const cooldown = checkCooldown(attempts, Date.now());
    if (cooldown) return cooldown;
    if (usePin) {
      const cooldown = checkPinCooldown();
      if (cooldown) return cooldown;
    }
    if (invalidBodyStatus) {
      failLogin(attempts);
      if (usePin) failPinLogin();
      return Response.json(
        {
          error:
            invalidBodyStatus === 413
              ? "request body too large"
              : "bad request",
        },
        { status: invalidBodyStatus },
      );
    }
    const supplied = usePin ? body?.pin : body?.password;
    const expected = usePin ? args.pin! : args.password;
    if (typeof supplied !== "string" || !secretsEqual(supplied, expected)) {
      failLogin(attempts);
      if (usePin) failPinLogin();
      return Response.json(
        { error: usePin ? "wrong PIN" : "wrong password" },
        { status: 401 },
      );
    }
    attempts.failures = 0;
    if (usePin) pinFailures = 0;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: [
        ["content-type", "application/json"],
        ["cache-control", "no-store"],
        ...authCookieHeaders(req),
      ],
    });
  }

  function handleLogin(req: Request, ip: string): Promise<Response> {
    return handleCredentialLogin(req, ip, false);
  }

  function handlePinLogin(req: Request, ip: string): Promise<Response> {
    return handleCredentialLogin(req, ip, true);
  }

  function loginPage(req: Request): Response {
    const next =
      safeReturnPath(new URL(req.url).searchParams.get("next")) ?? "/";
    if (!authRequired) {
      return new Response(null, {
        status: 302,
        headers: { location: next, "cache-control": "no-store" },
      });
    }
    const page = renderLoginPage(Boolean(args.pin), args.tokenCommand, next);
    return new Response(page, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  return {
    isAuthed,
    bearerAuth,
    sessionToken,
    handleTokenLogin,
    handleLogin,
    handlePinLogin,
    handleLogout,
    loginPage,
    sessionCookieRefresh,
  };
}

export function unauthenticatedLoginRedirect(req: Request): Response {
  // Use a relative Location so reverse proxies preserve the public origin
  // instead of leaking the internal upstream host. Only the request's path
  // and query travel, as `next`, so the login returns to the same page and
  // its switches; its host and forwarded headers are ignored.
  return new Response(null, {
    status: 302,
    headers: {
      location: loginLocation(new URL(req.url)),
      "cache-control": "no-store",
    },
  });
}
