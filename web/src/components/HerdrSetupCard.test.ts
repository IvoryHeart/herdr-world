import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { withBrowserDeadline } from "../browserChrome";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

for (const backend of ["chrome", "webkit"] as const) {
  test.skipIf(backend === "webkit" ? process.platform !== "darwin" : !chrome)(
    `Herdr setup card confirms changes, handles failures and fits narrow layouts (${backend})`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "herdr-setup-ui-"));
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
          if (assets.has(path)) return new Response(assets.get(path));
          if (path === "/")
            return new Response(
              '<head><link rel="stylesheet" href="/HerdrSetupCard.browser.css"></head><body><script type="module" src="/HerdrSetupCard.browser.js"></script></body>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      let view: Bun.WebView | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "HerdrSetupCard.browser.tsx")],
          outdir: dir,
          target: "browser",
        });
        expect(build.success).toBe(true);
        for (const asset of build.outputs)
          assets.set(`/${basename(asset.path)}`, asset);
        view = new Bun.WebView({
          width: 1280,
          height: 800,
          // Never connect tests to the user's existing Chrome session.
          backend:
            backend === "chrome"
              ? { type: "chrome", path: chrome!, url: false }
              : "webkit",
          dataStore: "ephemeral",
        });
        const failures = await withBrowserDeadline(
          view.navigate(server.url.href).then(() => promise),
          `Herdr setup ${backend} checks`,
          30_000,
        );
        expect(failures).toEqual([]);
      } finally {
        view?.close();
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    45_000,
  );
}
