import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const log = join(dir, "chrome.log");
      const profile = join(dir, "profile");
      child = Bun.spawn(
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
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      for (const viewport of VIEWPORTS)
        for (const mode of MODES)
          for (const town of TOWNS)
            for (const partial of mode === "many" && town === "usual"
              ? [false, true]
              : [false]) {
              await connection.command("Emulation.setDeviceMetricsOverride", {
                width: viewport.width,
                height: viewport.height,
                deviceScaleFactor: 1,
                mobile: viewport.mobile,
              });
              result = Promise.withResolvers<string[]>();
              requested = Promise.withResolvers<void>();
              await connection.command("Page.navigate", {
                url: `${server.url.href}?mode=${mode}${viewport.name === "phone" ? "&phone" : ""}${town === "large" ? "&large" : ""}${partial ? "&partial" : ""}`,
              });
              const scene = `${mode}-${town}-${viewport.name}${partial ? "-partial" : ""}`;
              expect({
                scene,
                failures: await waitForBrowserFixture(
                  requested.promise,
                  result.promise,
                  exited,
                  `Shipyard lighthouse ${scene}`,
                  BROWSER_STARTUP_TIMEOUT_MS,
                ),
              }).toEqual({ scene, failures: [] });
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
