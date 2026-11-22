import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stopChrome, withBrowserDeadline } from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

// FeatureHosts.browser.tsx: the "dialogs" feature slot still opens and
// closes Apartments and the Memory Library. One desktop viewport: the
// dialogs' own layouts have their own suites.
test.skipIf(!chrome)(
  "the dialogs feature slot opens Apartments and the Memory Library",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "feature-hosts-"));
    const { assets } = await buildWorldBrowserBundle("FeatureHosts", dir);
    const result = Promise.withResolvers<string[]>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset =
          path === "/"
            ? Bun.file(join(dir, "FeatureHosts/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--disable-gpu",
          "--window-size=1300,800",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: "ignore" },
      );
      expect(
        await withBrowserDeadline(result.promise, "feature hosts", 45_000),
      ).toEqual([]);
    } finally {
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
