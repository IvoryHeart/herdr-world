import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../scripts/testing/browser-session";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import { connectCapture } from "./testing/connectCapture";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

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
    let child: TestBrowser | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const log = join(dir, "chrome.log");
      const profile = join(dir, "profile");
      child = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=1512,982",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      await child.start();
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      for (const viewport of VIEWPORTS)
        for (const open of SCENES) {
          await connection.command("Emulation.setDeviceMetricsOverride", {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
            mobile: viewport.mobile,
          });
          result = Promise.withResolvers<string[]>();
          requested = Promise.withResolvers<void>();
          await connection.command("Page.navigate", {
            url: `${server.url.href}${open ? `?open=${open}` : ""}`,
          });
          const scene = `${open || "list"}-${viewport.name}`;
          expect({
            scene,
            failures: await waitForBrowserFixture(
              requested.promise,
              result.promise,
              exited,
              `Apartments avatars ${scene}`,
              BROWSER_STARTUP_TIMEOUT_MS,
            ),
          }).toEqual({ scene, failures: [] });
          if (!captures) continue;
          for (const theme of ["dark", "light"] as const) {
            await connection.command("Runtime.evaluate", {
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
              awaitPromise: true,
            });
            const shot = await connection.command("Page.captureScreenshot", {
              format: "png",
            });
            await writeFile(
              join(captures, `${scene}-${theme}.png`),
              Buffer.from(shot.data, "base64"),
            );
          }
        }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000,
);
