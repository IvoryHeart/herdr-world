import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../../testing/sharedChrome";

test.skipIf(!chrome).each(["fine", "coarse", "none"])(
  "shared window frame coordinates presentation with a %s pointer",
  async (pointer) => {
    const dir = await mkdtemp(join(tmpdir(), "spaces-tab-window-test-"));
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
          '<head><link rel="stylesheet" href="/WindowFrame.browser.css"></head><body><div id="root"></div><script src="/WindowFrame.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "WindowFrame.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-svg",
            setup(builder) {
              builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
                path: Bun.resolveSync(
                  args.path.slice(0, -"?raw".length),
                  dirname(args.importer),
                ),
                namespace: "vite-raw-svg",
              }));
              builder.onLoad(
                { filter: /.*/, namespace: "vite-raw-svg" },
                async (args) => ({
                  contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
                  loader: "js",
                }),
              );
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({
        viewport: { width: 1100, height: 700 },
        launchFlags: [
          pointer === "coarse"
            ? "--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1"
            : pointer === "fine"
              ? "--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=2,availableHoverTypes=2"
              : "--blink-settings=primaryPointerType=1,availablePointerTypes=1,primaryHoverType=1,availableHoverTypes=1",
        ],
      });
      await page.command("Page.navigate", {
        url: `${server.url.href}?pointer=${pointer}`,
      });
      const failures = await waitForBrowserFixture(
        pageRequested.promise,
        promise,
        page.exited,
        "Window frame browser test",
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
