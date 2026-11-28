import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { withBrowserDeadline } from "../browserChrome";
import {
  chromeRenderingFlags,
  GPU_FLAGS,
  PROBE_PAGE,
  PROBE_TIMEOUT_MS,
  type ProbeRun,
} from "../world/testing/chromeRendering";

/**
 * The one place test code starts Chrome (AGENTS.md: one shared browser per
 * job). A runner launches it once (one per four CPUs on a bigger machine,
 * `sharedChromeCount`) and passes its DevTools endpoints to every test
 * process in `HERDR_TEST_CHROME_WS`; a test file run on its own launches
 * one for its process instead (`sharedChrome.ts`). Every case then opens its
 * own browser context (`Target.createBrowserContext`: separate cookies,
 * storage, cache and permissions) with one page, sized by emulation rather
 * than by window flags.
 *
 * Chrome reports its DevTools endpoint on stderr as it starts, so the launch
 * reads that line instead of polling for a port file.
 */
export const chromeBinary =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

/** The environment variable a runner's shared Chrome is published in. */
export const SHARED_CHROME_ENV = "HERDR_TEST_CHROME_WS";

const LAUNCH_TIMEOUT_MS = 30_000;
/** How much of Chrome's stderr a failure quotes. */
const LOG_TAIL = 16_000;

/**
 * The CPUs this job really has: the process's CPU affinity, lowered by a
 * cgroup CPU quota (`cpu.max`, as in containers and CI sandboxes) when one
 * is set.
 */
export function jobCpus(
  cpuMax: () => string = () => readFileSync("/sys/fs/cgroup/cpu.max", "utf8"),
  affinity: number = availableParallelism(),
): number {
  let quota = Number.POSITIVE_INFINITY;
  try {
    const [limit, period] = cpuMax().trim().split(/\s+/);
    if (limit && limit !== "max" && Number(period) > 0)
      quota = Math.ceil(Number(limit) / Number(period));
  } catch {
    // No cgroup v2 CPU controller: the affinity is the limit.
  }
  return Math.max(1, Math.min(affinity, quota));
}

/** Flags every test browser shares; a case's needs are page emulation. */
export async function testChromeFlags(chrome: string): Promise<string[]> {
  return [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    // Temporary test profiles must not wait on the desktop credential store.
    "--password-store=basic",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-dev-shm-usage",
    "--mute-audio",
    // Concurrent cases share one browser; none may be throttled as hidden.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    // Pages that use WebGL get SwiftShader (or the local GPU opt-in). One
    // Chrome per job means one SwiftShader pool, which follows the CPU
    // affinity; raster threads stay within the job's CPUs too.
    "--enable-webgl",
    // 2D canvases draw on the CPU: through SwiftShader the website film's
    // full-motion frames took 48 s on four CPUs instead of 7 s.
    "--disable-accelerated-2d-canvas",
    `--num-raster-threads=${Math.min(4, jobCpus())}`,
    ...(await chromeRenderingFlags(chrome)),
    // Containers running as root have no usable sandbox.
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
  ];
}

/**
 * The local GPU opt-in's probe (chromeRendering.ts): one short Chrome that
 * prints its WebGL renderer and exits.
 */
