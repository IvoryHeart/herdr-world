import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../../testing/sharedChrome";

test.skipIf(!chrome)(
  "Code view: gate, full-bleed frame, folding rail and SSH host IDE",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "code-view-test-"));
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
        if (path.startsWith("/ide/"))
          return new Response("<!doctype html><body>fake workbench</body>", {
            headers: { "Content-Type": "text/html" },
          });
        if (path === "/") {
          return new Response(
            '<head><link rel="stylesheet" href="/CodeView.browser.css"></head><body><div id="root"></div><script src="/CodeView.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "CodeView.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "raw-agent-icons",
            setup(build) {
              build.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
                namespace: "raw",
              }));
              build.onLoad(
                { filter: /.*/, namespace: "raw" },
                async (args) => ({
                  contents: await readFile(args.path, "utf8"),
                  loader: "text",
                }),
              );
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({ viewport: { width: 1000, height: 700 } });
      void page.navigate(server.url.href).catch(() => {});
      const failures = await waitForBrowserFixture(
        pageRequested.promise,
        promise,
        page.exited,
        "Browser regression checks",
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
