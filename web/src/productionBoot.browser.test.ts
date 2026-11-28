import { sharedBrowserBuild } from "./world/testing/sharedBrowserBuild";
import {
  launchTestBrowser,
  type TestBrowser,
} from "../../scripts/testing/browser-session";
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { InputDriver } from "./world/browserAcceptanceFixture";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
} from "./browserChrome";
import { SWIFTSHADER_FLAGS } from "./world/testing/chromeRendering";
import previous from "./testing/previous-release-storage.json";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const root = resolve(import.meta.dir, "../..");

test.skipIf(!chrome)(
  "packaged production entry boots an older profile, resumes and activates a worker update",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "production-boot-"));
    const assets = join(directory, "public");
    let browser: TestBrowser | undefined;
    let driver: InputDriver | undefined;
    let suffix = "Before resume";
    let servedNewBuild = false;
    let workerRequests = 0;
    const previousRequested = Promise.withResolvers<void>();
    // Static release assets + synthetic HTTP responses. No World/runtime process.
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/previous") {
          previousRequested.resolve();
          return new Response("<title>Previous profile</title>", {
            headers: { "Content-Type": "text/html" },
          });
        }
        if (url.pathname === "/api/instance-settings")
          return Response.json({ title_suffix: suffix });
        if (url.pathname.startsWith("/api/")) return Response.json({});
        if (url.pathname === "/task-notifications-sw.js") workerRequests++;
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        if (servedNewBuild && path === "/index.html") {
          const html = await readFile(join(assets, "index.html"), "utf8");
          return new Response(
            html.replace(
              /src="\/assets\/index-[^"]+\.js"/,
              'src="/assets/index-next-release.js"',
            ),
            {
              headers: {
                "Content-Type": "text/html",
                "Cache-Control": "no-store",
              },
            },
          );
        }
        if (path.split("/").includes(".."))
          return new Response(null, { status: 404 });
        const file = Bun.file(join(assets, path.slice(1)));
        return (await file.exists())
          ? new Response(file, { headers: { "Cache-Control": "no-store" } })
          : new Response(null, { status: 404 });
      },
    });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const response = (await withBrowserDeadline(
        driver!.call("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
        "Production journey step",
        20_000,
      )) as { result: { value: T }; exceptionDetails?: unknown };
      expect(response.exceptionDetails).toBeUndefined();
      return response.result.value;
    };
    // Conditions observe the actual mounted application; no fixed dwell waits.
    const until = (condition: string) =>
      evaluate(`new Promise((resolve,reject)=>{
    const ready=()=>{if(${condition}){observer.disconnect();clearTimeout(timer);resolve(true)}};
    const observer=new MutationObserver(ready);observer.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
    const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Application condition: '+${JSON.stringify(condition)}))},15000);ready();})`);
    try {
      // Use the release Vite configuration and unchanged index.html/main.tsx.
      await build({
        root: join(root, "web"),
        configFile: join(root, "web/vite.config.ts"),
        logLevel: "silent",
        build: { outDir: assets, emptyOutDir: true },
      });
      // A browser driver calls the real worker preparation function. It does not
      // replace the application entry or mock serviceWorker/visibility APIs.
      const helper = await sharedBrowserBuild(import.meta.path, {
        entrypoints: [join(root, "web/src/taskNotifications.ts")],
        target: "browser",
      });
      expect(helper.success).toBe(true);
      await Bun.write(
        join(assets, "journey-notifications.js"),
        await helper.outputs[0]!.text(),
      );
      const log = join(directory, "chrome.log");
      browser = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          "--remote-debugging-port=0",
          `--user-data-dir=${join(directory, "profile")}`,
          "--window-size=1280,800",
          ...SWIFTSHADER_FLAGS,
          "about:blank",
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
        { focusEmulation: false },
      );
      await browser.start();
      const port = await waitForChromePort(
        browser,
        join(directory, "profile"),
        log,
      );
      const targets = (await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const socket = new WebSocket(
        targets.find((target) => target.type === "page")!.webSocketDebuggerUrl,
      );
      await new Promise<void>((done, fail) => {
        socket.onopen = () => done();
        socket.onerror = () => fail(new Error("CDP failed"));
      });
      driver = new InputDriver(socket);
      await driver.call("Page.enable", {});
      const navigate = async (url: string) => {
        const loaded = Promise.withResolvers<void>();
        const receive = (event: MessageEvent) => {
          if (JSON.parse(String(event.data)).method === "Page.loadEventFired")
            loaded.resolve();
        };
        socket.addEventListener("message", receive);
        try {
          await driver!.call("Page.navigate", { url });
          await withBrowserDeadline(loaded.promise, "Production page load");
        } finally {
          socket.removeEventListener("message", receive);
        }
      };
      await navigate(`${server.url}previous`);
      await previousRequested.promise;
      await until(
        `location.pathname === '/previous' && document.title === 'Previous profile'`,
      );
      await evaluate(
        `Object.entries(${JSON.stringify(previous.storage)}).forEach(([key,value])=>localStorage.setItem(key,value)); true`,
      );
      // #965: an already installed worker at an older URL must be replaced and
      // activated, rather than treating registration as proof of readiness.
      await evaluate(
        `(async()=>{await navigator.serviceWorker.register('/task-notifications-sw.js?v=3');await navigator.serviceWorker.ready;return true})()`,
      );
      await navigate(server.url.href);
      await until(
        `document.querySelector('#root')?.children.length && !document.querySelector('#root > pre') && document.title.includes('Before resume')`,
      );
      expect(
        await evaluate<string>(
          `document.querySelector('script[type="module"][src]')?.getAttribute('src')`,
        ),
      ).toMatch(/^\/assets\/index-.*\.js$/);
      expect(
        await evaluate(
          `Object.fromEntries(Object.keys(${JSON.stringify(previous.storage)}).map(key=>[key,localStorage.getItem(key)]))`,
        ),
      ).toEqual(previous.storage);
      await evaluate(
        `window.__bootErrors=[];window.__resumeCount=0;window.__bootIdentity={};window.addEventListener('error',e=>window.__bootErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__bootErrors.push(String(e.reason)));document.addEventListener('resume',()=>window.__resumeCount++);true`,
      );
      const background = (await driver.call("Target.createTarget", {
        url: "about:blank",
        browserContextId: browser.contextId,
      })) as { targetId: string };
      await driver.call("Target.activateTarget", {
        targetId: background.targetId,
      });
      expect(await evaluate(`document.visibilityState`)).toBe("hidden");
      await driver.call("Page.setWebLifecycleState", { state: "frozen" });
      suffix = "After resume";
      servedNewBuild = true;
      await driver.call("Page.setWebLifecycleState", { state: "active" });
      await driver.call("Page.bringToFront", {});
      await driver.call("Target.closeTarget", {
        targetId: background.targetId,
      });
      // The focus event is real CDP focus, and the production listeners recheck.
      await driver.call("Emulation.setFocusEmulationEnabled", {
        enabled: true,
      });
      await until(`window.__resumeCount > 0`);
      await until(`document.title.includes('After resume')`);
      await until(
        `document.body.textContent.includes('The service now serves a different Herdr World build')`,
      );
      await evaluate(
        `(async()=>{const module=await import('/journey-notifications.js');const registration=await module.prepareTaskNotifications();return registration?.active?.scriptURL})()`,
      ).then((url) =>
        expect(url).toBe(`${server.url}task-notifications-sw.js?v=4`),
      );
      expect(workerRequests).toBeGreaterThanOrEqual(2);
      expect(
        await evaluate(
          `!!window.__bootIdentity && !document.querySelector('#root > pre') && !!document.querySelector('#root')?.children.length`,
        ),
      ).toBe(true);
      expect(await evaluate(`window.__bootErrors`)).toEqual([]);
    } finally {
      driver?.close();
      await stopChrome(browser);
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
