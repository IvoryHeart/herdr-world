import { expect, test } from "bun:test";
import { join } from "node:path";
import { liveMoves } from "./testing/live-moves";
import { scratchCoreBinary } from "./testing/scratch-core";
import { buildWorldBrowserBundle } from "../../../web/src/world/testing/browserBundles";
import { connectCapture } from "../../../web/src/world/testing/connectCapture";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
} from "../../../web/src/browserChrome";

const binary = scratchCoreBinary();
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!binary || !chrome || !Bun.which("cc"))(
  "browser moves a desk TUI→core, core→core and core→TUI and colours core-local over a real configured connection",
  async () => {
    const fixture = await liveMoves(binary!);
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    const results = Promise.withResolvers<string[]>();
    try {
      const bundle = await buildWorldBrowserBundle(
        "RuntimeMove",
        fixture.project,
      );
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result") {
            results.resolve((await request.json()) as string[]);
            return new Response("ok");
          }
          if (path === "/state")
            return Response.json({
              connections: await fixture.connections(),
              board: fixture.board.get(),
              initial: fixture.initial,
            });
          if (path === "/rpc") {
            const { method, params } = (await request.json()) as {
              method: string;
              params: Record<string, unknown>;
            };
            try {
              return Response.json({
                result: await fixture.rpc(method, params),
              });
            } catch (error) {
              return Response.json({ error: String(error) });
            }
          }
          if (path === "/")
            return new Response(
              '<script type="module" src="/RuntimeMove.browser.js"></script>',
              { headers: { "Content-Type": "text/html" } },
            );
          return new Response(bundle.assets.get(path) ?? null, {
            status: bundle.assets.has(path) ? 200 : 404,
          });
        },
      });
      const profile = join(fixture.project, "chrome"),
        log = join(fixture.project, "chrome.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-gpu",
          "--remote-debugging-port=0",
          `--user-data-dir=${profile}`,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      await connection.command("Page.navigate", { url: server.url.href });
      const failures = await withBrowserDeadline(
        results.promise,
        "native runtime moves browser",
        180_000,
      );
      expect(failures).toEqual([]);
      expect(
        fixture.calls.filter((m) => m === "world.agent.move"),
      ).toHaveLength(3);
      expect(fixture.calls).toContain("world.appearance.patch");
      expect(fixture.transcript()).toContain("The conversation continues.");
    } finally {
      connection?.close();
      if (child) await stopChrome(child);
      server?.stop(true);
      await fixture.dispose();
    }
  },
  240_000,
);
