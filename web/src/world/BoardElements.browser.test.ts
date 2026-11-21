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

/** Phone and desktop, as the repository's captures use them. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1512, height: 982, mobile: false },
] as const;
const SHOTS = ["board", "add", "memory", "log", "link", "offline"] as const;

test.skipIf(!chrome)(
  "Board elements: cards, Add to Board and the reader on a synthetic World",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "board-elements-"));
    const { assets } = await buildWorldBrowserBundle("BoardElements", dir);
    let result = Promise.withResolvers<string[]>();
    let requested = Promise.withResolvers<void>();
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
            ? Bun.file(join(dir, "BoardElements/index.html"))
            : assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      const profile = join(dir, "profile"),
        log = join(dir, "chrome.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=1200,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          "Board elements",
          BROWSER_STARTUP_TIMEOUT_MS,
        ),
      ).toEqual([]);
      // Evidence captures for the PR, only when asked for (BOARD_ELEMENT_CAPTURES=<dir>;
      // the test runner drops HERDR_* variables).
      const captures = Bun.env.BOARD_ELEMENT_CAPTURES;
      if (!captures) return;
      await mkdir(captures, { recursive: true });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      for (const theme of ["light", "dark"] as const)
        for (const viewport of VIEWPORTS)
          for (const shot of SHOTS) {
            await connection.command("Emulation.setDeviceMetricsOverride", {
              width: viewport.width,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: viewport.mobile,
            });
            result = Promise.withResolvers<string[]>();
            requested = Promise.withResolvers<void>();
            await connection.command("Page.navigate", {
              url: `${server.url.href}?mode=preview&shot=${shot}`,
            });
            expect(
              await waitForBrowserFixture(
                requested.promise,
                result.promise,
                exited,
                "Board elements",
                BROWSER_STARTUP_TIMEOUT_MS,
              ),
            ).toEqual([]);
            await connection.command("Runtime.evaluate", {
              // The page runs on a manual test clock: no timers to wait on.
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
            });
            const image = await connection.command("Page.captureScreenshot", {
              format: "png",
            });
            await writeFile(
              join(captures, `${shot}-${viewport.name}-${theme}.png`),
              Buffer.from(image.data, "base64"),
            );
          }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  180000,
);
