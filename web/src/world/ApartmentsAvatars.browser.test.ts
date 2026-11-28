import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  { name: "laptop", width: 1512, height: 982, mobile: false },
] as const;
// The list, and a resident opened: hopper shows the nearest avatar and
// turing (a herdr-core resident with no profile for its harness) the default.
const SCENES = ["", "hopper", "turing"] as const;

test.skipIf(!chrome)(
  "every Apartments resident shows an avatar, kept or nearest, on a phone and a desktop",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "apartments-avatars-"));
    const { assets } = await buildWorldBrowserBundle("ApartmentsAvatars", dir);
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
            ? Bun.file(join(dir, "ApartmentsAvatars/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    // Evidence captures for the PR, only when asked for.
    const captures = Bun.env.APARTMENTS_CAPTURES;
    if (captures) await mkdir(captures, { recursive: true });
    let page: ChromePage | undefined;
    try {
      // Pixels only when the optional captures are taken.
      page = await openChromePage({
        viewport: { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height },
        pixels: !!captures,
      });
      for (const viewport of VIEWPORTS)
        for (const open of SCENES) {
          await page.command("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.mobile,
          });
          result = Promise.withResolvers<string[]>();
          requested = Promise.withResolvers<void>();
          await page.command("Page.navigate", {
            url: `${server.url.href}${open ? `?open=${open}` : ""}`,
          });
          const scene = `${open || "list"}-${viewport.name}`;
          expect({
            scene,
            failures: await waitForBrowserFixture(
              requested.promise,
              result.promise,
              page.exited,
              `Apartments avatars ${scene}`,
              BROWSER_STARTUP_TIMEOUT_MS,
            ),
          }).toEqual({ scene, failures: [] });
          if (!captures) continue;
          for (const theme of ["dark", "light"] as const) {
            await page.command("Runtime.evaluate", {
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
              awaitPromise: true,
            });
            const shot = await page.command("Page.captureScreenshot", {
              format: "png",
            });
            await writeFile(
              join(captures, `${scene}-${theme}.png`),
              Buffer.from(shot.data, "base64"),
            );
          }
        }
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000,
);
