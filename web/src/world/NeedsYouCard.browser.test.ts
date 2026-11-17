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

test.skipIf(!chrome)(
  "Needs you expands, opens its asker, badges the phone counter and the tab",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "needs-you-card-"));
    const { assets } = await buildWorldBrowserBundle("NeedsYouCard", dir);
    const result = Promise.withResolvers<string[]>(),
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
            ? Bun.file(join(dir, "NeedsYouCard/index.html"))
            : path === "/herdr-world-icon-192.png"
              ? Bun.file(
                  join(
                    import.meta.dir,
                    "../../public/herdr-world-icon-192.png",
                  ),
                )
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
          "--window-size=1000,900",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          server.url.href,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          child.exited.then(async (code) => {
            throw new Error(
              `Chrome exited ${code}: ${await Bun.file(log).text()}`,
            );
          }),
          "Needs you cards",
          15000,
        ),
      ).toEqual([]);
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      const { command } = connection;
      const evaluate = async (expression: string) => {
        const r = await command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails)
          throw new Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      const key = async (key: string, virtualKey: number, shift = false) => {
        const params = {
          key,
          code: key === " " ? "Space" : key,
          windowsVirtualKeyCode: virtualKey,
          modifiers: shift ? 8 : 0,
        };
        await command("Input.dispatchKeyEvent", {
          ...params,
          type: "keyDown",
          ...(key === "Enter" ? { text: "\r" } : {}),
        });
        await command("Input.dispatchKeyEvent", { ...params, type: "keyUp" });
        await evaluate(
          "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
        );
      };
      const card = `document.querySelector('[data-needs-you-item="ask:q-long"]')`;
      const state = () =>
        evaluate(`({ expanded: ${card}.querySelector('.needs-you-more-text').getAttribute('aria-expanded'),
      href: document.activeElement.getAttribute('href'), toggle: document.activeElement.matches('.needs-you-more-text') })`);
      const pointerClick = async (element: string, topOffset = 2) => {
        const point = await evaluate(`(() => {
          const rect = ${element}.getClientRects()[0];
          return { x: rect.left + 2, y: rect.top + ${topOffset} };
        })()`);
        for (const type of ["mousePressed", "mouseReleased"])
          await command("Input.dispatchMouseEvent", {
            ...point,
            type,
            button: "left",
            clickCount: 1,
          });
        await evaluate(
          "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
        );
      };
      const counter = `document.querySelector('.fixture-bar .needs-you-counter')`;
      const pressed = await evaluate(`${counter}.getAttribute('aria-pressed')`);
      await pointerClick(counter, -3);
      expect(
        await evaluate(`${counter}.getAttribute('aria-pressed')`),
      ).not.toBe(pressed);
      await pointerClick(counter);
      // Native pointer focus must not reveal a visible link; plain text must.
      await evaluate(
        `${card}.querySelector('.needs-you-text a').addEventListener('click', event => event.preventDefault(), { once: true })`,
      );
      await pointerClick(`${card}.querySelector('.needs-you-text a')`);
      expect(await state()).toMatchObject({
        expanded: "false",
        href: "https://example.com/pull/42",
      });
      await pointerClick(`${card}.querySelector('.needs-you-text')`);
      expect((await state()).expanded).toBe("true");
      await evaluate(`${card}.querySelector('.needs-you-more-text').click()`);
      // Traverse from before the text, including the link hidden below the clamp.
      await evaluate(`${card}.querySelector('.needs-you-name').focus()`);
      await key("Tab", 9); // Chat.
      await key("Tab", 9); // Dismiss.
      await key("Tab", 9); // First link.
      expect(await state()).toMatchObject({
        expanded: "true",
        href: "https://example.com/pull/42",
      });
      await key("Tab", 9); // Late link.
      expect((await state()).href).toBe("https://example.com/runs/7");
      await key("Tab", 9); // "less".
      await key(" ", 32);
      expect(await state()).toMatchObject({ expanded: "false", toggle: true });
      await key("Tab", 9, true); // Re-enter the late link after collapse.
      expect(await state()).toMatchObject({
        expanded: "true",
        href: "https://example.com/runs/7",
      });
      await key("Tab", 9);
      await key("Enter", 13); // "less".
      expect(await state()).toMatchObject({ expanded: "false", toggle: true });
      await key("Enter", 13); // "more".
      expect((await state()).expanded).toBe("true");
      await evaluate(`${card}.querySelector('.needs-you-more-text').click()`);
      await evaluate(
        `${card}.querySelector('.needs-you-markdown').textContent = 'Short.'`,
      );
      await evaluate(
        "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
      );
      expect(
        await evaluate(`${card}.querySelector('.needs-you-more-text')`),
      ).toBeNull();
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  30000 + BROWSER_STARTUP_TIMEOUT_MS,
);

// Claude's recorded questions, an unknown prompt and the folder-trust
// question, in Chat and Needs you, with synthetic data only.
for (const width of [1280, 390])
  test.skipIf(!chrome)(
    `Chat and Needs you show Claude's questions and trust choices (${width}px)`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "question-cards-"));
      const { assets } = await buildWorldBrowserBundle("QuestionCards", dir);
      const result = Promise.withResolvers<string[]>(),
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
              ? Bun.file(join(dir, "QuestionCards/index.html"))
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
            `--window-size=${width},900`,
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            "about:blank",
          ],
          { stdout: "ignore", stderr: Bun.file(log) },
        );
        connection = await connectCapture(
          await waitForChromePort(child, profile, log),
        );
        await connection.command("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await connection.command("Page.navigate", {
          url: `${server.url.href}?width=${width}`,
        });
        expect(
          await waitForBrowserFixture(
            requested.promise,
            result.promise,
            child.exited.then(async (code) => {
              throw new Error(
                `Chrome exited ${code}: ${await Bun.file(log).text()}`,
              );
            }),
            "Question cards",
            15000,
          ),
        ).toEqual([]);
      } finally {
        connection?.close();
        await stopChrome(child);
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
