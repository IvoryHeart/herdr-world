import { connectCapture } from "./testing/connectCapture";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import {
  stopChrome,
  waitForChromePort,
  waitForBrowserFixture,
  BROWSER_STARTUP_TIMEOUT_MS,
} from "../browserChrome";
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome)(
  "Move shows current destinations, preserves witnesses and explains background refusal on a phone",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-move-browser-"));
    const bundle = await buildWorldBrowserBundle("AgentMove", root);
    const requested = Promise.withResolvers<void>(),
      result = Promise.withResolvers<string[]>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/result") {
          result.resolve((await request.json()) as string[]);
          return new Response("ok");
        }
        if (path === "/") {
          requested.resolve();
          return new Response(
            '<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/AgentMove.browser.css"><script type="module" src="/AgentMove.browser.js"></script>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response(bundle.assets.get(path) ?? null, {
          status: bundle.assets.has(path) ? 200 : 404,
        });
      },
    });
    const log = join(root, "chrome.log");
    const child = Bun.spawn(
      [
        chrome!,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--remote-debugging-port=0",
        "--window-size=390,844",
        `--user-data-dir=${join(root, "profile")}`,
        "about:blank",
      ],
      { stdout: "ignore", stderr: Bun.file(log) },
    );
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    try {
      connection = await connectCapture(
        await waitForChromePort(child, join(root, "profile"), log),
      );
      await connection.command("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await connection.command("Page.navigate", {
        url: server.url.href + "?agentMoveBusy",
      });
      const exited = child.exited.then(async (code): Promise<never> => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          "Agent move",
          BROWSER_STARTUP_TIMEOUT_MS,
        ),
      ).toEqual([]);
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
