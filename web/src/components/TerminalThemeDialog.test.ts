import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";

const chrome = chromeBinary;

test.skipIf(!chrome)(
  "terminal theme editor preserves focus, palette, and saved themes",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "terminal-theme-test-"));
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
            '<head><link rel="stylesheet" href="/TerminalThemeDialog.browser.css"></head><body><script src="/TerminalThemeDialog.browser.js"></script></body>',
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
        entrypoints: [join(import.meta.dir, "TerminalThemeDialog.browser.tsx")],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({ viewport: { width: 800, height: 600 } });
      await page.command("Page.navigate", { url: server.url.href });
      const failures = await Promise.race([
        promise,
        page.exited,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Browser regression checks timed out")),
            30_000,
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
  45_000,
);
