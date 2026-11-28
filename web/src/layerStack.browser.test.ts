import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { withBrowserDeadline } from "./browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "./testing/sharedChrome";

// Desktop with a mouse, a 390px window with a mouse, and a 390px phone.
const cases = [
  { width: 1100, height: 700, touch: false },
  { width: 390, height: 800, touch: false },
  { width: 390, height: 800, touch: true },
];

for (const { width, height, touch } of cases)
  test.skipIf(!chrome)(
    `transient layers over a terminal close top first (${width}px${touch ? ", touch" : ""})`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layer-stack-test-"));
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const assets = new Map<string, Blob>();
      let cdp: (
        method: string,
        params?: Record<string, unknown>,
      ) => Promise<any> = () =>
        Promise.reject(new Error("CDP is not connected"));
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result" && request.method === "POST") {
            resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/input" && request.method === "POST") {
            const { method, params } = await request.json();
            await cdp(method, params);
            return new Response("ok");
          }
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/")
            return new Response(
              '<head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/layerStack.browser.css"></head><body><script type="module" src="/layerStack.browser.js"></script></body>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      let page: ChromePage | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "layerStack.browser.tsx")],
          outdir: dir,
          target: "browser",
          plugins: [
            {
              name: "vite-raw-test-assets",
              setup(build) {
                build.onResolve({ filter: /\?raw$/ }, (args) => ({
                  path: Bun.resolveSync(
                    args.path.slice(0, -4),
                    args.resolveDir,
                  ),
                  namespace: "raw-text",
                }));
                build.onLoad(
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
        page = await openChromePage({
          viewport: { width, height, mobile: touch },
          touch,
        });
        cdp = page.cdp;
        await page.navigate(
          `${server.url.href}?touch=${touch ? 1 : 0}&width=${width}`,
        );
        const failures = await withBrowserDeadline(
          Promise.race([promise, page.exited]),
          "Layer stack fixture",
          40_000,
        );
        expect(failures).toEqual([]);
      } finally {
        server.stop(true);
        await page?.close();
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
