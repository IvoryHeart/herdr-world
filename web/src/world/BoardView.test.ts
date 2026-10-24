import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForChromePort,
  waitForBrowserFixture,
  withBrowserDeadline,
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
  [1440, "", ""],
  [390, "", ""],
  // Reduced motion: moves land at once, and still reach their places.
  [1440, " with reduced motion", ""],
  [
    320,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
  [
    360,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
  [
    430,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
])(
  "Board renders, settles, folds, tidies and zooms at %ipx%s",
  async (width, motion, scenario) => {
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
    let socket: WebSocket | undefined;
    let cdp:
      | ((method: string, params?: object) => Promise<Record<string, unknown>>)
      | undefined;
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
          "--remote-debugging-port=0",
          `--window-size=${width},900`,
          ...(motion === " with reduced motion"
            ? ["--force-prefers-reduced-motion"]
            : []),
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(browserLog) },
      );
      // Headless Chrome clamps a narrow window to 500 CSS px. Set the actual
      // viewport before navigation; all setup remains in the startup deadline.
      const requested = (async () => {
        const port = await waitForChromePort(
          browser!,
          join(dir, "profile"),
          browserLog,
        );
        const targets = (await withBrowserDeadline(
          fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
            response.json(),
          ),
          "Board debugger discovery",
        )) as { type: string; webSocketDebuggerUrl: string }[];
        socket = new WebSocket(
          targets.find((target) => target.type === "page")!
            .webSocketDebuggerUrl,
        );
        await withBrowserDeadline(
          new Promise<void>((resolve, reject) => {
            socket!.onopen = () => resolve();
            socket!.onerror = () =>
              reject(new Error("Board CDP connection failed"));
          }),
          "Board CDP connection",
        );
        let id = 0;
        const pending = new Map<
          number,
          {
            resolve(value: Record<string, unknown>): void;
            reject(reason: Error): void;
          }
        >();
        socket.onmessage = (event) => {
          const response = JSON.parse(String(event.data));
          const request = pending.get(response.id);
          if (!request) return;
          pending.delete(response.id);
          if (response.error) request.reject(new Error(response.error.message));
          else request.resolve(response.result);
        };
        cdp = (method, params = {}) =>
          withBrowserDeadline(
            new Promise((resolve, reject) => {
              pending.set(++id, { resolve, reject });
              socket!.send(JSON.stringify({ id, method, params }));
            }),
            `Board CDP ${method}`,
          );
        await cdp("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: width <= 720,
        });
        await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
        if (width <= 720)
          await cdp("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
        // BOARD_SCENARIO="<name>[|<name>…]" selects focused diagnostics.
        const chosen = Bun.env.BOARD_SCENARIO || scenario;
        await cdp("Page.navigate", {
          url: `${server.url.href}?mode=test&width=${width}${chosen ? `&scenario=${encodeURIComponent(chosen)}` : ""}`,
        });
        await pageRequested.promise;
      })();
      const failures = await waitForBrowserFixture(
        requested,
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
      if (Bun.env.BOARD_CAPTURE_DIR && cdp) {
        await mkdir(Bun.env.BOARD_CAPTURE_DIR, { recursive: true });
        await cdp("Runtime.evaluate", {
          expression:
            "document.querySelector('.board-tray button[aria-label=Close]')?.click()",
        });
        const capture = await cdp("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: false,
        });
        await Bun.write(
          join(
            Bun.env.BOARD_CAPTURE_DIR,
            `board-work-${width}${motion === " with reduced motion" ? "-reduced" : ""}.png`,
          ),
          Buffer.from(String(capture.data), "base64"),
        );
      }
    } finally {
      socket?.close();
      await stopChrome(browser);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
