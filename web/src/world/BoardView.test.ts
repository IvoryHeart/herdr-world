import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import { chromeRenderingFlags } from "./testing/chromeRendering";

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
  [1440, ""],
  [390, ""],
  // Reduced motion: moves land at once, and still reach their places.
  [1440, " with reduced motion"],
])(
  "Board renders, settles, folds, tidies and zooms at %ipx%s",
  async (width, motion) => {
    const dir = await mkdtemp(join(tmpdir(), "board-test-"));
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
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/BoardView.browser.css"></head><body><script type="module" src="/BoardView.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        return new Response("Not found", { status: 404 });
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "BoardView.browser.tsx")],
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
          `--window-size=${width},900`,
          ...(motion ? ["--force-prefers-reduced-motion"] : []),
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          // BOARD_SCENARIO="<name>[|<name>…]" runs those scenarios alone, for diagnosis.
          `${server.url.href}?mode=test${Bun.env.BOARD_SCENARIO ? `&scenario=${encodeURIComponent(Bun.env.BOARD_SCENARIO)}` : ""}`,
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
        "Board browser check",
        // The check walks the whole board on test time (about 20 s of it),
        // which takes about a second locally; the rest is headroom.
        30_000,
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
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
