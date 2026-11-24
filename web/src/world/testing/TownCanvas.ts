import { afterAll, beforeAll, expect, test } from "bun:test";
import { type TownCanvasCase, townCanvasCases } from "../town/TownCanvas.cases";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
  waitForChromePort,
} from "../../browserChrome";
import { chromeRenderingFlags } from "./chromeRendering";
import { connectCapture } from "./connectCapture";
import {
  buildWorldBrowserBundle,
  readWorldBrowserBundle,
  type WorldBrowserBundle,
} from "./browserBundles";
let bundle: WorldBrowserBundle;
let bundleDirectory: string | undefined;
beforeAll(async () => {
  if (!chrome) return;
  if (Bun.env.HERDR_WORLD_TEST_ASSETS)
    bundle = await readWorldBrowserBundle(
      "town/TownCanvas",
      Bun.env.HERDR_WORLD_TEST_ASSETS,
    );
  else {
    bundleDirectory = await mkdtemp(join(tmpdir(), "town-bundle-"));
    bundle = await buildWorldBrowserBundle("town/TownCanvas", bundleDirectory);
  }
});
afterAll(async () => {
  if (bundleDirectory)
    await rm(bundleDirectory, { recursive: true, force: true });
});

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
  test.skipIf(!chrome).each(townCanvasCases[group] as TownCanvasCase[])(
    "the Office town renders, queues blocked agents and zooms into rooms at %ipx by %ipx (%s, %ims zoom frames)",
    async (width, height, scale, flightFrameDelay) => {
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
      let devtools: Awaited<ReturnType<typeof connectCapture>> | undefined;
      try {
        for (const [path, output] of bundle.assets) assets.set(path, output);
        const browserLog = join(dir, "browser.log");
        // Every case pins its CSS viewport over CDP: `--window-size` alone
        // gives headless Chrome a wider viewport than a 390px phone (#643),
        // and the fixture fails when the size it measures differs.
        const fixtureUrl = `${server.url.href}?mode=test&scale=${scale}&flightFrameDelay=${flightFrameDelay}&edgeFrameDelay=${width === 390 && height === 844 && scale === "extended" ? 300 : 0}&viewport=${width}x${height}`;
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
            "--remote-debugging-port=0",
            "about:blank",
          ],
          { stdout: "ignore", stderr: Bun.file(browserLog) },
        );
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
          // (the 1080x1920 slow-frame case took 54 s to 80 s on main, and the
          // 1440x900 typical case 40 s on CI against 20 s locally). The
          // full bus trip (townBusTrip.browser.ts) has its own case:
          // combined with typical's interactions, and waiting for drawn
          // frames at every sampled second, it took 109 s locally on two
          // cores and exceeded this guard on CI. It now samples without
          // drawn frames (#1183).
          scale === "extended" ||
            scale === "protected" ||
            scale === "max" ||
            ((scale === "typical" || scale === "bus") && width >= 1440)
            ? LARGE_TOWN_FIXTURE_MS
            : 60_000,
        ).catch(async (error: Error) => {
          const state = await devtools!
            .command("Runtime.evaluate", {
              expression:
                "JSON.stringify({progress: window.__townCheckProgress?.slice(-12), renderer: (({frames, flying, transitioning, level, buildingsDrawn}) => ({frames, flying, transitioning, level, buildingsDrawn}))(window.__HERDR_TOWN_RENDERER__ ?? {})})",
              returnByValue: true,
            })
            .catch(() => undefined);
          throw new Error(
            `${error.message}: ${state?.result.value ?? "browser unavailable"}`,
          );
        });
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
  const socket = await connectCapture(port);
  const { command } = socket;
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  // A page opened over DevTools is not the focused window, so focus events
  // (the room card opens on focus) need focus emulation.
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  await command("Page.navigate", { url });
  return socket;
}
