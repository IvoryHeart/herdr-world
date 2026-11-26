import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { stopChrome } from "../../browserChrome";
import { assetUrlImports } from "../testing/assetUrlImports";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

// The Library's (#1027) ordering and ownership rules, as
// MemoryLibraryLifecycle.browser.tsx drives them against a scripted client:
// uncertain-save recovery, a named host disconnecting, and searches overtaken
// by a reader or host change. One desktop viewport: the rules are not layout.
test.skipIf(!chrome)(
  "the Library keeps drafts, hosts and searches to their owner",
  async () => {
    const [width, height] = [1300, 800];
    const dir = await mkdtemp(join(tmpdir(), "memory-lifecycle-test-"));
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
          return new Response(
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/MemoryLibraryLifecycle.browser.css"></head><body><script type="module" src="/MemoryLibraryLifecycle.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(import.meta.dir, "MemoryLibraryLifecycle.browser.tsx"),
        ],
        outdir: dir,
        target: "browser",
        // The Library's reader can show a PDF (#1327), so PDF.js's worker
        // URL is in the bundle.
        plugins: [assetUrlImports],
      });
      if (!build.success) throw new Error(build.logs.join("\n"));
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      const errorOutput = join(dir, "browser.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless",
          "--disable-gpu",
          `--window-size=${width},${height}`,
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(errorOutput) },
      );
      const failures = await Promise.race([
        promise,
        child.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
          );
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("The Library lifecycle checks timed out")),
            40_000,
          );
        }),
      ]);
      expect(failures).toEqual([]);
    } finally {
      clearTimeout(timer);
      server.stop(true);
      await stopChrome(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
