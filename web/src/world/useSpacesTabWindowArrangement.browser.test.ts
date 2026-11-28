import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";

test.skipIf(!chrome)(
  "Spaces arrangement keeps terminal windows scoped and hands focus to the right owner",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "spaces-arrangement-test-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<unknown>();
    const pageRequested = Promise.withResolvers<void>();
    const progress: unknown[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/progress" && request.method === "POST") {
          progress.push(await request.json());
          if (progress.length > 5) progress.shift();
          return new Response("ok");
        }
        if (path === "/result" && request.method === "POST") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path === "/") {
          pageRequested.resolve();
          return new Response(
            '<head><link rel="stylesheet" href="/useSpacesTabWindowArrangement.browser.css"></head><body><div id="root"></div><script src="/useSpacesTabWindowArrangement.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "useSpacesTabWindowArrangement.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "spaces-arrangement-store-fixture",
            setup(builder) {
              builder.onResolve(
                {
                  filter:
                    /^\.\.\/(store|layoutPreferences|components\/TabBar)$/,
                },
                (args) =>
                  args.importer.endsWith("/useSpacesTabWindowArrangement.tsx")
                    ? {
                        path: join(
                          import.meta.dir,
                          "useSpacesTabWindowArrangement.browserMock.ts",
                        ),
                      }
                    : undefined,
              );
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      for (const output of build.outputs) {
        assets.set(`/${basename(output.path)}`, output);
      }
      page = await openChromePage({ viewport: { width: 1200, height: 900 } });
      await page.command("Page.navigate", { url: server.url.href });
      const failures = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        page.exited,
        "Spaces arrangement browser check",
        30_000,
      );
      expect(failures).toEqual([]);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Spaces arrangement browser check")
      ) {
        error.message += `; latest progress: ${JSON.stringify(progress)}`;
      }
      throw error;
    } finally {
      server.stop(true);
      await page?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
