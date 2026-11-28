import { afterAll, beforeAll, expect, test } from "bun:test";
import { type TownCanvasCase, townCanvasCases } from "../town/TownCanvas.cases";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  type ChromePage,
  chromeBinary as chrome,
  openChromePage,
} from "../../testing/sharedChrome";
import { casePhases } from "./casePhases";
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
      const phases = casePhases(
        `TownCanvas ${width}x${height} ${scale} ${flightFrameDelay}ms`,
      );
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
      let page: ChromePage | undefined;
      try {
        for (const [path, output] of bundle.assets) assets.set(path, output);
        const fixtureUrl = `${server.url.href}?mode=test&scale=${scale}&flightFrameDelay=${flightFrameDelay}&edgeFrameDelay=${width === 390 && height === 844 && (scale === "extended" || scale.startsWith("extended-")) ? 300 : 0}&viewport=${width}x${height}`;
        // Every case pins its CSS viewport by emulation at DPR 1 (#643: the
        // fixture fails when the size it measures differs). Behaviour checks
        // skip the GPU draw; the scene graph, hit testing and DOM still run.
        page = await openChromePage({ viewport: { width, height } });
        phases.mark("chrome");
        void pageRequested.promise.then(() => phases.mark("load"));
        await page.command("Page.navigate", { url: fixtureUrl });
        const failures = await waitForBrowserFixture(
          pageRequested.promise,
          result.promise,
          page.exited,
          "Office town browser check",
          // A hang guard, not a speed budget.
          scale.startsWith("extended") ||
            scale === "protected" ||
            scale === "max" ||
            ((scale === "typical" || scale === "bus") && width >= 1440)
            ? LARGE_TOWN_FIXTURE_MS
            : 60_000,
        ).catch(async (error: Error) => {
          const state = await page!
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
        phases.mark("scene");
        expect(failures).toEqual([]);
      } finally {
        await page?.close();
        server.stop(true);
        phases.done();
      }
    },
    LARGE_TOWN_FIXTURE_MS + 15_000 + BROWSER_STARTUP_TIMEOUT_MS,
  );
}
