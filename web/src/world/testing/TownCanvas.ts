import { expect, test } from "bun:test";
import { type TownCanvasCase, townCanvasCases } from "../town/TownCanvas.cases";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
  waitForChromePort,
} from "../../browserChrome";
import { chromeRenderingFlags } from "./chromeRendering";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

const unavailableObservability = {
  health: "unavailable",
  providerId: null,
  sourceCount: 0,
  configuredSourceCount: 0,
  failedSourceCount: 0,
  observedAt: 0,
  windowSeconds: null,
  models: [],
  totalCostUsd: null,
  totalUsage: 0,
};

const LARGE_TOWN_FIXTURE_MS = 120_000;

export function registerTownCanvasCases(group: keyof typeof townCanvasCases) {
  test.skipIf(!chrome).each(
    // Bun's typed `each` takes no optional tuple element; spell it out.
    townCanvasCases[group].map(
      ([width, height, scale, delay, viewport]: TownCanvasCase) =>
        [width, height, scale, delay, viewport ?? "window"] as const,
    ),
  )(
    "the Office town renders, queues blocked agents and zooms into rooms at %ipx by %ipx (%s, %ims zoom frames)",
    async (width, height, scale, flightFrameDelay, viewport) => {
      const dir = await mkdtemp(join(tmpdir(), "office-town-test-"));
      const assets = new Map<string, Blob>();
      const result = Promise.withResolvers<unknown>();
      const pageRequested = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/") pageRequested.resolve();
          if (path === "/result" && request.method === "POST") {
            result.resolve(await request.json());
            return new Response("ok");
          }
          if (path.startsWith("/api/world/observability"))
            return Response.json(unavailableObservability);
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/")
            return new Response(
              '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/TownCanvas.browser.css"></head><body><script type="module" src="/TownCanvas.browser.js"></script></body>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      let browser: ReturnType<typeof Bun.spawn> | undefined;
      let devtools: WebSocket | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [
            join(import.meta.dir, "../town/TownCanvas.browser.tsx"),
          ],
          outdir: dir,
          target: "browser",
        });
        expect(build.success).toBe(true);
        for (const output of build.outputs)
          assets.set(`/${basename(output.path)}`, output);
        const browserLog = join(dir, "browser.log");
        const exact = viewport === "exact";
        const fixtureUrl = `${server.url.href}?mode=test&scale=${scale}&flightFrameDelay=${flightFrameDelay}&edgeFrameDelay=${width === 390 && height === 844 && scale === "extended" ? 300 : 0}${exact ? `&viewport=${width}x${height}` : ""}`;
        browser = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            `--window-size=${width},${height}`,
            "--enable-webgl",
            ...(await chromeRenderingFlags(chrome!)),
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${join(dir, "profile")}`,
            ...(exact
              ? ["--remote-debugging-port=0", "about:blank"]
              : [fixtureUrl]),
          ],
          { stdout: "ignore", stderr: Bun.file(browserLog) },
        );
        if (exact)
          devtools = await openAtExactViewport(
            await waitForChromePort(browser, join(dir, "profile"), browserLog),
            fixtureUrl,
            width,
            height,
          );
        const failures = await waitForBrowserFixture(
          pageRequested.promise,
          result.promise,
          browser.exited.then(async (code) => {
            throw new Error(
              `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
            );
          }),
          "Office town browser check",
          // A hang guard, not a speed budget. Extended and max towns at large
          // windows paint far more pixels in software, and each topology
          // change glides over drawn frames; CI runners differ by about 1.5x
          // (the 1080x1920 slow-frame case took 54 s to 80 s on main).
          scale === "extended" || scale === "protected" || scale === "max"
            ? LARGE_TOWN_FIXTURE_MS
            : 40_000,
        );
        expect(failures).toEqual([]);
      } finally {
        devtools?.close();
        if (browser) {
          browser.kill();
          await browser.exited;
        }
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    LARGE_TOWN_FIXTURE_MS + 15_000 + BROWSER_STARTUP_TIMEOUT_MS,
  );
}

/**
 * Pins the page's CSS viewport, then loads the fixture. The override lasts
 * while the returned DevTools socket stays open.
 */
async function openAtExactViewport(
  port: string,
  url: string,
  width: number,
  height: number,
) {
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as { type: string; webSocketDebuggerUrl: string }[];
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("Chrome exposed no page target");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("DevTools socket failed"));
  });
  let serial = 0;
  const pending = new Map<
    number,
    (message: { error?: { message: string } }) => void
  >();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const command = (method: string, params: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      const id = ++serial;
      pending.set(id, (message) =>
        message.error
          ? reject(new Error(`${method}: ${message.error.message}`))
          : resolve(),
      );
      socket.send(JSON.stringify({ id, method, params }));
    });
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Page.navigate", { url });
  return socket;
}
