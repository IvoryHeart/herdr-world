import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../../testing/sharedChrome";

test.skipIf(!chrome)(
  "a view's panel opens a window, renders its content there and closes with Back",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-panel-test-"));
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const assets = new Map<string, Blob>();
    const pageRequested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") pageRequested.resolve();
        if (path === "/result" && request.method === "POST") {
          resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><link rel="stylesheet" href="/WorldPanel.browser.css"></head><body><div id="root"></div><script src="/WorldPanel.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "WorldPanel.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({ viewport: { width: 1100, height: 700 } });
      await page.command("Page.navigate", { url: server.url.href });
      const failures = await waitForBrowserFixture(
        pageRequested.promise,
        promise,
        page.exited,
        "World panel browser test",
        30_000,
      );
      expect(failures).toEqual([]);
    } finally {
      server.stop(true);
      await page?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
