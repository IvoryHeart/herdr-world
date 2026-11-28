import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBrowserDeadline } from "../browserChrome";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "../testing/sharedChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

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
    let page: ChromePage | undefined;
    try {
      page = await openChromePage({ viewport: { width: 1300, height: 800 } });
      await page.command("Page.navigate", { url: server.url.href });
      expect(
        await withBrowserDeadline(result.promise, "feature hosts", 45_000),
      ).toEqual([]);
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
