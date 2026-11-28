import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  chromeBinary as chrome,
  openChromePage,
  type ChromePage,
} from "./testing/sharedChrome";

test.skipIf(!chrome).each([390, 320])(
  "mobile terminal trusted long press, endpoint handles, explicit input and frozen output (%dpx)",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "mobile-terminal-test-"));
    const assets = new Map<string, Blob>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/")
          return new Response(
            '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/mobileTerminal.browser.css"></head><body><script type="module" src="/mobileTerminal.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        const asset = assets.get(path);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "mobileTerminal.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "vite-raw-test-assets",
            setup(build) {
              build.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
                namespace: "raw-text",
              }));
              build.onLoad(
                { filter: /.*/, namespace: "raw-text" },
                async (args) => ({
                  contents: await readFile(args.path, "utf8"),
                  loader: "text",
                }),
              );
            },
          },
        ],
      });
      expect(build.success).toBe(true);
      for (const asset of build.outputs)
        assets.set(`/${basename(asset.path)}`, asset);
      page = await openChromePage({
        viewport: { width, height: 800, deviceScaleFactor: 2, mobile: true },
        touch: true,
      });
      page.on("Runtime.consoleAPICalled", (params) => {
        if (params.type === "error") console.error(JSON.stringify(params.args));
      });
      page.on("Runtime.exceptionThrown", (params) =>
        console.error(JSON.stringify(params)),
      );
      const { evaluate } = page;
      const cdp = page.command;
      if (width === 320) {
        await cdp("Emulation.setUserAgentOverride", {
          userAgent:
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
          platform: "Linux x86_64",
        });
      }
      await page.navigate(`http://127.0.0.1:${server.port}/`);
      await page.waitFor("!!window.mobileTerminalTest");
      const run = (method: string) =>
        evaluate(`mobileTerminalTest.${method}()`);
      await run("ready");
      const point = (selector: string) =>
        evaluate(`mobileTerminalTest.point(${JSON.stringify(selector)})`);
      const touch = async (type: string, x: number, y: number) =>
        cdp("Input.dispatchTouchEvent", {
          type,
          touchPoints:
            type === "touchEnd"
              ? []
              : [{ x, y, radiusX: 1, radiusY: 1, force: 1, id: 1 }],
        });
      const direct = 'button[aria-label="Type directly into the terminal"]';
      const tap = async (selector: string) => {
        if (selector === direct) {
          await evaluate(`new Promise(resolve => {
            document.querySelector('button[aria-label="Close terminal input"]')?.click();
            requestAnimationFrame(resolve);
          })`);
        }
        const { x, y } = await point(selector);
        await touch("touchStart", x, y);
        await touch("touchEnd", x, y);
      };
      await tap(".xterm-screen");
      await run("reading");
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        deltaX: 0,
        deltaY: 100,
        modifiers: 6,
        ...(await point(".xterm-screen")),
      });
      await run("readingWheel");
      await tap(direct);
      await run("typing");
      await run("androidCorrections");
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        deltaX: 0,
        deltaY: 100,
        modifiers: 6,
        ...(await point(".xterm-screen")),
      });
      await run("inputWheel");
      const { x, y } = await point(".xterm-screen");
      await touch("touchStart", x, y + 120);
      await touch("touchMove", x, y + 80);
      await touch("touchMove", x, y + 20);
      await touch("touchEnd", x, y + 20);
      await run("scrolled");
      await tap('button[aria-label="Close terminal input"]');
      await tap(".xterm-screen");
      await run("dismissed");
      await tap(direct);
      await tap('button[aria-label="Close terminal input"]');
      const word = await evaluate("mobileTerminalTest.cell(4, 0)");
      await touch("touchStart", word.x, word.y);
      await run("activate");
      await touch("touchEnd", word.x, word.y);
      await run("selection");
      for (const theme of ["light", "dark"]) {
        await evaluate(
          `document.documentElement.dataset.theme = ${JSON.stringify(theme)}`,
        );
        await evaluate("__HERDR_TEST_CLOCK__.advance(180)");
        const screenshot = await cdp("Page.captureScreenshot", {
          format: "png",
        });
        await Bun.write(
          join(dir, `selection-${theme}.png`),
          Buffer.from(screenshot.data, "base64"),
        );
      }
      await tap(".terminal-touch-selection-actions button");
      await run("copied");
      const drag = async (
        label: string,
        fromCol: number,
        col: number,
        expected: string,
      ) => {
        const start = await point(`button[aria-label="${label}"]`);
        const end = await evaluate(`mobileTerminalTest.cell(${col}, 0)`);
        end.y = start.y;
        const from = await evaluate(`mobileTerminalTest.cell(${fromCol}, 0)`);
        end.x += start.x - from.x;
        await touch("touchStart", start.x, start.y);
        await touch("touchMove", end.x, end.y);
        await touch("touchEnd", end.x, end.y);
        await evaluate(
          `mobileTerminalTest.dragged(${JSON.stringify(expected)})`,
        );
      };
      await drag("Selection start", 2, 0, "$ stable");
      await drag("Selection end", 8, 15, "$ stable output");
      await drag("Selection start", 0, 16, "");
      await drag("Selection start", 15, 9, "output");
      await run("comment");
      await run("regressions");
      await run("hybrid");
      await tap(".xterm-screen");
      await run("compatibilityMouse");
      await tap(direct);
      await tap('button[aria-label="Close terminal input"]');
      await tap(".xterm-screen");
      await run("compatibilityMouse");
      const mousePoint = await point(".xterm-screen");
      await cdp("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        ...mousePoint,
      });
      await cdp("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        ...mousePoint,
      });
      await run("fineMouse");
      await run("restoreMedia");
      await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: 1300,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
      });
      expect(await run("desktop")).toEqual([]);
    } finally {
      await page?.close();
      server.stop(true);
      console.log(`Mobile terminal browser artifacts: ${dir}`);
    }
  },
  45_000,
);
