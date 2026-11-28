import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { connectDevtools } from "../../web/src/world/testing/connectCapture";
import { stopChrome, withBrowserDeadline } from "../../web/src/browserChrome";
import type {
  BuildRequest,
  SerializedBuild,
} from "../../web/src/world/testing/sharedBrowserBuild";
import { createBrowserTLS } from "./browser-tls";
import { browserCapacity } from "./browser-capacity";
import {
  GPU_FLAGS,
  SWIFTSHADER_FLAGS,
  isHardwareRenderer,
} from "../../web/src/world/testing/chromeRendering";

/** Native launch boundary, also used by standalone capture/probe commands. */
export const spawnTestChrome = Bun.spawn;
export const spawnTestChromeSync = Bun.spawnSync;

/** Queue conservatively, but never download/start Chrome for synthetic unit probes. */
export function browserSelectionNeedsChrome(
  args: string[],
  inventory: string[],
  root = process.cwd(),
): boolean {
  const candidates = new Set<string>();
  const registered = new Set(inventory.map((file) => resolve(root, file)));
  let narrowed = false;
  for (const arg of args.filter((arg) => !arg.startsWith("-"))) {
    const path = resolve(root, arg);
    if (existsSync(path)) {
      narrowed = true;
      if (statSync(path).isFile()) candidates.add(path);
      else
        for (const file of inventory) {
          const candidate = resolve(root, file);
          const inside = relative(path, candidate);
          if (!inside.startsWith("..") && !inside.startsWith("/"))
            candidates.add(candidate);
        }
    } else {
      const matching = inventory.filter((file) => file.includes(arg));
      if (matching.length) {
        narrowed = true;
        for (const file of matching) candidates.add(resolve(root, file));
      }
    }
  }
  if (!narrowed)
    for (const file of inventory) candidates.add(resolve(root, file));
  return [...candidates].some(
    (path) =>
      registered.has(path) ||
      (existsSync(path) &&
        /^\/\/ @world-browser-suite\b/m.test(readFileSync(path, "utf8"))),
  );
}

/** @internal Select flags without launching a second probe browser. */
export function managedRenderingFlags(
  env: Record<string, string | undefined> = process.env,
): string[] {
  if (env.CI === "true" || env.HERDR_TEST_BROWSER_RENDERING === "swiftshader")
    return [...SWIFTSHADER_FLAGS];
  return env.HERDR_TEST_BROWSER_RENDERING === "gpu" ||
    env.HERDR_WORLD_TEST_GPU === "1"
    ? [...GPU_FLAGS]
    : [...SWIFTSHADER_FLAGS];
}

