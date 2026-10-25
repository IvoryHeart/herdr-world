import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import { chromeRenderingFlags } from "../testing/chromeRendering";

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

test.skipIf(!chrome).each([
  [1440, 900, "typical", 0],
  [390, 900, "typical", 0],
  // Stable cached/healthy hosts: cold signs and cull/remount use committed refs.
  [390, 844, "recovery", 0],
  [1440, 900, "recovery", 0],
  [1440, 900, "max", 0],
  // Extended rooms (100, 50 and 24 desks) on a phone, half-width, wide and
  // portrait screens: the town's shape follows the container.
  [390, 844, "extended", 0],
  [960, 1080, "extended", 0],
  [1440, 900, "extended", 0],
  [1080, 1920, "extended", 0],
  // Regress fixed-delay zoom-out retries on a slow software renderer.
  [1080, 1920, "extended", 300],
  // Ordinary idle desks expand in repeated 20-desk steps until fully visible.
  [390, 844, "incremental", 0],
  [1440, 900, "plates", 0],
  [390, 844, "plates", 0],
  // The 26-tab fixture proves a native-order prefix and hidden-attention corners.
  [390, 844, "fold", 0],
  [960, 1080, "fold", 0],
  [1440, 900, "fold", 0],
  [1080, 1920, "fold", 0],
  [2560, 1440, "fold", 0],
  [390, 844, "fold-protected", 0],
  // A dense busy room still folds to 24, marking hidden attention on its tile.
  [390, 844, "protected", 0],
  // Request a room beyond admission while renderer initialization is held.
  [390, 844, "navigation", 0],
  [1440, 900, "navigation", 0],
])(
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
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "TownCanvas.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);
      const browserLog = join(dir, "browser.log");
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
          `${server.url.href}?mode=test&scale=${scale}&flightFrameDelay=${flightFrameDelay}`,
        ],
        { stdout: "ignore", stderr: Bun.file(browserLog) },
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
        // Extended towns at large windows paint far more pixels in software.
        scale === "extended" || scale === "protected" ? 80_000 : 40_000,
      );
      expect(failures).toEqual([]);
    } finally {
      if (browser) {
        browser.kill();
        await browser.exited;
      }
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  95_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
