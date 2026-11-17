/**
 * herdr.world's Town screenshots: captures the production TownCanvas with the
 * website's synthetic scene (web/src/world/testing/site-shots/scene.ts) and
 * writes the shared PNGs the site and README use. It starts no World or
 * Herdr and contacts no service. Run through the browser queue:
 *
 *   SITE_SCREENSHOTS=1 CHROME_BIN=… bun run test scripts/site-screenshots.browser.test.ts
 *
 * It then draws the sharing images (scripts/site-social-card.ts) with the new
 * Town capture into site/.
 *
 * SITE_SCREENSHOTS_OUTPUT sets the directory (default docs/images), and
 * SITE_SOCIAL_OUTPUT the sharing images' (default site).
 * HERDR_WORLD_TEST_GPU=1 renders with the hardware GPU instead of SwiftShader.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Cdp, endpoint } from "./town-golden";
import { socialCardHtml, socialCards } from "./site-social-card";
import {
  GPU_FLAGS,
  SWIFTSHADER_FLAGS,
} from "../web/src/world/testing/chromeRendering";

type ZoomStep = "all" | "in" | "out";

/**
 * One shared screenshot: its file, CSS viewport, the camera steps before it
 * and its device pixel ratio (`scale`, default 1); the PNG is the viewport
 * times the scale.
 */
export type SiteShot = {
  file: string;
  width: number;
  height: number;
  scale?: number;
  mobile: boolean;
  view?: "town" | "board";
  zoom: readonly ZoomStep[];
};

export const siteShots: readonly SiteShot[] = [
  // The whole town: receptions, expenses, the fuel board and the post office.
  {
    file: "herdr-world-desktop-town.png",
    width: 1680,
    height: 1050,
    mobile: false,
    zoom: [],
  },
  // Two zoom steps reach the desks, where thought bubbles name each step.
  {
    file: "herdr-world-desktop-town-steps.png",
    width: 1680,
    height: 1050,
    mobile: false,
    zoom: ["in", "in"],
  },
  // Board fits one host to a smaller window, drawn at 1.5× so its cards read.
  {
    file: "herdr-world-desktop-board.png",
    width: 1120,
    height: 700,
    scale: 1.5,
    mobile: false,
    view: "board",
    zoom: [],
  },
  {
    file: "herdr-world-mobile-town.png",
    width: 390,
    height: 844,
    mobile: true,
    zoom: [],
  },
];

const root = resolve(import.meta.dir, "..");
const page = join(
  root,
  "web/src/world/testing/site-shots/SiteShots.browser.tsx",
);

export async function runSiteScreenshots(options: {
  chrome: string;
  directory: string;
  /** Where the sharing images go; none are drawn when omitted. */
  socialDirectory?: string;
  gpu?: boolean;
  shots?: readonly SiteShot[];
}) {
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const town = join(directory, "herdr-world-desktop-town.png");
  const scratch = await mkdtemp(join(tmpdir(), "site-screenshots-"));
  const assets = new Map<string, Blob>();
  const receipts: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/social")
        return new Response(socialCardHtml(), {
          headers: { "Content-Type": "text/html" },
        });
      if (path === "/town.png") return new Response(Bun.file(town));
      if (path === "/logo.svg")
        return new Response(
          Bun.file(join(root, "site/assets/herdr-world-logo.svg")),
        );
      if (/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path))
        return new Response(Bun.file(join(root, "site/film", path)));
      if (path === "/")
        return new Response(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/SiteShots.browser.css"></head><body><div id="root"></div><script type="module" src="/SiteShots.browser.js"></script></body></html>',
          { headers: { "Content-Type": "text/html" } },
        );
      const asset = assets.get(path);
      return asset
        ? new Response(asset)
        : new Response("Not found", { status: 404 });
    },
  });
  const browser = Bun.spawn(
    [
      options.chrome,
      "--headless=new",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--enable-webgl",
      ...(options.gpu ? GPU_FLAGS : SWIFTSHADER_FLAGS),
      "--disable-background-networking",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(scratch, "profile")}`,
      "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  let cdp: Cdp | undefined;
  try {
    const build = await Bun.build({
      entrypoints: [page],
      outdir: join(scratch, "bundle"),
      target: "browser",
    });
    if (!build.success)
      throw new AggregateError(build.logs, "Site scene build failed");
    for (const output of build.outputs)
      assets.set("/" + basename(output.path), output);
    cdp = await Cdp.connect(await endpoint(browser.stderr));
    const version = (await cdp.command("Browser.getVersion")).product;
    for (const shot of options.shots ?? siteShots) {
      const { targetId } = await cdp.command("Target.createTarget", {
        url: "about:blank",
      });
      try {
        const { sessionId } = await cdp.command("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        const command = (method: string, params = {}) =>
          cdp!.command(method, params, sessionId);
        await command("Emulation.setDeviceMetricsOverride", {
          width: shot.width,
          height: shot.height,
          deviceScaleFactor: shot.scale ?? 1,
          mobile: shot.mobile,
        });
        if (shot.mobile)
          await command("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 5,
          });
        await command("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: "dark" }],
        });
        await command("Page.enable");
        await command("Page.addScriptToEvaluateOnNewDocument", {
          source:
            'window.siteLoaded = new Promise(r => addEventListener("load", r, { once: true }));',
        });
        await command("Page.navigate", {
          url: `${server.url.href}?view=${shot.view ?? "town"}&townPostFixture`,
        });
        const evaluate = async (expression: string) => {
          const result = await command("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result.exceptionDetails)
            throw new Error(
              result.exceptionDetails.exception?.description ??
                result.exceptionDetails.text,
            );
          return result.result.value;
        };
        let state = await evaluate(
          "window.siteLoaded.then(() => window.siteShots.ready)",
        );
        for (const step of shot.zoom)
          state = await evaluate(
            `window.siteShots.zoom(${JSON.stringify(step)})`,
          );
        const image = await command("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
        });
        await Bun.write(
          join(directory, shot.file),
          Buffer.from(image.data, "base64"),
        );
        receipts.push({ file: shot.file, state });
      } finally {
        await cdp.command("Target.closeTarget", { targetId });
      }
    }
    if (options.socialDirectory) {
      const social = resolve(options.socialDirectory);
      for (const card of socialCards) {
        const { targetId } = await cdp.command("Target.createTarget", {
          url: "about:blank",
        });
        try {
          const { sessionId } = await cdp.command("Target.attachToTarget", {
            targetId,
            flatten: true,
          });
          const command = (method: string, params = {}) =>
            cdp!.command(method, params, sessionId);
          await command("Emulation.setDeviceMetricsOverride", {
            width: card.width,
            height: card.height,
            deviceScaleFactor: 1,
            mobile: false,
          });
          await command("Page.enable");
          await command("Page.addScriptToEvaluateOnNewDocument", {
            source:
              'window.cardLoaded = new Promise(r => addEventListener("load", r, { once: true }));',
          });
          await command("Page.navigate", { url: `${server.url.href}social` });
          await command("Runtime.evaluate", {
            expression:
              "window.cardLoaded.then(() => document.fonts.ready).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))",
            awaitPromise: true,
          });
          const image = await command("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
          });
          await Bun.write(
            join(social, card.file),
            Buffer.from(image.data, "base64"),
          );
          receipts.push({ file: card.file });
        } finally {
          await cdp.command("Target.closeTarget", { targetId });
        }
      }
    }
    return { browser: version, receipts };
  } finally {
    cdp?.close();
    browser.kill();
    await browser.exited;
    server.stop(true);
    await rm(scratch, { recursive: true, force: true });
  }
}