/** The runner owns Chrome; individual tests own only an incognito context. */
export async function browserSession(
  chrome: string,
  options: { golden?: boolean; maxContexts?: number } = {},
): Promise<{ env: Record<string, string>; close(): Promise<void> }> {
  if (process.env.HERDR_TEST_BROWSER)
    return {
      env: {
        HERDR_TEST_BROWSER: process.env.HERDR_TEST_BROWSER,
        HERDR_TEST_BROWSER_TOKEN: process.env.HERDR_TEST_BROWSER_TOKEN!,
      },
      close: async () => {},
    };
  const profile = await mkdtemp(join(tmpdir(), "world-shared-chrome-"));
  const assets = process.env.HERDR_WORLD_TEST_ASSETS || join(profile, "assets");
  await mkdir(assets, { recursive: true });
  const tls = await createBrowserTLS(profile).catch(async (error) => {
    await rm(profile, { recursive: true, force: true });
    throw error;
  });
  const started = performance.now();
  const rendering = managedRenderingFlags();
  let child: Bun.Subprocess<"ignore", "ignore", "pipe">;
  try {
    child = spawnTestChrome(
      [
        chrome,
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--password-store=basic",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        // Match legacy web tests' CPU canvas without disabling Town's WebGL.
        "--disable-accelerated-2d-canvas",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        ...rendering,
        ...(options.golden
          ? [
              "--force-device-scale-factor=1",
              "--force-color-profile=srgb",
              "--disable-lcd-text",
              "--font-render-hinting=none",
            ]
          : []),
        ...(tls
          ? [`--ignore-certificate-errors-spki-list=${tls.fingerprint}`]
          : []),
        "about:blank",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
  const stop = () => {
    child.kill("SIGTERM");
  };
  const exit = () => {
    child.kill("SIGKILL");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("exit", exit);
  const endpoint = Promise.withResolvers<string>();
  let log = "";
  void (async () => {
    for await (const chunk of child.stderr) {
      log = (log + new TextDecoder().decode(chunk)).slice(-16000);
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
      if (match) endpoint.resolve(match[1]!);
    }
  })().catch(endpoint.reject);
  void child.exited.then((code) =>
    endpoint.reject(new Error(`Chrome exited ${code}: ${log}`)),
  );
  let browser: Awaited<ReturnType<typeof connectDevtools>>;
  try {
    browser = await connectDevtools(
      await withBrowserDeadline(endpoint.promise, "Chrome launch", 35000),
    );
    const { targetInfos } = await browser.command("Target.getTargets");
    const initial = targetInfos.find(
      (target: { type: string }) => target.type === "page",
    );
    if (!initial) throw new Error("Chrome did not create its startup page");
    const page = await connectDevtools(
      endpointForTarget(await endpoint.promise, initial.targetId),
    );
    try {
      const html = await page.command("Runtime.evaluate", {
        expression: "document.documentElement.outerHTML",
        returnByValue: true,
      });
      if (!String(html.result.value).includes("<html"))
        throw new Error("Chrome startup page did not render HTML");
      if (rendering.includes("--use-angle=vulkan")) {
        const report = await page.command("Runtime.evaluate", {
          returnByValue: true,
          expression: `(() => {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
          if (!gl) return "no-webgl";
          const debug = gl.getExtension("WEBGL_debug_renderer_info");
          return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        })()`,
        });
        if (
          typeof report.result.value !== "string" ||
          !isHardwareRenderer(report.result.value)
        )
          throw new Error(
            "Hardware WebGL unavailable in the shared Chrome; use the default software renderer.",
          );
      }
    } finally {
      page.close();
    }
  } catch (error) {
    try {
      await stopChrome(child);
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      process.off("exit", exit);
      await rm(profile, { recursive: true, force: true });
    }
    throw error;
  }
  const slots = browserCapacity(
    Math.max(2, Math.min(options.maxContexts ?? 8, availableParallelism())),
  );
  const contexts = new Map<
    string,
    {
      proxy: ReturnType<typeof Bun.serve>;
      page: Awaited<ReturnType<typeof connectDevtools>>;
      started: number;
      phases: Record<string, number>;
      url: string;
      release(): void;
      closed: ReturnType<typeof Promise.withResolvers<number>>;
    }
  >();
  const completed = new Map<string, number>();
  const builds = new Map<
    string,
    ReturnType<typeof Promise.withResolvers<SerializedBuild>>
  >();
  const buildingAt = new Map<string, number>();
  void child.exited.then((code) => {
    for (const context of contexts.values()) context.closed.resolve(code || 1);
  });
  const token = crypto.randomUUID();
  const launchMs = performance.now() - started;
  const dispose = async (id: string, code = 0) => {
    const context = contexts.get(id);
    if (!context) return;
    contexts.delete(id);
    let verdict = code;
    try {
      const snapshot = await context.page
        .command(
          "Runtime.evaluate",
          {
            expression:
              "JSON.stringify({url:location.href, width:innerWidth, height:innerHeight, focus:document.activeElement?.outerHTML?.slice(0,160), phase:window.__concurrentStage, town:window.__townCheckProgress?.slice(-2)})",
            returnByValue: true,
          },
          1000,
        )
        .catch(() => undefined);
      appendFileSync(
        ".agents/delivery/browser-state.jsonl",
        (snapshot?.result?.value ?? "{}") + "\n",
      );
      context.page.close();
      await browser.command("Target.disposeBrowserContext", {
        browserContextId: id,
      });
    } catch (error) {
      verdict = 1;
      throw error;
    } finally {
      completed.set(id, verdict);
      context.closed.resolve(verdict);
      context.proxy.stop(true);
      context.release();
      const row = {
        phase: "case",
        url: context.url,
        launchMs,
        totalMs: performance.now() - context.started,
        ...context.phases,
      };
      appendFileSync(
        ".agents/delivery/browser-phases.jsonl",
        JSON.stringify(row) + "\n",
      );
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\nBrowser case ${new URL(context.url).pathname}${new URL(context.url).search}: ${JSON.stringify(row)}\n`,
        );
    }
  };
  mkdirSync(".agents/delivery", { recursive: true });
  appendFileSync(
    ".agents/delivery/browser-phases.jsonl",
    JSON.stringify({ phase: "chrome", launchMs }) + "\n",
  );
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== token)
        return new Response("Forbidden", { status: 403 });
      const data = (await request.json()) as {
        args?: string[];
        context?: string;
        watch?: string;
        start?: string;
        build?: BuildRequest;
        focusEmulation?: boolean;
        tls?: boolean;
        proxyServer?: string;
        proxyBypassList?: string;
      };
      if (data.tls)
        return tls
          ? Response.json({ key: tls.key, cert: tls.cert })
          : new Response("TLS unavailable", { status: 503 });
      if (data.start) {
        const context = contexts.get(data.start);
        if (!context) return new Response("Unknown context", { status: 404 });
        await context.page.command("Page.navigate", { url: context.url });
        return Response.json({});
      }
      if (data.build) {
        const { key, action, output, error } = data.build;
        if (!/^[a-f0-9]{64}$/.test(key))
          return new Response("Invalid build key", { status: 400 });
        if (action === "claim") {
          const existing = builds.get(key);
          if (existing)
            return Response.json({
              owner: false,
              output: await existing.promise,
            });
          const pending = Promise.withResolvers<SerializedBuild>();
          void pending.promise.catch(() => {});
          builds.set(key, pending);
          buildingAt.set(key, performance.now());
          return Response.json({ owner: true });
        }
        const pending = builds.get(key);
        if (!pending) return new Response("Unknown build", { status: 400 });
        if (action === "fail") pending.reject(new Error(error));
        else pending.resolve(output!);
        if (action === "fail" || !output?.success) builds.delete(key);
        appendFileSync(
          ".agents/delivery/browser-phases.jsonl",
          JSON.stringify({
            phase: "bundle",
            label: data.build.label,
            buildMs: performance.now() - buildingAt.get(key)!,
            success: output?.success === true,
          }) + "\n",
        );
        return Response.json({});
      }
      if (data.watch) {
        const owned = contexts.get(data.watch);
        if (!owned)
          return completed.has(data.watch)
            ? Response.json({ code: completed.get(data.watch) })
            : new Response("Unknown context", { status: 404 });
        const abandoned = () => {
          void dispose(data.watch!, 1).catch(() => {});
        };
        request.signal.addEventListener("abort", abandoned, { once: true });
        try {
          return Response.json({ code: await owned.closed.promise });
        } finally {
          request.signal.removeEventListener("abort", abandoned);
        }
      }
      if (data.context) {
        await dispose(data.context);
        return Response.json({});
      }
      const began = performance.now();
      const release = await slots.acquire();
      const admitted = performance.now();
      const args = data.args!;
      const browserContextId = await browser
        .command("Target.createBrowserContext", {
          disposeOnDetach: true,
          ...(data.proxyServer
            ? {
                proxyServer: data.proxyServer,
                proxyBypassList: data.proxyBypassList ?? "",
              }
            : {}),
        })
        .then((result) => result.browserContextId as string)
        .catch((error) => {
          release();
          throw error;
        });
      try {
        const size = args
          .find((arg) => arg.startsWith("--window-size="))
          ?.slice(14)
          .split(",")
          .map(Number) ?? [800, 600];
        // Match headless --window-size's minimum. Cases requiring an exact
        // phone CSS viewport already pin it with Emulation before navigation.
        const { targetId } = await browser.command("Target.createTarget", {
          url: "about:blank",
          browserContextId,
          newWindow: true,
          width: Math.max(500, size[0]!),
          height: size[1],
        });
        const ws = endpointForTarget(await endpoint.promise, targetId);
        const page = await connectDevtools(ws);
        page.on("Runtime.exceptionThrown", (event) => {
          mkdirSync(".agents/delivery", { recursive: true });
          appendFileSync(
            ".agents/delivery/browser-errors.jsonl",
            JSON.stringify(event) + "\n",
          );
        });
        const phases: Record<string, number> = {
          queueMs: admitted - began,
          contextMs: performance.now() - admitted,
          waitMs: 0,
          waits: 0,
        };
        page.on("Runtime.bindingCalled", ({ name, payload }) => {
          if (name !== "__herdrTestPhase") return;
          const event = JSON.parse(payload);
          if (event.phase === "wait") {
            phases.waitMs! += event.ms;
            phases.waits! += event.count ?? 1;
          } else {
            phases[event.phase + "Ms"] = event.ms;
            if (event.count !== undefined)
              phases[event.phase + "Count"] = event.count;
          }
        });
        await page.command("Runtime.enable");
        await page.command("Page.enable");
        await page.command("Runtime.addBinding", { name: "__herdrTestPhase" });
        await page.command("Page.addScriptToEvaluateOnNewDocument", {
          source: `(() => {
          const now = performance.now.bind(performance), began = now();
          globalThis.__herdrTestFrame = requestAnimationFrame.bind(globalThis);
          globalThis.__herdrTestCancelFrame = cancelAnimationFrame.bind(globalThis);
          globalThis.__herdrTestDeadline = setTimeout.bind(globalThis);
          globalThis.__herdrTestClearDeadline = clearTimeout.bind(globalThis);
          const report = (phase, ms, count) => globalThis.__herdrTestPhase(JSON.stringify({phase, ms, count}));
          let nextWait = 0, waitAt = 0, waitCount = 0;
          let assertionMs = 0, assertionCount = 0;
          globalThis.__herdrTestAssert = work => {
            const start = now();
            try { return work(); }
            finally { assertionMs += now() - start; assertionCount++; }
          };
          const waiting = new Set();
          globalThis.__herdrTestWait = () => {
            const id = ++nextWait;
            if (!waiting.size) waitAt = now();
            waiting.add(id); waitCount++;
            return () => { if (waiting.delete(id) && !waiting.size) { report('wait', now() - waitAt, waitCount); waitCount = 0; } };
          };
          addEventListener('load', () => report('pageLoad', now() - began), {once:true});
          requestAnimationFrame(() => report('firstFrame', now() - began));
          const fetch = globalThis.fetch;
          globalThis.fetch = function(input, options) {
            if (String(input).includes('/result')) {
              if (waiting.size) report('openWait', now() - waitAt, waitCount);
              report('assertions', assertionMs, assertionCount);
              report('assertionsComplete', now() - began);
            }
            return fetch.call(this, input, options);
          };
        })()`,
        });
        if (data.focusEmulation !== false)
          await page.command("Emulation.setFocusEmulationEnabled", {
            enabled: true,
          });
        if (args.includes("--force-prefers-reduced-motion"))
          await page.command("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-reduced-motion", value: "reduce" }],
          });
        const proxy = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            if (new URL(request.url).pathname !== "/json/list")
              return new Response("Not found", { status: 404 });
            const { targetInfos } = await browser.command("Target.getTargets");
            const targets = (
              targetInfos as {
                targetId: string;
                browserContextId?: string;
                type: string;
              }[]
            )
              .filter((target) => target.browserContextId === browserContextId)
              .sort(
                (a, b) =>
                  Number(b.targetId === targetId) -
                  Number(a.targetId === targetId),
              );
            return Response.json(
              targets.map((target) => ({
                ...target,
                id: target.targetId,
                webSocketDebuggerUrl: endpointForTarget(ws, target.targetId),
              })),
            );
          },
        });
        const url =
          [...args]
            .reverse()
            .find((arg) => /^(?:https?:|about:|data:)/.test(arg)) ??
          "about:blank";
        contexts.set(browserContextId, {
          page,
          proxy,
          started: began,
          phases,
          url,
          release,
          closed: Promise.withResolvers<number>(),
        });
        page.on("Page.frameNavigated", ({ frame }) => {
          if (!frame.parentId) {
            const context = contexts.get(browserContextId);
            if (context) context.url = frame.url;
          }
        });
        return Response.json({
          context: browserContextId,
          port: String(proxy.port),
          ws,
          processId: child.pid,
        });
      } catch (error) {
        release();
        await browser.command("Target.disposeBrowserContext", {
          browserContextId,
        });
        throw error;
      }
    },
  });
  return {
    env: {
      HERDR_TEST_BROWSER: server.url.href,
      HERDR_TEST_BROWSER_TOKEN: token,
      HERDR_WORLD_TEST_ASSETS: assets,
      HERDR_TEST_BROWSER_RENDERING: rendering.includes("--use-angle=vulkan")
        ? "gpu"
        : "swiftshader",
    },
    async close() {
      slots.close();
      for (const { page, proxy } of contexts.values()) {
        page.close();
        proxy.stop(true);
      }
      server.stop(true);
      browser.close();
      try {
        await stopChrome(child);
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        process.off("exit", exit);
        await rm(profile, { recursive: true, force: true });
      }
    },
  };
}

/** @internal Pure target routing: never attach a case to another case's page. */
export function endpointForTarget(browserEndpoint: string, target: string) {
  return browserEndpoint.replace(
    /\/devtools\/(?:browser|page)\/.*$/,
    `/devtools/page/${target}`,
  );
}

export type TestBrowser = {
  exited: Promise<number>;
  exitCode: number | null;
  kill(signal?: string | number): void;
  devtoolsPort: string;
  contextId: string;
  processId: number;
  start(): Promise<void>;
};

/** Preserve test lifecycle handles while disposing only the owning context. */
export async function launchTestBrowser(
  args: string[],
  _options?: unknown,
  mode: {
    focusEmulation?: boolean;
    proxyServer?: string;
    proxyBypassList?: string;
  } = {},
): Promise<TestBrowser> {
  if (!process.env.HERDR_TEST_BROWSER)
    throw new Error("Browser tests must run through bun run test / test:world");
  const headers = {
    authorization: process.env.HERDR_TEST_BROWSER_TOKEN!,
    "content-type": "application/json",
  };
  const response = await fetch(process.env.HERDR_TEST_BROWSER, {
    method: "POST",
    headers,
    body: JSON.stringify({ args, ...mode }),
  });
  if (!response.ok)
    throw new Error(`Browser context failed: ${await response.text()}`);
  const { context, port, processId } = (await response.json()) as {
    context: string;
    port: string;
    processId: number;
  };
  const closed = Promise.withResolvers<number>();
  let closing = false;
  let started = false;
  const handle: TestBrowser = {
    devtoolsPort: port,
    contextId: context,
    processId,
    exitCode: null,
    exited: closed.promise,
    async start() {
      if (started) return;
      started = true;
      const response = await fetch(process.env.HERDR_TEST_BROWSER!, {
        method: "POST",
        headers,
        body: JSON.stringify({ start: context }),
      });
      if (!response.ok)
        throw new Error(`Browser navigation failed: ${await response.text()}`);
    },
    kill() {
      if (closing) return;
      closing = true;
      void fetch(process.env.HERDR_TEST_BROWSER!, {
        method: "POST",
        headers,
        body: JSON.stringify({ context }),
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              `Context teardown failed: ${await response.text()}`,
            );
        }, closed.reject)
        .catch(closed.reject);
    },
  };
  const errorOutput = (_options as { stderr?: { name?: string } } | undefined)
    ?.stderr?.name;
  if (errorOutput)
    await Bun.write(
      errorOutput,
      "Shared Chrome case; diagnostics are retained in browser-errors.jsonl and browser-state.jsonl.\n",
    );
  void fetch(process.env.HERDR_TEST_BROWSER, {
    method: "POST",
    headers,
    body: JSON.stringify({ watch: context }),
  })
    .then(async (response) => {
      if (!response.ok)
        throw new Error(
          `Browser lifecycle connection failed: ${await response.text()}`,
        );
      const { code } = (await response.json()) as { code: number };
      handle.exitCode = code;
      closed.resolve(code);
    }, closed.reject)
    .catch(closed.reject);
  // Compatibility for existing test CDP discovery; the port belongs to this
  // context's proxy, never the browser-wide target list.
  const profile = args
    .find((arg) => arg.startsWith("--user-data-dir="))
    ?.slice(16);
  if (profile) {
    await mkdir(profile, { recursive: true });
    await writeFile(
      join(profile, "DevToolsActivePort"),
      `${port}\n/devtools/browser/context\n`,
    );
  }
  return handle;
}
