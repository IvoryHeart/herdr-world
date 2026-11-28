import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";

const chrome = chromeBinary;

test.skipIf(!chrome)(
  "the shell-owned Inspector stays interactive outside the hidden Spaces tree",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-inspector-portal-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<Record<string, boolean>>();
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
          '<body><script type="module" src="/WorkspaceInspectorPortal.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorkspaceInspectorPortal.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      page = await openChromePage({ viewport: { width: 1280, height: 900 } });
      await page.command("Page.navigate", { url: server.url.href });
      const observed = await Promise.race([
        result.promise,
        page.exited,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Inspector portal timed out")),
            15_000,
          ),
        ),
      ]);
      expect(observed).toEqual({
        outsideHiddenOwner: true,
        interactive: true,
        portalClass: true,
      });
    } finally {
      await page?.close();
      server.stop(true);
    }
  },
);
