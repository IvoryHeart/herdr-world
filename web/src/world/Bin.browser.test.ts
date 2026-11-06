// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  waitForChromePort,
  withBrowserDeadline,
  stopChrome,
} from "../browserChrome";
import { connectCapture } from "./testing/connectCapture";
import { captureResumeViewports } from "./testing/resumeVisualCapture";
import { chromeRenderingFlags } from "./testing/chromeRendering";
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome)(
  "Town stops and bus open the shared bin on desktop and phone; restore, Close now and scheduled departure remain qualified",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "world-bin-browser-"));
    const ready = Promise.withResolvers<void>();
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "Bin.browser.tsx")],
      outdir: root,
      target: "browser",
    });
    expect(build.success).toBe(true);
    const assets = new Map(
      build.outputs.map((output) => [`/${basename(output.path)}`, output]),
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/ready") {
          ready.resolve();
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        return new Response(
          '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><link rel="stylesheet" href="/Bin.browser.css"><script type="module" src="/Bin.browser.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let cdp: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
          ...(await chromeRenderingFlags(chrome!)),
          "--remote-debugging-port=0",
          `--user-data-dir=${join(root, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(join(root, "chrome.log")) },
      );
      const port = await waitForChromePort(
        browser,
        join(root, "profile"),
        join(root, "chrome.log"),
      );
      await withBrowserDeadline(ready.promise, "bin fixture ready", 20000);
      cdp = await connectCapture(port);
      const evaluate = async (expression: string) => {
        const result = await cdp!
          .command("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          })
          .catch(async (error) => {
            const debug = await cdp!.command("Runtime.evaluate", {
              expression: "window.binDebug()",
              returnByValue: true,
            });
            throw new Error(
              `${expression}: ${error}: ${JSON.stringify(debug.result?.value)}`,
            );
          });
        if (result.exceptionDetails) {
          const debug = await cdp!.command("Runtime.evaluate", {
            expression: "window.binDebug()",
            returnByValue: true,
          });
          throw new Error(
            `${expression}: ${JSON.stringify(result.exceptionDetails)} ${JSON.stringify(debug.result?.value)}`,
          );
        }
        return result.result.value;
      };
      for (const width of [1440, 390]) {
        await cdp.command("Emulation.setDeviceMetricsOverride", {
          width,
          height: 844,
          deviceScaleFactor: 1,
          mobile: width === 390,
        });
        const points = (await evaluate("window.binDragPrepare()")) as {
          from: { x: number; y: number };
          to: { x: number; y: number };
        };
        await cdp.command("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...points.from,
          button: "left",
          buttons: 1,
          clickCount: 1,
        });
        await cdp.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: points.from.x + 20,
          y: points.from.y,
          button: "left",
          buttons: 1,
        });
        await cdp.command("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          ...points.to,
          button: "left",
          buttons: 1,
        });
        await cdp.command("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...points.to,
          button: "left",
          buttons: 0,
          clickCount: 1,
        });
        expect(await evaluate("window.binDragCheck()")).toBe(true);
        expect(await evaluate("window.binChecks()")).toEqual([]);
      }
      if (Bun.env.WORLD_BIN_CAPTURE_DIR) {
        await evaluate("window.binPreview()");
        await captureResumeViewports(
          port,
          Bun.env.WORLD_BIN_CAPTURE_DIR,
          "bin",
          {
            view: "town",
            content: { selector: ".world-bin-tray", scope: "document" },
          },
        );
      }
    } finally {
      cdp?.close();
      await stopChrome(browser);
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);
