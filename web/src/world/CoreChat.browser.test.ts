// @world-browser-suite
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  waitForChromePort,
  withBrowserDeadline,
  stopChrome,
} from "../browserChrome";
import { worldBrowserBundle } from "./testing/worldBrowserBundle";
import { connectCapture } from "./testing/connectCapture";
import { captureResumeViewports } from "./testing/resumeVisualCapture";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test.skipIf(!chrome)(
  "core Chat sends answers and keys once, preserves refusal and uncertainty across viewports",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "core-chat-"));
    const ready = Promise.withResolvers<void>();
    const { assets } = await worldBrowserBundle("CoreChat");
    // Static browser fixture only: no World server or runtime is started.
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
        return asset
          ? new Response(asset)
          : new Response(
              '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><link rel="stylesheet" href="/CoreChat.browser.css"><script type="module" src="/CoreChat.browser.js"></script>',
              { headers: { "content-type": "text/html" } },
            );
      },
    });
    let browser: ReturnType<typeof Bun.spawn> | undefined;
    let c: Awaited<ReturnType<typeof connectCapture>> | undefined;
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
      await withBrowserDeadline(ready.promise, "core Chat ready", 20000);
      c = await connectCapture(port);
      const evaluate = async (expression: string) => {
        const r = await c!.command("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
        if (r.exceptionDetails)
          throw new Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
      };
      const typeAndSend = `(() => {const input=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'main'); input.dispatchEvent(new Event('input',{bubbles:true})); return new Promise(resolve => requestAnimationFrame(() => {document.querySelector('form').requestSubmit(); requestAnimationFrame(resolve)}))})()`;
      await evaluate(
        "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
      );
      expect(
        await evaluate("document.querySelector('.core-history').textContent"),
      ).toContain("Review the merge plan.");
      await evaluate(
        `(() => { document.querySelector('.core-history details').open=true; const input=document.querySelector('.core-history input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'synthetic-session'); input.dispatchEvent(new Event('input',{bubbles:true})); return new Promise(r=>requestAnimationFrame(r)); })()`,
      );
      await evaluate(
        `Array.from(document.querySelectorAll('.core-history button')).find(b=>b.textContent==='Read linked conversation').click(); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`,
      );
      expect(await evaluate("window.coreHistoryCalls.at(-1)")).toMatchObject({
        session: { kind: "id", value: "synthetic-session" },
        terminal: "t1",
      });
      expect(await evaluate("window.coreChatCalls.length")).toBe(0);
      await evaluate(typeAndSend);
      expect(await evaluate("window.coreChatCalls.length")).toBe(1);
      expect(await evaluate("window.coreChatCalls[0]")).toMatchObject({
        method: "world.core.send",
        params: {
          connection_id: "example-core",
          connection_generation: 7,
          terminal: "t1",
          answer: true,
          text: "main",
        },
      });
      expect(
        await evaluate("document.querySelector('[role=status]').textContent"),
      ).toContain("Sent to reviewer");
      await evaluate(
        `document.querySelector('.core-chat-keys button:nth-child(3)').click(); new Promise(r=>requestAnimationFrame(r))`,
      );
      expect(await evaluate("window.coreChatCalls[1]")).toMatchObject({
        method: "world.core.keys",
        params: { keys: ["enter"] },
      });
      for (const status of ["refused", "uncertain"]) {
        await evaluate(`window.coreChatScene(${JSON.stringify(status)})`);
        await evaluate(typeAndSend);
        expect(
          await evaluate("document.querySelector('[role=status]').textContent"),
        ).toContain(status === "refused" ? "Nothing was sent" : "Uncertain");
        if (status === "uncertain") {
          expect(
            await evaluate("document.querySelector('textarea').value"),
          ).toBe("");
          expect(
            await evaluate(
              "document.querySelector('button[type=submit]').disabled",
            ),
          ).toBe(true);
        }
        if (Bun.env.WORLD_CORE_CHAT_CAPTURES)
          for (const theme of ["light", "dark"]) {
            await evaluate(
              `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
            );
            await captureResumeViewports(
              port,
              Bun.env.WORLD_CORE_CHAT_CAPTURES,
              `${status}-${theme}`,
              { view: "desk", content: { selector: ".core-chat" } },
            );
          }
      }
      expect(await evaluate("window.coreChatCalls.length")).toBe(4);
    } finally {
      c?.close();
      await stopChrome(browser);
      server.stop(true);
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);
