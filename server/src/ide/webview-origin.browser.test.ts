import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
} from "../../../web/src/browserChrome";
import { browserRequestAdmissionError } from "../http/browser-admission";
import { type IdeUpstream, proxyIdeHttp } from "./proxy";

/*
 * Stock VS Code frames each webview from `https://<hash>.vscode-cdn.net`,
 * the one origin besides World's own that the IDE frame rule admits (#1053).
 * Here a fake workbench on World's IDE route frames a hostile page on such
 * an origin (Chrome maps it to a local HTTPS server) and a page on any
 * other origin. The hostile page runs unsandboxed, as the webview host page
 * does, and tries to reach World's cookies, storage, window, API, socket
 * and pages' service-worker scope.
 */

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));
const openssl = Bun.which("openssl");

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const BASE = `/ide/${ID}`;
const WEBVIEW_HOST = "hostile.vscode-cdn.net";

type Hostile = {
  messageOrigin: string;
  origin: string;
  cookie: string;
  storage: string | null;
  top: string;
  parentStorage: string;
  fetch: string;
  socket: string;
  worldWorker: string;
  ownWorker: string;
};

const hostilePage = `<!doctype html><script type="module">
const world = new URL(location.href).searchParams.get('world');
const out = { origin: location.origin, cookie: document.cookie, storage: localStorage.getItem('world-secret') };
try { out.top = String(window.top.document.cookie); } catch (e) { out.top = e.name; }
try { out.parentStorage = String(window.parent.localStorage.getItem('world-secret')); } catch (e) { out.parentStorage = e.name; }
try {
  const response = await fetch(world + '/rpc', { method: 'POST', credentials: 'include', body: '{}' });
  out.fetch = 'status ' + response.status;
} catch (e) { out.fetch = e.name; }
out.socket = await new Promise((resolve) => {
  const socket = new WebSocket(world.replace('https:', 'wss:') + '/ws');
  socket.onopen = () => resolve('open');
  socket.onerror = () => resolve('error');
  setTimeout(() => resolve('timeout'), 5000);
});
try {
  await navigator.serviceWorker.register(world + '${BASE}/sw.js', { scope: world + '/' });
  out.worldWorker = 'registered';
} catch (e) { out.worldWorker = e.name; }
try {
  out.ownWorker = (await navigator.serviceWorker.register('/sw.js', { scope: '/' })).scope;
} catch (e) { out.ownWorker = e.name; }
parent.postMessage({ hostile: out }, '*');
</script>`;

const workbenchPage = `<!doctype html><body><script type="module">
const violations = [];
addEventListener('securitypolicyviolation', (e) => violations.push(e.blockedURI));
const hostile = new Promise((resolve) => addEventListener('message', (e) => {
  if (e.data?.hostile) resolve({ messageOrigin: e.origin, ...e.data.hostile });
}));
for (const src of [
  'https://${WEBVIEW_HOST}/webview.html?world=' + encodeURIComponent(location.origin),
  'https://elsewhere.example/webview.html',
]) {
  const frame = document.createElement('iframe');
  frame.src = src;
  document.body.append(frame);
}
const result = await Promise.race([hostile, new Promise((r) => setTimeout(() => r(null), 20000))]);
await fetch('/result', { method: 'POST', body: JSON.stringify({ hostile: result, violations }) });
</script></body>`;

const startPage = `<!doctype html><body><script>
localStorage.setItem('world-secret', 'secret');
document.cookie = 'world_probe=secret; Path=/; Secure';
const frame = document.createElement('iframe');
frame.src = '${BASE}/';
document.body.append(frame);
</script></body>`;

