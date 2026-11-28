// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  waitForChromePort,
  withBrowserDeadline,
  stopChrome,
} from "../browserChrome";
import { worldBrowserBundle } from "./testing/worldBrowserBundle";
import { resumeViewports } from "./testing/resumeVisualCapture";
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const viewports = resumeViewports.filter((viewport) =>
  ["phone", "mac-laptop"].includes(viewport.name),
);

test.skipIf(!chrome)(
  "answers across a World restart: Reception Outbox on desktop and phone sends only to the proven session",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "answer-continuity-")),
      ready = Promise.withResolvers<void>();
    const { assets } = await worldBrowserBundle("AnswerContinuity");
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
          '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><link rel="stylesheet" href="/AnswerContinuity.browser.css"><script type="module" src="/AnswerContinuity.browser.js"></script>',
          { headers: { "content-type": "text/html" } },
        );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let socket: WebSocket | undefined;
    try {
      browser = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-dev-shm-usage",
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
      await withBrowserDeadline(
        ready.promise,
        "Answer continuity fixture ready",
        20000,
      );
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as { type: string; webSocketDebuggerUrl: string }[];
      socket = new WebSocket(
        targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
      );
      await new Promise<void>((resolve) => {
        socket!.onopen = () => resolve();
      });
      let serial = 0;
      const pending = new Map<number, (result: any) => void>();
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        pending.get(message.id)?.(message.result);
        pending.delete(message.id);
      };
      const command = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<any>((resolve) => {
          const id = ++serial;
          pending.set(id, resolve);
          socket!.send(JSON.stringify({ id, method, params }));
        });
      for (const viewport of viewports) {
        await command("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile: viewport.name === "phone",
        });
        const result = (
          await command("Runtime.evaluate", {
            expression: "window.answerContinuityChecks()",
            awaitPromise: true,
            returnByValue: true,
          })
        ).result;
        expect({ viewport: viewport.name, errors: result.value }).toEqual({
          viewport: viewport.name,
          errors: [],
        });
      }
    } finally {
      socket?.close();
      await stopChrome(browser);
      await server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  90000,
);
