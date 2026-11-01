import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
  withBrowserDeadline,
} from "../browserChrome";

const chrome =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

test.skipIf(!chrome)(
  "Needs you cards expand in place, open their agent and badge the phone counter",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "needs-you-card-test-"));
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const assets = new Map<string, Blob>();
    const pageRequested = Promise.withResolvers<void>();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") pageRequested.resolve();
        if (path === "/result" && request.method === "POST") {
          resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path === "/") {
          return new Response(
            '<head><link rel="stylesheet" href="/NeedsYouCard.browser.css"></head><body><div id="root"></div><script src="/NeedsYouCard.browser.js"></script></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        }
        return new Response("Not found", { status: 404 });
      },
    });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, "NeedsYouCard.browser.tsx")],
        outdir: dir,
        target: "browser",
        plugins: [
          {
            name: "raw-agent-icons",
            setup(build) {
              build.onResolve({ filter: /\?raw$/ }, (args) => ({
                path: Bun.resolveSync(args.path.slice(0, -4), args.resolveDir),
                namespace: "raw",
              }));
              build.onLoad(
                { filter: /.*/, namespace: "raw" },
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
      const errorOutput = join(dir, "browser.log");
      child = Bun.spawn(
        [
          chrome!,
          "--headless",
          "--disable-gpu",
          "--remote-debugging-port=0",
          "--window-size=1000,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(errorOutput) },
      );
      const result = (await waitForBrowserFixture(
        pageRequested.promise,
        promise,
        child.exited.then(async (code) => {
          throw new Error(
            `Browser exited (${code}): ${await readFile(errorOutput, "utf8")}`,
          );
        }),
        "Browser regression checks",
        30_000,
      )) as { failures: string[]; metrics: unknown };
      // Smoothness is reported, not asserted against a clock.
      console.info(`Needs you card metrics: ${JSON.stringify(result.metrics)}`);
      expect(result.failures).toEqual([]);

      // Real sequential keyboard input: begin before the message rather than
      // focusing More directly, so clipped anchors cannot hide in the Tab order.
      const port = await waitForChromePort(
        child,
        join(dir, "profile"),
        errorOutput,
      );
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
      const socket = new WebSocket(
        targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
      );
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () =>
          reject(new Error("Keyboard CDP connection failed"));
      });
      let sequence = 0;
      const pending = new Map<
        number,
        ReturnType<typeof Promise.withResolvers<any>>
      >();
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        const response = pending.get(message.id);
        if (!response) return;
        pending.delete(message.id);
        if (message.error)
          response.reject(new Error(JSON.stringify(message.error)));
        else response.resolve(message.result);
      };
      const command = (method: string, params: Record<string, unknown>) => {
        const id = ++sequence;
        const response = Promise.withResolvers<any>();
        pending.set(id, response);
        socket.send(JSON.stringify({ id, method, params }));
        return withBrowserDeadline(response.promise, method, 5_000);
      };
      const evaluate = async (expression: string) => {
        const response = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (response.exceptionDetails)
          throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
      };
      const key = async (
        key: string,
        code: string,
        virtualKey: number,
        shift = false,
      ) => {
        const params = {
          key,
          code,
          windowsVirtualKeyCode: virtualKey,
          modifiers: shift ? 8 : 0,
        };
        await command("Input.dispatchKeyEvent", {
          ...params,
          type: "keyDown",
          ...(key === "Enter" ? { text: "\r", unmodifiedText: "\r" } : {}),
        });
        await command("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
        await evaluate(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        );
      };
      const card = `document.querySelector('[data-needs-you-item="ask:q-long"]')`;
      const state = () =>
        evaluate(`(() => {
        const card = ${card}, text = card.querySelector('.needs-you-text');
        const active = document.activeElement, rect = active.getBoundingClientRect(), box = text.getBoundingClientRect();
        return { href: active.getAttribute('href'), toggle: active === card.querySelector('.needs-you-more-text'), expanded: text.classList.contains('is-expanded'), visible: rect.top >= box.top && rect.bottom <= box.bottom + 1 };
      })()`);
      try {
        await evaluate(`(() => {
          const card = ${card};
          if (card.querySelector('.needs-you-text').classList.contains('is-expanded')) card.querySelector('.needs-you-more-text').click();
          const link = card.querySelector('a');
          document.addEventListener('click', event => event.preventDefault(), { once: true });
          link.scrollIntoView({ block: 'nearest' });
        })()`);
        const point = await evaluate(`(() => {
          const rect = ${card}.querySelector('a').getBoundingClientRect();
          return { x: rect.left + 2, y: rect.top + rect.height / 2 };
        })()`);
        await command("Input.dispatchMouseEvent", {
          ...point,
          type: "mousePressed",
          button: "left",
          clickCount: 1,
        });
        await command("Input.dispatchMouseEvent", {
          ...point,
          type: "mouseReleased",
          button: "left",
          clickCount: 1,
        });
        expect((await state()).expanded).toBe(false);
        await evaluate(`${card}.querySelector('.needs-you-name').focus()`);
        await key("Tab", "Tab", 9); // About, immediately before the message.
        await key("Tab", "Tab", 9); // Visible first link.
        expect((await state()).href).toBe("https://example.com/pull/42");
        await key("Tab", "Tab", 9); // Link below the collapsed third line.
        expect(await state()).toMatchObject({
          href: "https://example.com/runs/7",
          expanded: true,
          visible: true,
        });
        await key("Tab", "Tab", 9); // Less.
        expect((await state()).toggle).toBe(true);
        await key(" ", "Space", 32);
        expect(await state()).toMatchObject({ toggle: true, expanded: false });
        await key("Tab", "Tab", 9, true); // Back into the late link after Less.
        expect(await state()).toMatchObject({
          href: "https://example.com/runs/7",
          expanded: true,
          visible: true,
        });
        await key("Tab", "Tab", 9);
        await key("Enter", "Enter", 13); // Less keeps focus on the toggle.
        expect(await state()).toMatchObject({ toggle: true, expanded: false });
        await key("Enter", "Enter", 13); // More.
        expect(await state()).toMatchObject({ toggle: true, expanded: true });
        await key(" ", "Space", 32); // Less.
        expect(await state()).toMatchObject({ toggle: true, expanded: false });
      } finally {
        socket.close();
      }
    } finally {
      server.stop(true);
      await stopChrome(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
  45_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
