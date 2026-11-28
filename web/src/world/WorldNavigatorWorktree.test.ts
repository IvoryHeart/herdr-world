import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary as chrome,
  openChromePage,
} from "../testing/sharedChrome";

test.skipIf(!chrome)(
  "World navigator offers worktree actions on repository workspaces on desktop and phone, inert on a stale host",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-navigator-worktree-"));
    const assets = new Map<string, Blob>();
    const results = new Map([
      ["desktop", Promise.withResolvers<unknown>()],
      ["phone", Promise.withResolvers<unknown>()],
    ]);
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result" && request.method === "POST") {
          const body = (await request.json()) as { mode?: string };
          results.get(String(body.mode))?.resolve(body);
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/WorldNavigatorWorktree.browser.css"><script type="module" src="/WorldNavigatorWorktree.browser.js"></script></head><body></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorldNavigatorWorktree.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        define: {
          __HERDR_WORLD_VERSION__: JSON.stringify("test"),
          __HERDR_WORLD_DEVTOOLS__: "false",
        },
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
      for (const output of build.outputs)
        assets.set(`/${basename(output.path)}`, output);

      for (const [mode, size] of [
        ["desktop", { width: 1280, height: 800 }],
        ["phone", { width: 390, height: 844 }],
      ] as const) {
        const page = await openChromePage({ viewport: size });
        try {
          await page.navigate(`${server.url.href}?mode=${mode}`);
          const observed = await Promise.race([
            results.get(mode)!.promise,
            page.exited,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error(`${mode} worktree navigator timed out`)),
                20_000,
              ),
            ),
          ]);
          expect(observed).toMatchObject({ mode, failures: [] });
        } finally {
          await page.close();
        }
      }
    } finally {
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
