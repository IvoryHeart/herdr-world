import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../testing/sharedChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: false },
  { name: "desktop", width: 1512, height: 982, mobile: false },
] as const;
// A full harbour with its +N lane, and the usual few projects; each in the
// usual two-host town and in a large one (eight hosts, six rooms each)
// whose widest zoom is much smaller.
const MODES = ["many", "ready"] as const;
const TOWNS = ["usual", "large"] as const;

test.skipIf(!chrome)(
  "every Shipyard lighthouse lamp shows above ships at every zoom, on a phone and a desktop (#1148)",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipyard-lighthouse-"));
    const { assets } = await buildWorldBrowserBundle("ShipyardLighthouse", dir);
    let result = Promise.withResolvers<string[]>(),
      requested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "ShipyardLighthouse/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      page = await openChromePage({
        viewport: { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height },
      });
      for (const viewport of VIEWPORTS)
        for (const mode of MODES)
          for (const town of TOWNS)
            for (const partial of mode === "many" && town === "usual"
              ? [false, true]
              : [false]) {
              await page.command("Emulation.setDeviceMetricsOverride", {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: 1,
                mobile: viewport.mobile,
              });
              result = Promise.withResolvers<string[]>();
              requested = Promise.withResolvers<void>();
              await page.command("Page.navigate", {
                url: `${server.url.href}?mode=${mode}${viewport.name === "phone" ? "&phone" : ""}${town === "large" ? "&large" : ""}${partial ? "&partial" : ""}`,
              });
              const scene = `${mode}-${town}-${viewport.name}${partial ? "-partial" : ""}`;
              expect({
                scene,
                failures: await waitForBrowserFixture(
                  requested.promise,
                  result.promise,
                  page.exited,
                  `Shipyard lighthouse ${scene}`,
                  BROWSER_STARTUP_TIMEOUT_MS,
                ),
              }).toEqual({ scene, failures: [] });
            }
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000,
);
