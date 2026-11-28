import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../scripts/testing/browser-session";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorldBrowserBundle,
  readWorldBrowserBundle,
  type WorldBrowserBundle,
} from "./testing/browserBundles";
let bundle: WorldBrowserBundle;
let bundleDirectory: string | undefined;
beforeAll(async () => {
  if (!chrome) return;
  if (Bun.env.HERDR_WORLD_TEST_ASSETS)
    bundle = await readWorldBrowserBundle(
      "SharedViewCreation",
      Bun.env.HERDR_WORLD_TEST_ASSETS,
    );
  else {
    bundleDirectory = await mkdtemp(join(tmpdir(), "creation-bundle-"));
    bundle = await buildWorldBrowserBundle(
      "SharedViewCreation",
      bundleDirectory,
    );
  }
});
afterAll(async () => {
  if (bundleDirectory)
    await rm(bundleDirectory, { recursive: true, force: true });
});
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  waitForBrowserFixture,
} from "../browserChrome";
import { InputDriver } from "./browserAcceptanceFixture";
import { casePhases } from "./testing/casePhases";
import { chromeRenderingFlags } from "./testing/chromeRendering";

const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
test
  .skipIf(!chrome)
  .each(
    [1440, 390].flatMap((width) =>
      ["chat", "creation", "retention"].map(
        (scenario) => [width, scenario] as const,
      ),
    ),
  )(
  "rendering, focus and terminal lifecycle: shared creation across views at %ipx (%s)",
  async (width, scenario) => {
    const phases = casePhases(`SharedViewCreation ${width}px ${scenario}`);
    const dir = await mkdtemp(join(tmpdir(), "world-shared-creation-"));
    const assets = new Map<string, Blob>();
    const result = Promise.withResolvers<string[]>();
    let socket: WebSocket | undefined;
    const pageRequested = Promise.withResolvers<void>();
    let driver: InputDriver | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/") pageRequested.resolve();
        if (path === "/viewport-ready") {
          const [port] = (
            await readFile(join(dir, "profile", "DevToolsActivePort"), "utf8")
          ).split("\n");
          const targets = (await (
            await fetch(`http://127.0.0.1:${port}/json/list`)
          ).json()) as { type: string; webSocketDebuggerUrl: string }[];
          socket = new WebSocket(
            targets.find((target) => target.type === "page")!
              .webSocketDebuggerUrl,
          );
          await new Promise<void>((resolve, reject) => {
            socket!.onopen = () => resolve();
            socket!.onerror = () => reject(new Error("CDP connection failed"));
          });
          driver = new InputDriver(socket);
          await driver.call("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          });
          await driver.call("Emulation.setDeviceMetricsOverride", {
            width,
            height: width === 390 ? 844 : 1000,
            deviceScaleFactor: 1,
            mobile: width === 390,
          });
          await driver.call("Emulation.setTouchEmulationEnabled", {
            enabled: width === 390,
          });
          return new Response(String(width));
        }
        if (path === "/input" && request.method === "POST") {
          if (!driver) return new Response("Input not ready", { status: 503 });
          const { method, params } = await request.json();
          await driver.call(method, params);
          return new Response("ok");
        }
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        const asset = assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response(
          '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/SharedViewCreation.browser.css"></head><body><script type="module" src="/SharedViewCreation.browser.js"></script></body>',
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    let browser: TestBrowser | undefined;
    try {
      for (const [path, output] of bundle.assets) assets.set(path, output);
      phases.mark("setup");
      void pageRequested.promise.then(() => phases.mark("load"));
      browser = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--window-size=1440,1000",
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-dev-shm-usage",
          "--disable-background-networking",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          `${server.url.href}?scenario=${scenario}`,
        ],
        { stdout: "ignore", stderr: Bun.file(join(dir, "browser.log")) },
      );
      await browser.start();
      const observed = await waitForBrowserFixture(
        pageRequested.promise,
        result.promise,
        browser.exited.then((code) => {
          throw new Error(`Browser exited ${code}`);
        }),
        "Shared creation browser",
        120_000,
      );
      phases.mark("scene");
      if (observed.length) console.info("Shared creation failures", observed);
      expect(observed).toEqual([]);
    } finally {
      socket?.close();
      browser?.kill();
      if (browser) await browser.exited;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
      phases.done();
    }
  },
  150_000 + BROWSER_STARTUP_TIMEOUT_MS,
);
