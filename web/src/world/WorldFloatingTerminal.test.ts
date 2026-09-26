import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome)(
  "a floating Inspector keeps one portal and stable drag bounds through parent renders",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-floating-terminal-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<Record<string, unknown>>();
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
          '<head><link rel="stylesheet" href="/WorldFloatingTerminal.browser.css"></head><body><script type="module" src="/WorldFloatingTerminal.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "WorldFloatingTerminal.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
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
          "--window-size=1280,900",
          "--disable-gpu",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
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
            () =>
              reject(new Error("Floating Inspector browser check timed out")),
            10_000,
          ),
        ),
      ]);
      expect(observed).toEqual({
        failures: [],
        portal: "ready",
        inspectorLabel: "Reviewer Inspector",
        windows: 1,
        stableDrag: true,
        arrangementRestoresGeometry: true,
      });
    } finally {
      browser?.kill();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
