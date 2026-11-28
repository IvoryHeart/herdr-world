import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
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

test.skipIf(!chrome)(
  "a visual presenter failure stays inside its view boundary",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-view-boundary-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<Record<string, unknown>>();
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
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<body><script type="module" src="/WorldViewErrorBoundary.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorldViewErrorBoundary.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      page = await openChromePage({ viewport: { width: 1280, height: 900 } });
      const opened = page;
      void opened.navigate(server.url.href).catch(() => {});
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        page.exited,
        "View boundary",
        15_000,
      );
      expect(observed).toEqual({
        fallback: true,
        spaces: "Spaces remains mounted",
        inspector: "Inspector remains mounted",
      });
    } finally {
      await page?.close();
      server.stop(true);
    }
  },
  25_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
