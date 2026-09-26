import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome)(
  "World keeps navigator, docked, floating, and terminal identities aligned",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-terminal-handoff-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<unknown>();
    const publicDir = join(import.meta.dir, "..", "..", "public");
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
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(join(publicDir, path.slice(1)));
          if (await file.exists()) return new Response(file);
        }
        return new Response(
          '<head><link rel="stylesheet" href="/WorldTerminalHandoff.browser.css"></head><body><script type="module" src="/WorldTerminalHandoff.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorldTerminalHandoff.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-svg",
            setup(builder) {
              builder.onResolve({ filter: /\.svg\?raw$/ }, (args) => ({
                path: Bun.resolveSync(
                  args.path.slice(0, -"?raw".length),
                  dirname(args.importer),
                ),
                namespace: "vite-raw-svg",
              }));
              builder.onLoad(
                { filter: /.*/, namespace: "vite-raw-svg" },
                async (args) => ({
                  contents: `export default ${JSON.stringify(await Bun.file(args.path).text())}`,
                  loader: "js",
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
      const browserLog = join(dir, "browser.log");
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--window-size=1440,1000",
          "--enable-webgl",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          `${server.url.href}office`,
        ],
        { stdout: "ignore", stderr: Bun.file(browserLog) },
      );
      const observed = await Promise.race([
        result.promise,
        browser.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(browserLog, "utf8")}`,
          );
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("World terminal handoff timed out")),
            120_000,
          ),
        ),
      ]);
      expect(observed).toEqual([]);
    } finally {
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  150_000,
);
