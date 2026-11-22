/**
 * Help pictures: captures each help entry's control (web/src/help/) from
 * the production components with the website's synthetic scene, at phone
 * and desktop sizes in light and dark, ringed as Try rings it, and writes
 * web/public/help/<id>.<size>.<theme>.webp with a manifest of each
 * picture's input fingerprint (scripts/help-declarations.ts). It starts no
 * World or Herdr and contacts no service. Nobody edits a picture by hand:
 *
 *   CHROME_BIN=… bun run help:pictures
 *   CHROME_BIN=… HELP_PICTURES_IDS="town.zoom board.next" bun run help:pictures
 *
 * (the browser queue runs scripts/help-pictures.browser.test.ts).
 *
 * HERDR_WORLD_TEST_GPU=1 renders with the hardware GPU instead of SwiftShader.
 */
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { BunPlugin } from "bun";
import { Cdp, endpoint } from "./town-golden";
import {
  HELP_PICTURE_CROPS,
  HELP_PICTURE_DIRECTORY,
  HELP_PICTURE_MANIFEST,
  HELP_PICTURE_VIEWPORTS,
  helpEntries,
  helpPictureFiles,
  helpPictureFingerprint,
  readHelpPictureManifest,
  ROOT,
  scanHelpAnchors,
  type HelpPictureManifest,
} from "./help-declarations";
import {
  HELP_PICTURE_THEMES,
  helpPictureFile,
  helpPictureSizes,
  type HelpEntry,
  type HelpPictureSize,
} from "../web/src/help/helpEntry";
import {
  GPU_FLAGS,
  SWIFTSHADER_FLAGS,
} from "../web/src/world/testing/chromeRendering";

type Box = { x: number; y: number; width: number; height: number };

/**
 * The crop around a control: the crop's size centred on it, kept inside the
 * screen. A control larger than the crop is shown from its centre.
 */
/** Vite's `?raw` imports (agent icons), loaded as text. */
const RAW_TEXT: BunPlugin = {
  name: "vite-raw-text",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
      namespace: "raw-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "raw-text" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

export function clipAround(
  box: Box,
  viewport: { width: number; height: number },
  crop: { width: number; height: number },
): Box {
  const width = Math.min(crop.width, viewport.width);
  const height = Math.min(crop.height, viewport.height);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const x = Math.round(
    Math.max(0, Math.min(viewport.width - width, centreX - width / 2)),
  );
  const y = Math.round(
    Math.max(0, Math.min(viewport.height - height, centreY - height / 2)),
  );
  return { x, y, width, height };
}

const page = join(ROOT, "web/src/help/testing/HelpShots.browser.tsx");

export const helpPictureBuildConfig = {
  target: "browser",
  define: { __HERDR_WORLD_VERSION__: JSON.stringify("help") },
  plugins: [RAW_TEXT],
} satisfies Partial<Bun.BuildConfig>;

export async function runHelpPictures(options: {
  chrome: string;
  /** Only these entries; all by default. */
  ids?: readonly string[];
  gpu?: boolean;
}) {
  const directory = join(ROOT, HELP_PICTURE_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const entries = helpEntries().filter(
    (entry) => !options.ids?.length || options.ids.includes(entry.id),
  );
  const anchors = scanHelpAnchors();
  const scratch = await mkdtemp(join(tmpdir(), "help-pictures-"));
  const assets = new Map<string, Blob>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/")
        return new Response(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/HelpShots.browser.css"></head><body><div id="root"></div><script type="module" src="/HelpShots.browser.js"></script></body></html>',
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
  const written: string[] = [];
  const missing: string[] = [];
  let cdp: Cdp | undefined;
  try {
    const build = await Bun.build({
      ...helpPictureBuildConfig,
      entrypoints: [page],
      outdir: join(scratch, "bundle"),
    });
    if (!build.success)
      throw new AggregateError(build.logs, "Help stage build failed");
    for (const output of build.outputs)
      assets.set("/" + basename(output.path), output);
    cdp = await Cdp.connect(await endpoint(browser.stderr));
    // One page per scene, size and theme; each entry's control in turn.
    const groups = new Map<string, HelpEntry[]>();
    for (const entry of entries)
      for (const size of helpPictureSizes(entry))
        for (const theme of HELP_PICTURE_THEMES) {
          const key = `${entry.picture.scene} ${size} ${theme}`;
          groups.set(key, [...(groups.get(key) ?? []), entry]);
        }
    for (const [key, group] of groups) {
      const [scene, size, theme] = key.split(" ") as [
        string,
        HelpPictureSize,
        "light" | "dark",
      ];
      const viewport = HELP_PICTURE_VIEWPORTS[size];
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
          mobile: viewport.mobile,
        });
        if (viewport.mobile)
          await command("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 5,
          });
        await command("Emulation.setEmulatedMedia", {
          features: [
            { name: "prefers-color-scheme", value: theme },
            { name: "prefers-reduced-motion", value: "reduce" },
          ],
        });
        await command("Page.enable");
        await command("Page.addScriptToEvaluateOnNewDocument", {
          source:
            'window.helpLoaded = new Promise(r => addEventListener("load", r, { once: true }));',
        });
        await command("Page.navigate", {
          url: `${server.url.href}?scene=${scene}&theme=${theme}${viewport.mobile ? "&phone=1" : ""}`,
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
        await evaluate("window.helpLoaded.then(() => window.helpShots.ready)");
        for (const entry of group) {
          const box = (await evaluate(
            `window.helpShots.show(${JSON.stringify(entry.control)}, ${JSON.stringify(entry.picture.press ?? [])})`,
          )) as (Box & { viewport: { width: number; height: number } }) | null;
          if (!box) {
            missing.push(`${entry.id} (${size}, ${theme})`);
            continue;
          }
          const clip = clipAround(box, box.viewport, HELP_PICTURE_CROPS[size]);
          const image = await command("Page.captureScreenshot", {
            format: "webp",
            quality: 82,
            clip: { ...clip, scale: 1 },
            captureBeyondViewport: false,
          });
          const file = helpPictureFile(entry, size, theme);
          await Bun.write(
            join(directory, file),
            Buffer.from(image.data, "base64"),
          );
          written.push(file);
          await evaluate("window.helpShots.hide()");
        }
      } finally {
        await cdp.command("Target.closeTarget", { targetId });
      }
    }
    if (missing.length)
      throw new Error(
        `Help pictures could not find these controls on the stage: ${missing.join(", ")}`,
      );
    // The manifest records what each picture was made from; pictures of
    // entries that are gone are removed.
    const manifest: HelpPictureManifest = options.ids?.length
      ? readHelpPictureManifest()
      : {};
    for (const entry of entries)
      manifest[entry.id] = {
        fingerprint: helpPictureFingerprint(entry, anchors),
        files: helpPictureFiles(entry),
      };
    const known = new Set(helpEntries().map((entry) => entry.id));
    for (const id of Object.keys(manifest))
      if (!known.has(id)) delete manifest[id];
    const sorted = Object.fromEntries(
      Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
    );
    await Bun.write(
      join(ROOT, HELP_PICTURE_MANIFEST),
      `${JSON.stringify(sorted, null, 2)}\n`,
    );
    const keep = new Set(Object.values(sorted).flatMap((item) => item.files));
    for (const file of await readdir(directory))
      if (file.endsWith(".webp") && !keep.has(file))
        await rm(join(directory, file));
    return { written };
  } finally {
    cdp?.close();
    browser.kill();
    await browser.exited;
    server.stop(true);
    await rm(scratch, { recursive: true, force: true });
  }
}