export async function runProbeChrome(
  chrome: string,
  profile: string,
): Promise<ProbeRun> {
  const child = Bun.spawn(
    [
      chrome,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      ...GPU_FLAGS,
      "--dump-dom",
      PROBE_PAGE,
    ],
    { stdout: "pipe", stderr: "ignore" },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, PROBE_TIMEOUT_MS);
  try {
    const [output, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    return { output, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export type LaunchedChrome = {
  /** The browser's DevTools WebSocket endpoint. */
  endpoint: string;
  child: ReturnType<typeof Bun.spawn>;
  /** Chrome's stderr so far, for failure reports. */
  log(): string;
  stop(): Promise<void>;
};

/** Start one test Chrome; `extraFlags` only for launch-level needs. */
export async function launchChrome(
  extraFlags: readonly string[] = [],
  env?: Record<string, string | undefined>,
): Promise<LaunchedChrome> {
  const binary = env?.CHROME_BIN || chromeBinary;
  if (!binary) throw new Error("Chrome is not installed");
  const dir = await mkdtemp(join(env?.TMPDIR || tmpdir(), "test-chrome-"));
  const child = Bun.spawn(
    [
      binary,
      ...(await testChromeFlags(binary)),
      ...extraFlags,
      `--user-data-dir=${join(dir, "profile")}`,
      "about:blank",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe", env },
  );
  let output = "";
  const found = Promise.withResolvers<string>();
  // Drain stderr for Chrome's whole life: a full pipe would stall it.
  void (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
      output = (output + decoder.decode(chunk, { stream: true })).slice(
        -LOG_TAIL,
      );
      const endpoint = /DevTools listening on (ws:\/\/\S+)/.exec(output)?.[1];
      if (endpoint) found.resolve(endpoint);
    }
    found.reject(
      new Error(`Chrome exited during startup (${await child.exited})`),
    );
  })().catch((error: Error) => found.reject(error));
  const stop = async () => {
    child.kill("SIGTERM");
    try {
      await withBrowserDeadline(child.exited, "Chrome exit", 2_000);
    } catch {
      child.kill("SIGKILL");
      await withBrowserDeadline(child.exited, "Chrome forced exit", 10_000);
    }
    await rm(dir, { recursive: true, force: true });
  };
  try {
    const endpoint = await withBrowserDeadline(
      found.promise,
      "Chrome startup",
      LAUNCH_TIMEOUT_MS,
    );
    return { endpoint, child, log: () => output, stop };
  } catch (error) {
    await stop().catch(() => {});
    throw new Error(`${(error as Error).message}\n${output}`, {
      cause: error,
    });
  }
}

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export type BrowserConnection = {
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  /** Events by session. */
  listeners: Map<string, (method: string, params: any) => void>;
  /** Settles when the connection closes (the browser went away). */
  closed: Promise<void>;
  close(): void;
};

/** One flattened CDP socket to a browser. */
export async function connectBrowser(
  endpoint: string,
): Promise<BrowserConnection> {
  const socket = new WebSocket(endpoint);
  await withBrowserDeadline(
    new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("CDP connection failed"));
      socket.onclose = () => reject(new Error("CDP connection closed"));
    }),
    "CDP connection",
  );
  let id = 0;
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, (method: string, params: any) => void>();
  const closed = Promise.withResolvers<void>();
  socket.onclose = socket.onerror = () => {
    for (const request of pending.values())
      request.reject(new Error("CDP connection closed"));
    pending.clear();
    closed.resolve();
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id === undefined) {
      if (message.sessionId)
        listeners.get(message.sessionId)?.(message.method, message.params);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error)
      request.reject(new Error(message.error.message ?? message.error));
    else request.resolve(message.result);
  };
  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 20_000,
  ) => {
    const requestId = ++id;
    return withBrowserDeadline(
      new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(
          JSON.stringify({ id: requestId, method, params, sessionId }),
        );
      }),
      `CDP ${method}`,
      timeoutMs,
    ).finally(() => pending.delete(requestId));
  };
  return {
    send,
    listeners,
    closed: closed.promise,
    close: () => socket.close(),
  };
}

export type PageOptions = {
  /** The CSS viewport, pinned by emulation (default 1280×900 at scale 1). */
  viewport?: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
  };
  /**
   * Town submits frames to WebGL: golden images and visual captures only.
   * Checks of behaviour leave it off (`__HERDR_TOWN_PIXELS__`).
   */
  pixels?: boolean;
  /** `prefers-reduced-motion: reduce`. */
  reducedMotion?: boolean;
  /** Touch input and a coarse pointer, as on a phone. */
  touch?: boolean;
};

