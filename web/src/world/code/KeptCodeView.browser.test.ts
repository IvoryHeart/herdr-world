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
  "Code view keeps VS Code loaded behind Town and Spaces (#1262)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "kept-code-view-test-"));
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const assets = new Map<string, Blob>();
    const pageRequested = Promise.withResolvers<void>();
    const counted = { ide: 0, webview: 0 };
    // VS Code's webviews come from another origin: another port here.
    const webviews = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        counted.webview++;
        return new Response(
          '<!doctype html><body>preview<script>parent.postMessage({ webview: Math.random().toString(36).slice(2) }, "*");</script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
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
        if (path === "/loads") return Response.json(counted);
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/ide/")) {
          // A workbench: an editor, a webview, and what it saw of itself.
          counted.ide++;
          return new Response(
            `<!doctype html><body style="margin:0"><textarea id="editor"></textarea><iframe src="${webviews.url.href}webview"></iframe><script>
              window.loadToken = Math.random().toString(36).slice(2);
              window.sizes = [];
              window.webviews = [];
              addEventListener("resize", () => sizes.push([innerWidth, innerHeight]));
              addEventListener("message", (event) => {
                if (event.data && event.data.webview) webviews.push(event.data.webview);
              });
            </script></body>`,
            { headers: { "Content-Type": "text/html" } },
          );
        }
        if (path === "/") {
          return new Response(
            '<head><link rel="stylesheet" href="/KeptCodeView.browser.css"></head><body><div id="root"></div><script src="/KeptCodeView.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "KeptCodeView.browser.tsx")],
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
        "Kept Code view checks",
        30_000,
      );
      expect(failures).toEqual([]);
    } finally {
      server.stop(true);
      webviews.stop(true);
      await page?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
