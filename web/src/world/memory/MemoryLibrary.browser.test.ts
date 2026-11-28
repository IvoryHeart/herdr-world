import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../../testing/sharedChrome";
import { assetUrlImports } from "../testing/assetUrlImports";

// The Library (#1027) on its synthetic host, as MemoryLibrary.browser.tsx
// drives it: a laptop shows readers, shelves and the book side by side; a
// phone shows one pane at a time with Back.
test.skipIf(!chrome).each([
  ["a laptop", 1300, 800],
  ["a phone", 390, 844],
] as const)(
  "the Library browses, edits, conflicts, deletes, adds and searches on %s",
  async (_, width, height) => {
    const dir = await mkdtemp(join(tmpdir(), "memory-library-test-"));
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const assets = new Map<string, Blob>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path === "/") {
          return new Response(
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/MemoryLibrary.browser.css"></head><body><script type="module" src="/MemoryLibrary.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "MemoryLibrary.browser.tsx")],
        outdir: dir,
        target: "browser",
        // The Library's reader can show a PDF (#1327), so PDF.js's worker
        // URL is in the bundle.
        plugins: [assetUrlImports],
      });
      if (!build.success) throw new Error(build.logs.join("\n"));
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({ viewport: { width, height } });
      void page.navigate(server.url.href).catch(() => {});
      const failures = await Promise.race([
        promise,
        page.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("The Library checks timed out")),
            40_000,
          );
        }),
      ]);
      expect(failures).toEqual([]);
    } finally {
      clearTimeout(timer);
      server.stop(true);
      await page?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
