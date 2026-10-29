import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stopChrome, waitForBrowserFixture } from "./browserChrome";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
for (const width of [1280, 390])
  test.skipIf(!chrome)(
    `Chat text answers preserve typed digits and reset on question replacement (${width}px)`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "prompt-answers-"));
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
              `<body style="margin:0"><iframe title="Answer fixture" style="border:0;width:${width}px;height:850px" src="/fixture?width=${width}"></iframe></body>`,
              { headers: { "Content-Type": "text/html" } },
            );
          requested.resolve();
          return new Response(
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/promptAnswers.browser.css"></head><body><script type="module" src="/promptAnswers.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        },
      });
      let browser: ReturnType<typeof Bun.spawn> | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "promptAnswers.browser.tsx")],
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
        const log = join(dir, "browser.log");
        browser = Bun.spawn(
          [
            chrome!,
            "--headless=new",
            `--window-size=${width},900`,
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${join(dir, "profile")}`,
            server.url.href,
          ],
          { stdout: "ignore", stderr: Bun.file(log) },
        );
        const observed = await waitForBrowserFixture(
          requested.promise,
          result.promise,
          browser.exited.then(async (code): Promise<never> => {
            throw new Error(
              `Browser exited ${code}: ${(await readFile(log, "utf8")).slice(-4000)}`,
            );
          }),
          "Chat text answers",
          15000,
        );
        expect(observed.failures).toEqual([]);
      } finally {
        await stopChrome(browser);
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
