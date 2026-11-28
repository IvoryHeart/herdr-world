import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import {
  runProcessWithInputTimeout,
  runBinaryProcessWithTimeout,
} from "./process";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assetUrlImports } from "../../../web/src/world/testing/assetUrlImports";
import { createFileHandlers } from "./files";
import { HTML_PREVIEW_CSP } from "./html-preview";
import {
  createPreviewCdp,
  PreviewSessionDetachedError,
} from "./html-preview-cdp.fixture";
import { shQuote } from "../utils/process-utils";
import { withBrowserDeadline } from "../../../web/src/browserChrome";
import {
  chromeBinary as chrome,
  type ChromePage,
  openChromePage,
} from "../../../web/src/testing/sharedChrome";

const attack = `<script>document.documentElement.dataset.executed='yes';fetch('/canary/script')</script>
<script src="/canary/external.js"></script><script src="https://cdn.example.invalid/blocked.js"></script>
<meta http-equiv="refresh" content="0;url=/canary/refresh">
<base href="/canary/base/">
<img src="/canary/image"><link rel="stylesheet" href="/canary/style">
<style>@import '/canary/import'; #attack {background:url('/canary/background');font-family:attack} @font-face{font-family:attack;src:url('/canary/font')}</style>
<div id="attack">Attack sentinel</div>
<form action="/canary/form"><button id="submit">Submit</button></form>
<a id="top" target="_top" href="/canary/top">Top</a>
<a id="parent" target="_parent" href="/canary/parent">Parent</a>
<a id="blank" target="_blank" href="/canary/blank">Blank</a>
<object data="/canary/object"></object><embed src="/canary/embed"><iframe src="/canary/frame"></iframe>
<object type="application/pdf" data="data:application/pdf;base64,JVBERi0xLjc="></object>`;
const source = `<!doctype html><html><head><meta name="referrer" content="unsafe-url"><link rel="stylesheet" href="styles/main.css"><link rel="stylesheet" href="https://cdn.example.invalid/main.css" crossorigin="anonymous" referrerpolicy="unsafe-url"><style>@import "//cdn.example.invalid/inline.css";</style></head><body>
<h1>HTML preview marker</h1><table><tr><td>First cell</td><td>Second cell</td></tr></table>
<img id="pixel" src="../pixel.png"><div id="font">Font marker</div>${attack}</body></html>`;

