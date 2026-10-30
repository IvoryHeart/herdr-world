import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
} from "./browserChrome";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

// Desktop with a mouse, a 390px window with a mouse, and a 390px phone.
const cases = [
  { width: 1100, height: 700, touch: false },
  { width: 390, height: 800, touch: false },
  { width: 390, height: 800, touch: true },
];

for (const { width, height, touch } of cases)
  test.skipIf(!chrome)(
    `transient layers over a terminal close top first (${width}px${touch ? ", touch" : ""})`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "layer-stack-test-"));
      const { promise, resolve } = Promise.withResolvers<unknown>();
      const assets = new Map<string, Blob>();
      let cdp: (method: string, params?: object) => Promise<any> = () =>
        Promise.reject(new Error("CDP is not connected"));
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result" && request.method === "POST") {
            resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/input" && request.method === "POST") {
            const { method, params } = await request.json();
            await cdp(method, params);
            return new Response("ok");
          }
          const asset = assets.get(path);
          if (asset) return new Response(asset);
          if (path === "/")
            return new Response(
              '<head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/layerStack.browser.css"></head><body><script type="module" src="/layerStack.browser.js"></script></body>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response("Not found", { status: 404 });
        },
      });
      let child: ReturnType<typeof Bun.spawn> | undefined;
      let socket: WebSocket | undefined;
      try {
        const build = await Bun.build({
          entrypoints: [join(import.meta.dir, "layerStack.browser.tsx")],
          outdir: dir,
          target: "browser",
        });
        expect(build.success).toBe(true);
        for (const asset of build.outputs)
          assets.set(`/${basename(asset.path)}`, asset);
        const errorOutput = join(dir, "browser.log");
        child = Bun.spawn(
          [
            chrome!,
            "--headless",
            "--disable-gpu",
            "--remote-debugging-port=0",
            `--window-size=${width},${height}`,
            "--no-first-run",
            "--no-default-browser-check",
            "--password-store=basic",
            `--user-data-dir=${join(dir, "profile")}`,
            "about:blank",
          ],
          { stdout: "ignore", stderr: Bun.file(errorOutput) },
        );
        const port = await waitForChromePort(
          child,
          join(dir, "profile"),
          errorOutput,
        );
        const targets = (await withBrowserDeadline(
          fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
            response.json(),
          ),
          "Chrome debugger discovery",
        )) as { type: string; webSocketDebuggerUrl: string }[];
        socket = new WebSocket(
          targets.find((target) => target.type === "page")!
            .webSocketDebuggerUrl,
        );
        await withBrowserDeadline(
          new Promise<void>((resolve, reject) => {
            socket!.onopen = () => resolve();
            socket!.onerror = () => reject(new Error("CDP connection failed"));
          }),
          "CDP connection",
        );
        let id = 0;
        const pending = new Map<number, (result: any) => void>();
        socket.onmessage = (event) => {
          const response = JSON.parse(String(event.data));
          pending.get(response.id)?.(response);
          pending.delete(response.id);
        };
        cdp = (method, params = {}) =>
          withBrowserDeadline(
            new Promise((resolve, reject) => {
              const requestId = ++id;
              pending.set(requestId, (response) =>
                response.error
                  ? reject(new Error(JSON.stringify(response.error)))
                  : resolve(response.result),
              );
              socket!.send(JSON.stringify({ id: requestId, method, params }));
            }),
            `CDP ${method}`,
          );
        await cdp("Emulation.setDeviceMetricsOverride", {
          width,
          height,
          deviceScaleFactor: 1,
          mobile: touch,
        });
        if (touch)
          await cdp("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 1,
          });
        await cdp("Page.navigate", {
          url: `${server.url.href}?touch=${touch ? 1 : 0}&width=${width}`,
        });
        const failures = await withBrowserDeadline(
          promise,
          "Layer stack fixture",
          40_000,
        );
        expect(failures).toEqual([]);
      } finally {
        socket?.close();
        server.stop(true);
        await stopChrome(child);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60_000,
  );
