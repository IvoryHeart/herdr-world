import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

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
    let browser: ReturnType<typeof Bun.spawn> | undefined;
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
      browser?.kill();
      server.stop(true);
    }
  },
);
