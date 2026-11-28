import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";

const chrome = chromeBinary;

test.skipIf(!chrome)(
  "mobile Tabs restores qualified windows and keeps native tab actions",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "mobile-tab-sheet-test-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<unknown>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><link rel="stylesheet" href="/MobileTabSheet.browser.css"><script type="module" src="/MobileTabSheet.browser.js"></script></head><body></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "MobileTabSheet.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-test-assets",
            setup(builder) {
              builder.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
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
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      page = await openChromePage({ viewport: { width: 800, height: 600 } });
      await page.command("Page.navigate", { url: server.url.href });
      const observed = await Promise.race([
        result.promise,
        page.exited,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Mobile tab sheet timed out")),
            10_000,
          ),
        ),
      ]);
      expect(observed).toEqual({
        touchRows: true,
        flatRows: true,
        button: true,
        events: [
          "restore:alpha",
          "resume:one",
          "focus:one",
          "close",
          "show",
          "restore:beta",
          "close",
          "show",
        ],
        rows: 2,
        minimized: true,
        hasClose: true,
        hasNew: true,
      });
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