test.skipIf(!chrome)(
  "HTML preview loads workspace styles and isolates iframe and direct navigation",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "roamgate-html-browser-"));
    const workspace = join(dir, "workspace");
    await mkdir(join(workspace, "docs", "styles"), { recursive: true });
    await writeFile(join(workspace, "docs", "page.html"), source);
    await writeFile(join(workspace, "docs", "other.htm"), source);
    await writeFile(
      join(workspace, "docs", "styles", "main.css"),
      '@import "theme.css"; @import "https://cdn.example.invalid/import.css"; @font-face{font-family:preview;src:url(../../font.woff2)} #font{font-family:preview}',
    );
    await writeFile(
      join(workspace, "docs", "styles", "theme.css"),
      "h1{color:rgb(12,34,56)}",
    );
    await writeFile(
      join(workspace, "pixel.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    await writeFile(
      join(workspace, "font.woff2"),
      await readFile(
        join(
          import.meta.dir,
          "../../../web/src/assets/herdr-nerd-symbols.woff2",
        ),
      ),
    );
    const handlers = createFileHandlers({
      runBinaryProcessWithTimeout,
      bindProcess: (argv) => argv,
      runProcessWithInputTimeout,
      ...herdrRuntimeFixture({
        call: async () => ({
          workspace: { worktree: { checkout_path: workspace } },
        }),
      } as any),
      sshHost: () => undefined,
      runProcessWithCodeTimeout: async () => {
        throw new Error("Unexpected SSH call");
      },
      shQuote,
    });
    const assets = new Map<string, Blob>();
    const canaries: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/canary")) {
          canaries.push(url.pathname);
          return new Response("sentinel");
        }
        if (url.pathname.endsWith("/file/download")) {
          if (!request.headers.get("cookie")?.includes("preview-test=1"))
            return new Response("Unauthorized", { status: 401 });
          return handlers.downloadWorkspaceFile({
            workspace_id: url.searchParams.get("workspace_id"),
            path: url.searchParams.get("path"),
            inline: url.searchParams.get("inline") === "1",
          });
        }
        if (url.pathname === "/fixture-source") return new Response(source);
        if (url.pathname === "/policy.html")
          return new Response(attack, {
            headers: {
              "content-type": "text/html",
              "content-security-policy": HTML_PREVIEW_CSP,
              "referrer-policy": "no-referrer",
              "x-content-type-options": "nosniff",
            },
          });
        if (url.pathname === "/")
          return new Response(
            '<!doctype html><html><head><link rel="stylesheet" href="/HtmlPreview.browser.css"></head><body><script type="module" src="/HtmlPreview.browser.js"></script></body></html>',
            {
              headers: {
                "content-type": "text/html",
                "set-cookie":
                  "preview-test=1; Path=/; SameSite=Strict; HttpOnly",
              },
            },
          );
        const asset = assets.get(url.pathname);
        return asset
          ? new Response(asset)
          : new Response("Not found", { status: 404 });
      },
    });
    let page: ChromePage | undefined;
    try {
      const build = await Bun.build({
        entrypoints: [
          join(
            import.meta.dir,
            "../../../web/src/components/HtmlPreview.browser.tsx",
          ),
        ],
        target: "browser",
        outdir: dir,
        plugins: [
          assetUrlImports,
          {
            name: "raw-assets",
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
      page = await openChromePage({ viewport: { width: 1000, height: 900 } });
      const preview = page;
      // The debugger speaks to frames Chrome attaches (the sandboxed preview)
      // through the page's own session: `Target.sendMessageToTarget` out,
      // `Target.receivedMessageFromTarget` back in.
      let dispatch: (message: any) => void = () => {};
      const contextWaiters: Array<() => void> = [];
      const contextCreated = () =>
        new Promise<void>((resolve) => contextWaiters.push(resolve));
      const eventWaiters: Array<() => void> = [];
      const browserEvent = () =>
        new Promise<void>((resolve) => eventWaiters.push(resolve));
      const { cdp, receive, close } = createPreviewCdp((raw) => {
        const request = JSON.parse(raw);
        const { sessionId, ...body } = request;
        const sent = sessionId
          ? preview.command("Target.sendMessageToTarget", {
              sessionId,
              message: JSON.stringify(body),
            })
          : preview.command(request.method, request.params);
        sent.then(
          (result) => {
            if (!sessionId) receive({ id: request.id, result });
          },
          (error: Error) =>
            receive({ id: request.id, error: { message: error.message } }),
        );
      });
      const targets = async () =>
        (
          (await preview.command("Target.getTargets")) as {
            targetInfos: { type: string; browserContextId?: string }[];
          }
        ).targetInfos.filter(
          (target) => target.browserContextId === ownContext,
        );
      const ownContext = (await preview.command("Target.getTargetInfo"))
        .targetInfo.browserContextId as string;
      type FrameContext = { id: number; sessionId?: string };
      const contexts = new Map<string, FrameContext>();
      const cdnRequests: { path: string; referer: unknown }[] = [];
      const interceptionErrors: string[] = [];
      const interceptions = new Set<Promise<void>>();
      const recordInterception = (operation: Promise<unknown>) => {
        const tracked = operation
          .catch((error) => {
            if (!(error instanceof PreviewSessionDetachedError))
              interceptionErrors.push(String(error));
          })
          .then(() => {})
          .finally(() => interceptions.delete(tracked));
        interceptions.add(tracked);
        return tracked;
      };
      const detachWaiters = new Map<string, () => void>();
      let racedSetup: Promise<void> | undefined;
      let canarySetupHeld = false;
      let canaryReady!: () => void;
      const canarySetupReady = new Promise<void>((resolve) => {
        canaryReady = resolve;
      });
      const intercept = {
        patterns: [{ urlPattern: "https://cdn.example.invalid/*" }],
      };
      const cdnStyles: Record<string, string> = {
        "/main.css":
          '@import "./nested.css"; h1{border-top:7px solid purple;background-image:url(https://cdn.example.invalid/blocked.png);font-family:blockedCdnFont} @font-face{font-family:blockedCdnFont;src:url(https://cdn.example.invalid/blocked.woff2)}',
        "/nested.css": "h1{padding-top:9px}",
        "/import.css": "h1{letter-spacing:3px}",
        "/inline.css": "h1{word-spacing:5px}",
      };
      dispatch = (message) => {
        receive(message);
        if (message.method)
          for (const changed of eventWaiters.splice(0)) changed();
        if (message.method === "Target.detachedFromTarget") {
          for (const [frameId, context] of contexts) {
            if (context.sessionId === message.params.sessionId)
              contexts.delete(frameId);
          }
          detachWaiters.get(message.params.sessionId)?.();
        }
        if (message.method === "Target.attachedToTarget") {
          // Force the reported race: this CSP-blocked frame is not paused by
          // the debugger. Hold its resume continuation until navigation has
          // detached it, rather than depending on a slow CI scheduling turn.
          const hold =
            message.params.targetInfo.url.endsWith("/canary/frame") &&
            !racedSetup;
          const detached = hold
            ? new Promise<void>((resolve) =>
                detachWaiters.set(message.params.sessionId, resolve),
              )
            : Promise.resolve();
          const setup = Promise.all([
            cdp("Runtime.enable", {}, message.params.sessionId),
            cdp("Fetch.enable", intercept, message.params.sessionId),
          ]).then(async () => {
            if (hold) {
              canarySetupHeld = true;
              canaryReady();
              await detached;
            }
            return cdp(
              "Runtime.runIfWaitingForDebugger",
              {},
              message.params.sessionId,
            );
          });
          const tracked = recordInterception(setup);
          if (hold) racedSetup = tracked;
        }
        if (message.method === "Fetch.requestPaused") {
          const path = new URL(message.params.request.url).pathname;
          const referer = Object.entries(message.params.request.headers).find(
            ([name]) => name.toLowerCase() === "referer",
          )?.[1];
          cdnRequests.push({ path, referer });
          recordInterception(
            cdp(
              "Fetch.fulfillRequest",
              {
                requestId: message.params.requestId,
                responseCode: 200,
                responseHeaders: [
                  { name: "Content-Type", value: "text/css" },
                  { name: "Access-Control-Allow-Origin", value: "*" },
                  { name: "Referrer-Policy", value: "no-referrer" },
                ],
                body: Buffer.from(cdnStyles[path] ?? "").toString("base64"),
              },
              message.sessionId,
            ),
          );
        }
        if (
          message.method === "Runtime.executionContextCreated" &&
          message.params.context.auxData?.isDefault
        ) {
          contexts.set(message.params.context.auxData.frameId, {
            id: message.params.context.id,
            sessionId: message.sessionId,
          });
          for (const created of contextWaiters.splice(0)) created();
        }
      };
      preview.on("Target.receivedMessageFromTarget", (event) =>
        dispatch({ ...JSON.parse(event.message), sessionId: event.sessionId }),
      );
      for (const method of [
        "Target.attachedToTarget",
        "Target.detachedFromTarget",
        "Fetch.requestPaused",
        "Runtime.executionContextCreated",
      ])
        preview.on(method, (params) => dispatch({ method, params }));
      for (const method of [
        "Page.frameNavigated",
        "Page.frameAttached",
        "Page.frameDetached",
        "Page.domContentEventFired",
        "Page.loadEventFired",
        "Page.frameStoppedLoading",
        "Runtime.executionContextDestroyed",
      ])
        preview.on(method, () => {
          for (const changed of eventWaiters.splice(0)) changed();
        });
      preview.exited.catch(close);
      const screenshot = async (name: string) => {
        const directory = Bun.env.HERDR_WORLD_TEST_SCREENSHOTS;
        if (!directory) return;
        await mkdir(directory, { recursive: true });
        const image = await cdp("Page.captureScreenshot", { format: "png" });
        await writeFile(
          join(directory, `${name}.png`),
          Buffer.from(image.data, "base64"),
        );
      };
      const evaluate = async (expression: string, context?: FrameContext) => {
        const result = await cdp(
          "Runtime.evaluate",
          {
            expression,
            contextId: context?.id,
            awaitPromise: true,
            returnByValue: true,
          },
          context?.sessionId,
        );
        if (result.exceptionDetails)
          throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      // Fifty turns of the page's task queue: navigations and popups started
      // by a click have begun by then (the canary server and the target list
      // prove none did). Rendering can be held by the paused canary frame, so
      // this does not wait for a frame.
      const frames = () =>
        evaluate(
          "(async () => { for (let turn = 0; turn < 50; turn++) await new Promise((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = resolve; channel.port2.postMessage(0); }); })()",
        );
      // Re-check the expression only when something changed: the top page
      // reports a DOM or document-state change or a load (a capture listener
      // also hears the preview frame's load, since the sandboxed frame runs no
      // script of its own), or the browser sends an event (a navigation,
      // frame, context or load). While the paused canary frame holds the
      // page's promise tasks, the browser events still arrive.
      const pageChange = () =>
        evaluate(
          `new Promise((resolve) => {
            const changed = () => {
              observer.disconnect();
              document.removeEventListener("readystatechange", changed);
              document.removeEventListener("load", changed, true);
              resolve(true);
            };
            const observer = new MutationObserver(changed);
            observer.observe(document, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
            document.addEventListener("readystatechange", changed);
            document.addEventListener("load", changed, true);
          })`,
        ).catch(() => {});
      const wait = async (expression: string, contextId?: FrameContext) => {
        await withBrowserDeadline(
          (async () => {
            for (;;) {
              const change = Promise.race([browserEvent(), pageChange()]);
              if (await evaluate(expression, contextId)) return;
              await change;
            }
          })(),
          expression,
        );
      };
      await cdp("Runtime.enable");
      await cdp("Page.enable");
      await cdp("Fetch.enable", intercept);
      await cdp("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: false,
      });
      await cdp("Page.navigate", { url: server.url.href });
      await wait('!!document.querySelector("iframe.file-preview-html")');
      expect(
        await evaluate(
          'document.querySelector("iframe").getAttribute("sandbox")',
        ),
      ).toBe("");
      expect(
        await evaluate('document.querySelector("iframe").referrerPolicy'),
      ).toBe("no-referrer");
      expect(
        await evaluate(
          'document.querySelector("iframe").hasAttribute("srcdoc")',
        ),
      ).toBe(false);
      expect(
        await evaluate(
          'document.querySelector("iframe").hasAttribute("title")',
        ),
      ).toBe(false);
      expect(
        await evaluate(
          'document.querySelector("iframe").getAttribute("aria-label")',
        ),
      ).toBe("HTML preview: page.html");
      const frameContext = async () => {
        let context: FrameContext | undefined;
        await withBrowserDeadline(
          (async () => {
            while (!context) {
              const created = contextCreated();
              for (const candidate of contexts.values()) {
                const url = await evaluate("location.href", candidate).catch(
                  () => "",
                );
                if (
                  url.includes("/file/download") ||
                  url.endsWith("/policy.html")
                ) {
                  context = candidate;
                  break;
                }
              }
              // A frame's document gets a new execution context: wait for it.
              if (!context) await created;
            }
          })(),
          "HTML frame context",
        ).catch(async (error) => {
          console.error(
            JSON.stringify({
              tree: await cdp("Page.getFrameTree"),
              contexts: Array.from(contexts.entries()),
            }),
          );
          throw error;
        });
        return context!;
      };
      let context = await frameContext();
      await wait(
        'document.readyState === "complete" && !!document.querySelector("h1")',
        context,
      );
      expect(
        await evaluate(
          'getComputedStyle(document.querySelector("h1")).color',
          context,
        ),
      ).toBe("rgb(12, 34, 56)");
      expect(
        await evaluate(
          '(() => {const s=getComputedStyle(document.querySelector("h1"));return [s.borderTopWidth,s.paddingTop,s.letterSpacing,s.wordSpacing]})()',
          context,
        ),
      ).toEqual(["7px", "9px", "3px", "5px"]);
      expect(
        [...new Set(cdnRequests.map((request) => request.path))].sort(),
      ).toEqual(Object.keys(cdnStyles).sort());
      expect(
        cdnRequests.every((request) => request.referer === undefined),
      ).toBe(true);
      await Promise.all(interceptions);
      expect(interceptionErrors).toEqual([]);
      expect(
        await evaluate('document.querySelectorAll("td").length', context),
      ).toBe(2);
      expect(
        await evaluate(
          'document.querySelector("#pixel").naturalWidth',
          context,
        ),
      ).toBe(1);
      expect(
        await evaluate(
          'document.fonts.ready.then(() => Array.from(document.fonts).some(font => font.family === "preview" && font.status === "loaded"))',
          context,
        ),
      ).toBe(true);
      expect(
        await evaluate("document.documentElement.dataset.executed", context),
      ).toBeUndefined();
      expect(
        await evaluate(
          '(() => { try { return parent.document.body.innerHTML } catch { return "blocked" } })()',
          context,
        ),
      ).toBe("blocked");
      const url = await evaluate('document.querySelector("iframe").src');
      await screenshot("html-preview-desktop");
      for (const theme of ["dark", "light"]) {
        await cdp("Emulation.setDeviceMetricsOverride", {
          width: 390,
          height: 844,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        expect(
          await evaluate(
            '(() => {const r=document.querySelector(".file-preview").getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && document.querySelector("iframe").clientHeight>200})()',
          ),
        ).toBe(true);
        await screenshot(`html-preview-mobile-${theme}`);
      }
      await cdp("Emulation.clearDeviceMetricsOverride");
      for (const layout of ["desktop", "mobile"]) {
        await evaluate(
          `document.documentElement.dataset.layout=${JSON.stringify(layout)}`,
        );
        expect(
          await evaluate(
            'Array.from(document.querySelectorAll(".file-preview-copy, .file-preview-mode-toggle"), button => button.getBoundingClientRect().height)',
          ),
        ).toEqual([24, 24]);
      }
      await evaluate("delete document.documentElement.dataset.layout");
      const modeState = () =>
        evaluate(
          'document.querySelector(".file-preview-mode-toggle").getAttribute("aria-checked")',
        );
      expect(
        await evaluate(
          'document.querySelectorAll(".file-preview-mode-toggle[role=switch]").length',
        ),
      ).toBe(1);
      expect(
        await evaluate(
          'Array.from(document.querySelectorAll(".file-preview-mode-label"), label => label.textContent)',
        ),
      ).toEqual(["Preview", "Source"]);
      expect(await modeState()).toBe("false");
      await evaluate(
        'document.querySelector(".file-preview-mode-toggle").click()',
      );
      await wait(
        '!document.querySelector("iframe") && !!document.querySelector(".cm-lineNumbers")',
      );
      expect(
        await evaluate(
          'document.querySelector(".cm-content").textContent.includes("<script>")',
        ),
      ).toBe(true);
      expect(await modeState()).toBe("true");
      await screenshot("html-preview-source");
      expect(
        await evaluate(
          'document.querySelector(".file-preview-mode-toggle .settings-switch").classList.contains("is-on")',
        ),
      ).toBe(true);
      await evaluate(
        'document.querySelector(".file-preview-mode-toggle").focus()',
      );
      await cdp("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      await cdp("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: " ",
        code: "Space",
        windowsVirtualKeyCode: 32,
      });
      await wait('!!document.querySelector("iframe")');
      expect(await modeState()).toBe("false");
      await evaluate(
        'document.querySelector(".file-preview-mode-toggle").click()',
      );
      await wait('!document.querySelector("iframe")');
      await evaluate('htmlPreviewTest.show("docs/other.htm")');
      await wait('!!document.querySelector("iframe")');
      expect(await modeState()).toBe("false");
      await evaluate(
        'htmlPreviewTest.show("large.html", {size:524289,truncated:true})',
      );
      await wait(
        'document.body.textContent.includes("HTML is too large to render") && !document.querySelector("iframe")',
      );
      expect(
        await evaluate(
          'document.body.textContent.includes("Preview truncated")',
        ),
      ).toBe(false);
      await evaluate(
        'document.querySelector(".file-preview-mode-toggle").click()',
      );
      await wait('!!document.querySelector(".cm-content")');
      for (const overrides of [
        "{text:null,binary:true}",
        '{text:null,type:"directory"}',
      ]) {
        await evaluate(`htmlPreviewTest.show("bad.html", ${overrides})`);
        await wait(
          '!document.querySelector("iframe") && !document.querySelector(".file-preview-mode-toggle")',
        );
      }
      for (const path of ["/outside/page.html", "C:/outside/page.html"]) {
        await evaluate(`htmlPreviewTest.show(${JSON.stringify(path)})`);
        await wait(
          '!document.querySelector("iframe") && !document.querySelector(".file-preview-mode-toggle") && !!document.querySelector(".cm-content")',
        );
      }
      await evaluate("htmlPreviewTest.show()");
      await wait('!!document.querySelector("iframe")');
      await evaluate('document.querySelector("iframe").src="/policy.html"');
      context = await frameContext();
      await wait(
        'document.readyState === "complete" && !!document.querySelector("#top")',
        context,
      );
      const pagesBefore = (await targets()).filter(
        (target) => target.type === "page",
      ).length;
      for (const selector of ["#submit", "#top", "#parent", "#blank"]) {
        const point = await evaluate(
          `(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
          context,
        );
        const offset = await evaluate(
          '(() => {const r=document.querySelector("iframe").getBoundingClientRect();return {x:r.x,y:r.y}})()',
        );
        const position = {
          x: point.x + offset.x,
          y: point.y + offset.y,
          button: "left",
          clickCount: 1,
        };
        await cdp("Input.dispatchMouseEvent", {
          type: "mousePressed",
          ...position,
        });
        await cdp("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          ...position,
        });
      }
      // Observe delayed refresh/navigation and popup attempts after trusted clicks.
      await frames();
      expect(
        (await targets()).filter((target) => target.type === "page").length,
      ).toBe(pagesBefore);
      expect(await evaluate("location.href")).toBe(server.url.href);
      expect(await evaluate("location.href", context)).toBe(
        new URL("/policy.html", server.url).href,
      );
      expect(
        await evaluate("document.documentElement.dataset.executed", context),
      ).toBeUndefined();
      expect(canaries).toEqual([]);
      await cdp("Page.navigate", { url });
      await wait(
        'document.readyState === "complete" && !!document.querySelector("h1")',
      );
      expect(
        await evaluate('getComputedStyle(document.querySelector("h1")).color'),
      ).toBe("rgb(12, 34, 56)");
      await withBrowserDeadline(canarySetupReady, "canary CDP setup");
      await cdp("Page.navigate", {
        url: new URL("/policy.html", server.url).href,
      });
      await wait(
        'document.readyState === "complete" && !!document.querySelector("#top")',
      );
      // The paused canary frame can hold promise tasks; plain round trips
      // through the page's main thread still turn.
      for (let turn = 0; turn < 50; turn++) await evaluate("0");
      expect(await evaluate("location.href")).toBe(
        new URL("/policy.html", server.url).href,
      );
      expect(
        await evaluate("document.documentElement.dataset.executed"),
      ).toBeUndefined();
      expect(
        await evaluate(
          '(() => {try {return localStorage.length} catch {return "blocked"}})()',
        ),
      ).toBe("blocked");
      expect(canaries).toEqual([]);
      expect(cdnRequests.every((request) => request.path in cdnStyles)).toBe(
        true,
      );
      expect(canarySetupHeld).toBe(true);
      expect(racedSetup).toBeDefined();
      await racedSetup;
      await Promise.all(interceptions);
      expect(interceptionErrors).toEqual([]);
    } finally {
      await page?.close();
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  60_000,
);
