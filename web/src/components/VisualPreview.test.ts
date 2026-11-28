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

for (const fixture of [
  "VisualPreview",
  "AgentHistoryDrawer",
  "AgentChat",
  "AgentLaunch",
  "OverlayScrollbarLayer",
  "ShellStyles",
  "StatusBadges",
  "InspectorPaneMap",
  "../world/town/TownBoard",
  "../world/usage/UsageLens",
]) {
  // A fixture may live beside its component; the page loads its bundle by name.
  const name = basename(fixture);
  test.skipIf(!chrome)(
    `${fixture} browser layout and interaction regressions`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "visual-preview-test-"));
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
            // Exercise Chat as on LAN HTTP, without optional secure-context APIs.
            const limitedApis =
              fixture === "AgentChat"
                ? '<script>Object.defineProperty(crypto,"randomUUID",{value:undefined});Object.defineProperty(crypto,"subtle",{value:undefined});Object.defineProperty(navigator,"clipboard",{value:undefined});</script>'
                : "";
            return new Response(
              `<head><link rel="stylesheet" href="/${name}.browser.css"></head><body>${limitedApis}<script src="/${name}.browser.js"></script></body>`,
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
          entrypoints: [join(import.meta.dir, `${fixture}.browser.tsx`)],
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
        page = await openChromePage({ viewport: { width: 800, height: 600 } });
        await page.command("Page.navigate", {
          url: `${server.url.href}${fixture === "AgentChat" ? "?limited-apis" : ""}`,
        });
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
}
