import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorldBrowserBundle,
  readWorldBrowserBundle,
  type WorldBrowserBundle,
} from "./testing/browserBundles";
let bundle: WorldBrowserBundle;
let bundleDirectory: string | undefined;
beforeAll(async () => {
  if (!chrome) return;
  if (Bun.env.HERDR_WORLD_TEST_ASSETS)
    bundle = await readWorldBrowserBundle(
      "SharedViewCreation",
      Bun.env.HERDR_WORLD_TEST_ASSETS,
    );
  else {
    bundleDirectory = await mkdtemp(join(tmpdir(), "creation-bundle-"));
    bundle = await buildWorldBrowserBundle(
      "SharedViewCreation",
      bundleDirectory,
    );
  }
});
afterAll(async () => {
  if (bundleDirectory)
    await rm(bundleDirectory, { recursive: true, force: true });
});
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";
import { casePhases } from "./testing/casePhases";

test
  .skipIf(!chrome)
  .each(
    [1440, 390].flatMap((width) =>
      ["chat", "creation", "retention"].map(
        (scenario) => [width, scenario] as const,
      ),
    ),
  )(
  "rendering, focus and terminal lifecycle: shared creation across views at %ipx (%s)",
  async (width, scenario) => {
    const phases = casePhases(`SharedViewCreation ${width}px ${scenario}`);
    const dir = await mkdtemp(join(tmpdir(), "world-shared-creation-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<string[]>();
    const pageRequested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") pageRequested.resolve();
        if (path === "/viewport-ready") {
          return new Response(String(width));
        }
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response(
          '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/SharedViewCreation.browser.css"></head><body><script type="module" src="/SharedViewCreation.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      for (const [path, output] of bundle.assets) assets.set(path, output);
      phases.mark("setup");
      void pageRequested.promise.then(() => phases.mark("load"));
      page = await openChromePage({
        viewport: {
          width,
          height: width === 390 ? 844 : 1000,
          mobile: width === 390,
        },
        touch: width === 390,
        reducedMotion: true,
      });
      await page.command("Page.navigate", {
        url: `${server.url.href}?scenario=${scenario}`,
      });
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        page.exited,
        "Shared creation browser",
        25_000,
      );
      phases.mark("scene");
      if (observed.length) console.info("Shared creation failures", observed);
      expect(observed).toEqual([]);
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
      phases.done();
    }
  },
  150_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
