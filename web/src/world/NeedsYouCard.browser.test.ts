import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../testing/sharedChrome";
import { buildWorldBrowserBundle } from "./testing/browserBundles";

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
    let page: ChromePage | undefined;
    try {
      page = await openChromePage({ viewport: { width: 1000, height: 900 } });
      void page.navigate(server.url.href).catch(() => {});
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          page.exited,
          "Needs you cards",
          15000,
        ),
      ).toEqual([]);
      const { command, evaluate } = page;
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
      await page?.close();
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
      let page: ChromePage | undefined;
      try {
        page = await openChromePage({ viewport: { width, height: 900 } });
        await page.command("Page.navigate", {
          url: `${server.url.href}?width=${width}`,
        });
        expect(
          await waitForBrowserFixture(
            requested.promise,
            result.promise,
            page.exited,
            "Question cards",
            15000,
          ),
        ).toEqual([]);
      } finally {
        await page?.close();
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    60000,
  );
