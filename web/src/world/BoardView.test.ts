import { captureScene } from "./testing/captureScene";
import { registerCaptureReadinessTests } from "./testing/captureReadinessBrowser";
registerCaptureReadinessTests();
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../testing/sharedChrome";

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
  [1440, 900, "", ""],
  [1440, 900, " live settings", "Settings change the open Board"],
  [390, 844, "", ""],
  // A narrow desktop: Board's controls share the bottom row with the dock.
  [
    800,
    900,
    " with the bin's dock",
    "Board's hub stands with the bin, clear of Board's controls",
  ],
  // Reduced motion: moves land at once, and still reach their places.
  [1440, 900, " with reduced motion", ""],
  [
    320,
    900,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
  [
    360,
    900,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
  [
    430,
    900,
    " controls",
    "Work stays labelled and note actions survive mobile overflow",
  ],
  ...(
    [
      [1512, 982],
      [1280, 1440],
      [2560, 1440],
      [1440, 2560],
    ] as const
  ).map(
    ([width, height]) =>
      [
        width,
        height,
        " controls",
        "Work stays labelled and note actions survive mobile overflow",
      ] as const,
  ),
])(
  "Board renders, settles, folds, tidies and zooms at %ix%ipx%s",
  async (width, height, motion, scenario) => {
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
        if (path === "/herdr-world-logo.svg")
          return new Response(
            Bun.file(
              join(import.meta.dir, "../../public/herdr-world-logo.svg"),
            ),
          );
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
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "BoardView.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);
      page = await openChromePage({
        viewport: { width, height, mobile: width <= 720 },
        touch: width <= 720,
        reducedMotion: motion === " with reduced motion",
      });
      // BOARD_SCENARIO="<name>[|<name>…]" selects focused diagnostics.
      const chosen = Bun.env.BOARD_SCENARIO || scenario;
      const opened = page;
      const requested = (async () => {
        await opened.command("Page.navigate", {
          url: `${server.url.href}?mode=test&width=${width}&height=${height}${chosen ? `&scenario=${encodeURIComponent(chosen)}` : ""}`,
        });
        await pageRequested.promise;
      })();
      const failures = await waitForBrowserFixture(
        requested,
        result.promise,
        page.exited,
        "Board browser check",
        // The check walks the whole board on test time (about 20 s of it),
        // which takes about a second locally; the rest is headroom.
        30_000,
      );
      expect(failures).toEqual([]);
      {
        const command = (method: string, params?: Record<string, unknown>) =>
          opened.command(method, params) as Promise<Record<string, unknown>>;
        const writeCapture = async (filename: string) => {
          const capture = await captureScene(command, {
            view: "board",
            width,
            height,
            content: { selector: ".board-card:not(.board-note)" },
          });
          await Bun.write(filename, capture.bytes);
        };
        if (width === 1440 && height === 900 && motion === "") {
          await command("Runtime.evaluate", {
            expression: `(()=>{const s=document.createElement('style');s.id='missing-capture-content';s.textContent='.board-card{visibility:hidden!important}';document.head.append(s);})()`,
          });
          const missing = join(dir, "missing-content.png");
          let failure = "";
          try {
            await writeCapture(missing);
          } catch (error) {
            failure = String(error);
          } finally {
            await command("Runtime.evaluate", {
              expression:
                "document.getElementById('missing-capture-content').remove()",
            });
          }
          expect(failure).toContain("Capture expected content missing");
          expect(existsSync(missing)).toBe(false);
        }
        if (Bun.env.BOARD_CAPTURE_DIR) {
          await mkdir(Bun.env.BOARD_CAPTURE_DIR, { recursive: true });
          await command("Runtime.evaluate", {
            expression:
              "document.querySelector('.board-tray button[aria-label=Close]')?.click()",
          });
          await writeCapture(
            join(
              Bun.env.BOARD_CAPTURE_DIR,
              `board-work-${width}x${height}${motion === " with reduced motion" ? "-reduced" : ""}.png`,
            ),
          );
        }
      }
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