export type ChromePage = {
  /** The DevTools endpoint of the runner's shared Chrome this page is in. */
  sharedEndpoint?: string;
  /** CDP command on this case's page; `deadlineMs` for long measurements. */
  command(
    method: string,
    params?: Record<string, unknown>,
    deadlineMs?: number,
  ): Promise<any>;
  /** The same as `command`. */
  cdp(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Subscribe to a CDP event of this page; returns the unsubscribe. */
  on(method: string, listener: (params: any) => void): () => void;
  /** Evaluate an expression in the page (promises awaited) and return its value. */
  evaluate<T = any>(expression: string): Promise<T>;
  /**
   * Resolve once `expression` is truthy, checked in the page after every DOM
   * mutation, focus change and animation frame rather than by polling.
   */
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  /** Navigate and resolve once the new document has loaded. */
  navigate(url: string): Promise<void>;
  /** Rejects if the browser goes away while the case runs. */
  exited: Promise<never>;
  /** The case's own browser context, for a second tab of the same window. */
  browserContextId: string;
  close(): Promise<void>;
};

/**
 * The in-page watcher behind `waitFor`. Once the condition holds it removes
 * every observer and schedules no further frame, so a finished wait leaves no
 * frame loop running through the case's later steps. @internal
 */
export const watch = (expression: string) => `new Promise((resolve) => {
  const test = () => { try { return !!(${expression}); } catch { return false; } };
  if (test()) return resolve(true);
  let frame = 0;
  let finished = false;
  const done = () => {
    if (finished || !test()) return;
    finished = true;
    observer.disconnect();
    document.removeEventListener("focusin", done, true);
    document.removeEventListener("focusout", done, true);
    cancelAnimationFrame(frame);
    resolve(true);
  };
  const observer = new MutationObserver(done);
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener("focusin", done, true);
  document.addEventListener("focusout", done, true);
  const tick = () => { done(); if (!finished) frame = requestAnimationFrame(tick); };
  frame = requestAnimationFrame(tick);
})`;

/** Open an isolated context with one page in `browser`. */
export async function openPage(
  browser: BrowserConnection,
  exitedBrowser: Promise<never>,
  options: PageOptions = {},
): Promise<ChromePage> {
  const viewport = options.viewport ?? { width: 1280, height: 900 };
  const { browserContextId } = await browser.send(
    "Target.createBrowserContext",
    { disposeOnDetach: true },
  );
  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
    width: viewport.width,
    height: viewport.height,
  });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const events = new Map<string, Set<(params: any) => void>>();
  const anyEvent = new Set<(method: string, params: any) => void>();
  browser.listeners.set(sessionId, (method, params) => {
    for (const listener of anyEvent) listener(method, params);
    for (const listener of events.get(method) ?? []) listener(params);
  });
  const command = (
    method: string,
    params?: Record<string, unknown>,
    deadlineMs?: number,
  ) => browser.send(method, params, sessionId, deadlineMs);
  const on = (method: string, listener: (params: any) => void) => {
    const set = events.get(method) ?? new Set();
    set.add(listener);
    events.set(method, set);
    return () => {
      set.delete(listener);
    };
  };
  const evaluate = async (expression: string) => {
    const result = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  // A navigation destroys the waiting context: resume once the next exists.
  const nextContext = () =>
    new Promise<void>((resolve) => {
      const once = (method: string) => {
        if (method !== "Runtime.executionContextCreated") return;
        anyEvent.delete(once);
        resolve();
      };
      anyEvent.add(once);
      void evaluate("1").then(
        () => {
          anyEvent.delete(once);
          resolve();
        },
        () => {},
      );
    });
  const waitFor = async (expression: string, timeoutMs = 20_000) => {
    let stopped = false;
    const watching = (async () => {
      while (!stopped) {
        const result = await command(
          "Runtime.evaluate",
          {
            expression: watch(expression),
            returnByValue: true,
            awaitPromise: true,
          },
          timeoutMs + 5_000,
        ).catch(() => undefined);
        if (result?.exceptionDetails)
          throw new Error(JSON.stringify(result.exceptionDetails));
        if (result) return;
        if (!stopped) await nextContext();
      }
    })();
    try {
      await withBrowserDeadline(watching, "Browser condition", timeoutMs);
      return;
    } catch (error) {
      if (!/^Browser condition timed out/.test((error as Error).message))
        throw error;
    } finally {
      stopped = true;
    }
    const page = await evaluate("document.body?.innerText.slice(0, 600)").catch(
      (error: Error) => error.message,
    );
    throw new Error(
      `Browser condition timed out: ${expression}; page: ${JSON.stringify(page)}`,
    );
  };
  // A case's page starts on about:blank. Its first navigation replaces that
  // entry, so the app's history starts there, as in a Chrome launched on that
  // address: `history.back()` from the first view must not leave it.
  let first = true;
  // A case's own `Page.navigate` commands get the same first replacement.
  const pageCommand: ChromePage["command"] = (method, params, deadlineMs) => {
    if (method !== "Page.navigate" || !first)
      return command(method, params, deadlineMs);
    first = false;
    return command(
      "Runtime.evaluate",
      { expression: `location.replace(${JSON.stringify(params?.url)})` },
      deadlineMs,
    ).then(() => ({}));
  };
  const navigate = async (url: string) => {
    const loaded = Promise.withResolvers<void>();
    const off = on("Page.loadEventFired", () => loaded.resolve());
    try {
      const result = await pageCommand("Page.navigate", { url });
      if (result?.errorText)
        throw new Error(`Navigation failed: ${result.errorText}`);
      await withBrowserDeadline(loaded.promise, `Load ${url}`, 30_000);
      const reached = await evaluate("location.href");
      if (String(reached).startsWith("chrome-error:"))
        throw new Error(`Navigation failed: ${url}`);
    } finally {
      off();
    }
  };
  await command("Runtime.enable");
  await command("Page.enable");
  // Only one window holds real focus; every case behaves as the focused page.
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  await command("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    mobile: viewport.mobile ?? false,
  });
  if (options.touch)
    await command("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
  if (options.reducedMotion)
    await command("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
  if (!options.pixels)
    await command("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__HERDR_TOWN_PIXELS__ = false;",
    });
  const exited = exitedBrowser;
  return {
    command: pageCommand,
    cdp: (method, params) => pageCommand(method, params),
    on,
    evaluate,
    waitFor,
    navigate,
    exited,
    browserContextId,
    async close() {
      browser.listeners.delete(sessionId);
      await browser
        .send("Target.disposeBrowserContext", { browserContextId })
        .catch(() => {});
    },
  };
}

