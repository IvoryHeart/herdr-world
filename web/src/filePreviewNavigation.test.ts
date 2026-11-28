import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assetUrlImports } from "./world/testing/assetUrlImports";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "./testing/sharedChrome";

for (const narrow of [false, true])
  test.skipIf(!chrome)(
    narrow
      ? "Terminal annotations preserve drafts and focus in a narrow viewport"
      : "App file preview navigation and terminal annotation UX preserve scoped drafts and focus",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "file-preview-navigation-"));
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const assets = new Map<string, Blob>();
      const events: string[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          events.push(
            `${request.headers.has("x-fixture-self-check") ? "host" : "browser"} ${request.method} ${path}`,
          );
          if (path === "/result" && request.method === "POST") {
            resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/event" && request.method === "POST") {
            events.push(await request.text());
            return new Response("ok");
          }
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/") {
            return new Response(
              `<head><link rel="stylesheet" href="/filePreviewNavigation.browser.css"></head><body><script>
              const report = message => fetch('/event', {method: 'POST', body: message});
              report('page loaded');
              window.addEventListener('error', event => report('error: ' + event.message));
              window.addEventListener('unhandledrejection', event => report('rejection: ' + event.reason));
              </script><script type="module" src="/filePreviewNavigation.browser.js"></script></body>`,
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
          entrypoints: [
            join(import.meta.dir, "filePreviewNavigation.browser.tsx"),
          ],
          outdir: dir,
          target: "browser",
          plugins: [
            assetUrlImports,
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
        const browserUrl = `http://127.0.0.1:${server.port}/${narrow ? "?annotations-only" : ""}`;
        events.push(`server.url=${server.url.href}; browserUrl=${browserUrl}`);
        const selfCheck = await fetch(browserUrl, {
          headers: { "x-fixture-self-check": "1" },
        });
        events.push(`self-check status=${selfCheck.status}`);
        expect(selfCheck.status).toBe(200);
        page = await openChromePage({
          viewport: narrow
            ? { width: 390, height: 844 }
            : { width: 1280, height: 900 },
        });
        await page.command("Page.navigate", { url: browserUrl });
        const failures = await Promise.race([
          promise,
          page.exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `File preview navigation checks timed out: ${events.join("; ")}`,
                  ),
                ),
              45_000,
            );
          }),
        ]);
        expect(failures).toEqual([]);
      } catch (error) {
        console.error(`Browser fixture evidence: ${dir}\n${events.join("\n")}`);
        throw error;
      } finally {
        clearTimeout(timer);
        server.stop(true);
        await page?.close();
        await writeFile(join(dir, "events.log"), events.join("\n"));
        console.info(`Browser fixture evidence: ${dir}`);
      }
    },
    60_000,
  );
