/**
 * Town at scale: captures the production TownCanvas with the scale scene
 * (web/src/world/town/townScaleScene.ts) at every zoom step on a laptop and a
 * phone viewport, and measures frame time while panning. Report tooling for
 * docs/design/town-at-scale.md; it starts no World or Herdr and compares no
 * pixels. Run through the browser queue:
 *
 *   TOWN_SCALE=1 CHROME_BIN=… bun run test scripts/town-scale.browser.test.ts
 *
 * TOWN_SCALE_STEPS=off measures it without the working agents' thought
 * bubbles, for comparison.
 *
 * HERDR_WORLD_TEST_GPU=1 renders with the hardware GPU instead of SwiftShader.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Cdp, endpoint } from "./town-golden";
import {
  GPU_FLAGS,
  SWIFTSHADER_FLAGS,
} from "../web/src/world/testing/chromeRendering";

export const townScaleViewports = [
  { name: "laptop", width: 1512, height: 982 },
  { name: "phone", width: 390, height: 844 },
];
const root = resolve(import.meta.dir, "..");
const page = join(
  root,
  "web/src/world/testing/town-scale/TownScale.browser.tsx",
);

/** Pan frames per measurement: four seconds at 60 Hz, every one moving. */
const PAN_FRAMES = 240;
/** Idle frames, measured separately after each pan. */
const IDLE_FRAMES = 120;

export async function runTownScale(options: {
  chrome: string;
  directory: string;
  gpu?: boolean;
  /** False measures the town without its thought bubbles. */
  steps?: boolean;
}) {
  const directory = resolve(options.directory);
  await mkdir(directory, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), "town-scale-"));
  const assets = new Map<string, Blob>();
  const receipts: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/")
        return new Response(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/TownScale.browser.css"></head><body><div id="root"></div><script type="module" src="/TownScale.browser.js"></script></body></html>',
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
      "--force-device-scale-factor=1",
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
      throw new AggregateError(build.logs, "Scale fixture build failed");
    for (const output of build.outputs)
      assets.set("/" + basename(output.path), output);
    cdp = await Cdp.connect(await endpoint(browser.stderr));
    const version = (await cdp.command("Browser.getVersion")).product;
    for (const viewport of townScaleViewports) {
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
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await command("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: "dark" }],
        });
        await command("Page.enable");
        await command("Page.addScriptToEvaluateOnNewDocument", {
          source:
            'window.scaleLoaded = new Promise(r => addEventListener("load", r, { once: true }));',
        });
        await command("Page.navigate", {
          url: server.url.href + (options.steps === false ? "?steps=off" : ""),
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
        const shoot = async (name: string, state: unknown) => {
          const shot = await command("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
          });
          const file = `${viewport.name}-${name}.png`;
          await Bun.write(
            join(directory, file),
            Buffer.from(shot.data, "base64"),
          );
          receipts.push({ viewport: viewport.name, file, state });
        };
        const ready = await evaluate(
          "window.scaleLoaded.then(() => window.townScale.ready)",
        );
        await shoot("0-home", ready);
        const panHome = await evaluate(`window.townScale.pan(${PAN_FRAMES})`);
        const idleHome = await evaluate(
          `window.townScale.idle(${IDLE_FRAMES})`,
        );
        receipts.push({
          viewport: viewport.name,
          measure: "home",
          pan: panHome,
          idle: idleHome,
        });
        await shoot("1-all", await evaluate('window.townScale.zoom("all")'));
        // Each Zoom in step: home, a building, a room, a desk.
        let level = "";
        for (let step = 2; step < 8 && level !== "desk"; step++) {
          const state = await evaluate('window.townScale.zoom("in")');
          level = state.level;
          await shoot(`${step}-${level}`, state);
        }
        const panDesk = await evaluate(`window.townScale.pan(${PAN_FRAMES})`);
        const idleDesk = await evaluate(
          `window.townScale.idle(${IDLE_FRAMES})`,
        );
        receipts.push({
          viewport: viewport.name,
          measure: "desk",
          pan: panDesk,
          idle: idleDesk,
        });
      } finally {
        await cdp.command("Target.closeTarget", { targetId });
      }
    }
    const report = {
      browser: version,
      gpu: options.gpu ?? false,
      steps: options.steps !== false,
      receipts,
    };
    await Bun.write(
      join(directory, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  } finally {
    cdp?.close();
    browser.kill();
    await browser.exited;
    server.stop(true);
    await rm(scratch, { recursive: true, force: true });
  }
}