/**
 * The CPUs one shared Chrome serves. Its browser and GPU processes serve
 * every page in it, so on a big machine several Chromes keep those processes
 * from becoming the queue; a CI job's four CPUs still get one.
 */
const CPUS_PER_SHARED_CHROME = 4;

/** How many shared Chromes a runner starts for this job. */
export function sharedChromeCount(cpus = jobCpus()) {
  return Math.max(1, Math.floor(cpus / CPUS_PER_SHARED_CHROME));
}

/**
 * The runner's shared Chromes: `HERDR_TEST_CHROME_WS` holds one DevTools
 * endpoint per Chrome, space-separated.
 */
export function sharedChromeEndpoints(
  env: Record<string, string | undefined> = Bun.env,
): string[] {
  return env[SHARED_CHROME_ENV]?.split(" ").filter(Boolean) ?? [];
}

/**
 * A runner's shared Chromes, `count` of them: launched before the tests and
 * published to them in `HERDR_TEST_CHROME_WS`. Returns the variables to pass
 * and the stop.
 */
export async function startSharedChrome(
  env?: Record<string, string | undefined>,
  count = sharedChromeCount(),
): Promise<{
  env: Record<string, string>;
  stop(): Promise<void>;
}> {
  const launched = await Promise.allSettled(
    Array.from({ length: count }, () => launchChrome([], env)),
  );
  const chromes = launched.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const stop = async () => {
    await Promise.all(chromes.map((chrome) => chrome.stop()));
  };
  const failed = launched.find((result) => result.status === "rejected");
  if (failed) {
    await stop();
    throw (failed as PromiseRejectedResult).reason;
  }
  return {
    env: {
      [SHARED_CHROME_ENV]: chromes.map((chrome) => chrome.endpoint).join(" "),
    },
    stop,
  };
}