test.skipIf(!chrome || !openssl)(
  "IDE pages frame VS Code's webview origin, which can't reach World",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "ide-webview-origin-"));
    const key = join(dir, "key.pem");
    const cert = join(dir, "cert.pem");
    const made = Bun.spawnSync(
      [
        openssl!,
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        `subjectAltName=IP:127.0.0.1,DNS:${WEBVIEW_HOST}`,
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    if (made.exitCode !== 0) throw new Error(made.stderr.toString());
    const tls = { key: Bun.file(key), cert: Bun.file(cert) };
    const html = { "content-type": "text/html" };

    const socketPath = join(dir, "ide.sock");
    // The IDE's server: its workbench page.
    const ide = Bun.serve({
      unix: socketPath,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === `${BASE}/`)
          return new Response(workbenchPage, { headers: html });
        return new Response("Not found", { status: 404 });
      },
    });
    const upstream: IdeUpstream = {
      instanceId: ID,
      provider: "vscode",
      socketPath,
      token: null,
      stripsBasePath: false,
    };

    const pageRequested = Promise.withResolvers<void>();
    const result = Promise.withResolvers<{
      hostile: Hostile | null;
      violations: string[];
    }>();
    // What reached World from another origin, and whether World admitted it.
    const crossOrigin: {
      path: string;
      origin: string;
      status: number;
      cookie: string | null;
    }[] = [];
    // World, on HTTPS, with its real browser admission in front.
    const world = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls,
      async fetch(req, server): Promise<Response | undefined> {
        const url = new URL(req.url);
        const refused = browserRequestAdmissionError(req, "127.0.0.1");
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin)
          crossOrigin.push({
            path: url.pathname,
            origin,
            status: refused?.status ?? 200,
            cookie: req.headers.get("cookie"),
          });
        if (refused) return refused;
        if (url.pathname === "/ws")
          return server.upgrade(req) ? undefined : new Response("no", {});
        if (url.pathname === "/rpc") return new Response("{}");
        if (url.pathname.startsWith("/ide/"))
          return proxyIdeHttp(req, url, upstream);
        if (url.pathname === "/result" && req.method === "POST") {
          result.resolve(await req.json());
          return new Response("ok");
        }
        if (url.pathname === "/start") {
          pageRequested.resolve();
          return new Response(startPage, {
            headers: {
              ...html,
              "set-cookie":
                "herdr_world_session=secret; Path=/; HttpOnly; Secure; SameSite=Lax",
            },
          });
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: { message() {} },
    });
    const worldOrigin = `https://127.0.0.1:${world.port}`;
    // VS Code's webview origin, as Chrome reaches it here.
    const webviews = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/webview.html")
          return new Response(hostilePage, { headers: html });
        if (path === "/sw.js")
          return new Response("", {
            headers: { "content-type": "text/javascript" },
          });
        return new Response("Not found", { status: 404 });
      },
    });

    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const errorOutput = join(dir, "browser.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless",
          "--disable-gpu",
          "--window-size=1000,700",
          "--no-first-run",
          "--no-default-browser-check",
          "--ignore-certificate-errors",
          `--host-resolver-rules=MAP ${WEBVIEW_HOST}:443 127.0.0.1:${webviews.port}, EXCLUDE 127.0.0.1, MAP * ~NOTFOUND`,
          `--user-data-dir=${join(dir, "profile")}`,
          `${worldOrigin}/start`,
        ],
        { stdout: "ignore", stderr: Bun.file(errorOutput) },
      );
      const exited = child.exited.then(async (code) => {
        throw new Error(
          `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
        );
      });
      const { hostile, violations } = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        exited,
        "Webview origin",
        40_000,
      );
      const webviewOrigin = `https://${WEBVIEW_HOST}`;
      // The IDE page framed VS Code's webview origin, and only that one.
      expect(hostile).not.toBeNull();
      expect(hostile!.messageOrigin).toBe(webviewOrigin);
      expect(hostile!.origin).toBe(webviewOrigin);
      expect(violations).toEqual(["https://elsewhere.example"]);
      // Its content sees none of World's cookies or storage...
      expect(hostile!.cookie).toBe("");
      expect(hostile!.storage).toBeNull();
      // ...can't reach World's window...
      expect(hostile!.top).toBe("SecurityError");
      expect(hostile!.parentStorage).toBe("SecurityError");
      // ...and World refuses its API and socket requests by their origin;
      // they don't carry World's session cookie either.
      expect(hostile!.fetch).toBe("TypeError");
      expect(hostile!.socket).not.toBe("open");
      expect(crossOrigin.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: "/rpc", origin: webviewOrigin, status: 403, cookie: null },
        { path: "/ws", origin: webviewOrigin, status: 403, cookie: null },
      ]);
      // Its service worker can cover only its own origin, never World's.
      expect(hostile!.worldWorker).toBe("SecurityError");
      expect(
        hostile!.ownWorker === `${webviewOrigin}/` ||
          hostile!.ownWorker === "SecurityError",
      ).toBe(true);
    } finally {
      world.stop(true);
      webviews.stop(true);
      ide.stop(true);
      await stopChrome(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
  50_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
