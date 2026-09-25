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

test.skipIf(!chrome).each([1280, 390])(
  "visual Actions stay accessible and invalidate retired targets at %ipx",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "visual-route-actions-"));
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
        if (path === "/") {
          return new Response(
            '<meta name="viewport" content="width=device-width, initial-scale=1"><body><div id="root"></div><script type="module" src="/VisualRouteActions.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "VisualRouteActions.browser.tsx")],
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
          `--window-size=${width},900`,
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
            () => reject(new Error("Actions browser check timed out")),
            15_000,
          ),
        ),
      ]);
      expect(observed).toMatchObject({
        initialVisible: true,
        keyboardOpened: true,
        calls: ["changes"],
      });
      expect(String(observed.initialMenu)).toContain("Agent History");
      expect(String(observed.selectionReason)).toContain(
        "selected item changed",
      );
      expect(String(observed.generationReason)).toContain(
        "generation is no longer available",
      );
    } finally {
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
