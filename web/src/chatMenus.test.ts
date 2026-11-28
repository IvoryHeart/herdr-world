import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { waitForBrowserFixture } from "./browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "./testing/sharedChrome";

for (const width of [1280, 390])
  test.skipIf(!chrome)(
    `Chat command menus and composer keys reach only their session (${width}px)`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "chat-menus-"));
      const result = Promise.withResolvers<{ failures: string[] }>();
      const requested = Promise.withResolvers<void>();
      const assets = new Map<string, Blob>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result") {
            result.resolve(await request.json());
            return new Response("ok");
          }
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/")
            return new Response(
              `<body style="margin:0"><iframe title="Menu fixture" style="border:0;width:${width}px;height:880px" src="/fixture?width=${width}"></iframe></body>`,
              { headers: { "Content-Type": "text/html" } },
            );
          requested.resolve();
          return new Response(
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/chatMenus.browser.css"></head><body><script type="module" src="/chatMenus.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        },
      });
      let page: ChromePage | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "chatMenus.browser.tsx")],
          outdir: dir,
          target: "browser",
          plugins: [
            {
              name: "raw-assets",
              setup(builder) {
                builder.onResolve({ filter: /\?raw$/ }, (args) => ({
                  path: Bun.resolveSync(
                    args.path.slice(0, -4),
                    args.resolveDir,
                  ),
                  namespace: "raw-text",
                }));
                builder.onLoad(
                  { filter: /.*/, namespace: "raw-text" },
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
        page = await openChromePage({ viewport: { width, height: 920 } });
        await page.command("Page.navigate", { url: server.url.href });
        const observed = await waitForBrowserFixture(
          requested.promise,
          result.promise,
          page.exited,
          "Chat command menus",
          15000,
        );
        expect(observed.failures).toEqual([]);
      } finally {
        await page?.close();
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
