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
import { type IdeUpstream, proxyIdeHttp } from "./proxy";
import {
  FAKE_PRODUCT_PATH,
  fakeWebviewHostPage,
  fakeWorkbenchPage,
} from "./testing/fake-webview-host";
import { WEBVIEW_HOST_DIR } from "./webview-host";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const BASE = `/ide/${ID}`;
const PRE = `${BASE}${FAKE_PRODUCT_PATH}/static${WEBVIEW_HOST_DIR}`;

type Opened = { src: string; ready: boolean; echo?: string };

test.skipIf(!chrome)(
  "stock VS Code webviews run on World's origin and only for a same-origin parent",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "ide-webview-browser-"));
    const socketPath = join(dir, "ide.sock");
    // The IDE's server, as VS Code serves its two pages.
    const ide = Bun.serve({
      unix: socketPath,
      fetch(req) {
        const path = new URL(req.url).pathname;
        const html = { "content-type": "text/html" };
        if (path === `${BASE}/`)
          return new Response(fakeWorkbenchPage(BASE, workbenchScript), {
            headers: html,
          });
        if (path === `${PRE}index.html`)
          return new Response(fakeWebviewHostPage(), { headers: html });
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
    const workbenchResult = Promise.withResolvers<{
      world: Opened;
      stock: Opened;
      cdn: string[];
      endpoint: string;
    }>();
    const attackerResult = Promise.withResolvers<Opened[]>();
    // World, on 127.0.0.1; `localhost` on the same port is another origin.
    const world = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req): Promise<Response> {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/ide/")) {
          return proxyIdeHttp(req, url, upstream);
        }
        if (url.pathname === "/result" && req.method === "POST") {
          workbenchResult.resolve(await req.json());
          return new Response("ok");
        }
        if (url.pathname === "/attacker-result" && req.method === "POST") {
          attackerResult.resolve(await req.json());
          return new Response("ok");
        }
        // The IDE's host page as it ships, outside World's route.
        if (url.pathname === "/stock/pre/index.html")
          return new Response(fakeWebviewHostPage(), {
            headers: { "content-type": "text/html" },
          });
        if (url.pathname === "/start") {
          pageRequested.resolve();
          return new Response(startPage, {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const worldOrigin: string = `http://127.0.0.1:${world.port}`;
    const workbenchScript: string = `
(async () => {
  const world = await openWebview('w1', 'salt-1');
  const stock = await openWebview('s1', 'salt-1', location.origin + '/stock/pre/');
  const cdn = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('vscode-cdn.net'));
  await fetch('/result', { method: 'POST', body: JSON.stringify({ world, stock, cdn, endpoint: config.webviewEndpoint }) });
})();`;
    // Another site (where the browser starts) frames the workbench, and
    // frames World's host page itself, naming itself or World as parent.
    const startPage: string = `<!doctype html><body>
<iframe src="${worldOrigin}${BASE}/"></iframe><script>
function frame(id, parentOrigin) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    const timer = setTimeout(() => resolve({ src: iframe.src, ready: false }), 3000);
    addEventListener('message', (e) => {
      if (e.data?.target === id) { clearTimeout(timer); resolve({ src: iframe.src, ready: true }); }
    });
    iframe.src = '${worldOrigin}${PRE}index.html?' + new URLSearchParams({ id, origin: 'salt', parentOrigin });
    document.body.append(iframe);
  });
}
Promise.all([frame('own', location.origin), frame('world', '${worldOrigin}')])
  .then((results) => fetch('/attacker-result', { method: 'POST', body: JSON.stringify(results) }));
</script></body>`;
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
          `--user-data-dir=${join(dir, "profile")}`,
          `http://localhost:${world.port}/start`,
        ],
        { stdout: "ignore", stderr: Bun.file(errorOutput) },
      );
      const exited = child.exited.then(async (code) => {
        throw new Error(
          `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
        );
      });
      const result = await waitForBrowserFixture(
        pageRequested.promise,
        Promise.all([workbenchResult.promise, attackerResult.promise]),
        exited,
        "Same-origin webviews",
        30_000,
      );
      const [workbench, attacker] = result;
      // The workbench was pointed at World's own copy of the host page...
      expect(workbench.endpoint).toBe(`${worldOrigin}${PRE}`);
      // ...which ran under its recomputed CSP and handed over its port.
      expect(workbench.world).toMatchObject({ ready: true, echo: "echo:ping" });
      expect(
        workbench.world.src.startsWith(`${worldOrigin}${PRE}index.html?`),
      ).toBe(true);
      expect(workbench.cdn).toEqual([]);
      // Control: the page as it ships refuses a same-origin parent.
      expect(workbench.stock.ready).toBe(false);
      // Another origin never gets the port, whichever parent it names.
      expect(attacker.map(({ ready }) => ready)).toEqual([false, false]);
    } finally {
      world.stop(true);
      ide.stop(true);
      await stopChrome(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
