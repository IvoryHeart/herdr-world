import { afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stopChrome,
  waitForChromePort,
  withBrowserDeadline,
} from "../browserChrome";

/**
 * One Chrome per test process. Each case gets its own browser context
 * (`Target.createBrowserContext`: separate cookies, storage, cache and
 * permissions) and one page in it, so cases stay isolated while sharing the
 * browser's start-up cost. All traffic runs over one flattened CDP socket.
 */
export const chromeBinary =
  Bun.env.CHROME_BIN ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : Bun.which("google-chrome") || Bun.which("chromium"));

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

type Browser = {
  child: ReturnType<typeof Bun.spawn>;
  errorOutput: string;
  dir: string;
  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ): Promise<any>;
  listeners: Map<string, (method: string, params: any) => void>;
  socket: WebSocket;
};

let started: Promise<Browser> | undefined;

async function launch(flags: string[]): Promise<Browser> {
  if (!chromeBinary) throw new Error("Chrome is not installed");
  const dir = await mkdtemp(join(tmpdir(), "shared-chrome-"));
  const profile = join(dir, "profile");
  const errorOutput = join(dir, "browser.log");
  const child = Bun.spawn(
    [
      chromeBinary,
      "--headless",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      // Temporary test profiles must not wait on the desktop credential store.
      "--password-store=basic",
      `--user-data-dir=${profile}`,
      // Concurrent cases share one browser; none may be throttled as hidden.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      ...flags,
      "about:blank",
    ],
    { stdout: "ignore", stderr: Bun.file(errorOutput) },
  );
  try {
    const port = await waitForChromePort(child, profile, errorOutput);
    const version = (await withBrowserDeadline(
      fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(10_000),
      }).then((response) => response.json()),
      "Chrome debugger discovery",
    )) as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(version.webSocketDebuggerUrl);
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
    socket.onclose = socket.onerror = () => {
      for (const request of pending.values())
        request.reject(new Error("CDP connection closed"));
      pending.clear();
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
        request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    };
    const send = (
      method: string,
      params: Record<string, unknown> = {},
      sessionId?: string,
      timeoutMs?: number,
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
    return { child, errorOutput, dir, send, listeners, socket };
  } catch (error) {
    await stopChrome(child);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

afterAll(async () => {
  if (!started) return;
  const browser = await started.catch(() => undefined);
  started = undefined;
  if (!browser) return;
  browser.socket.close();
  await stopChrome(browser.child);
  await rm(browser.dir, { recursive: true, force: true });
});

export type ChromePage = {
  /** CDP command on this case's page. */
  cdp(method: string, params?: Record<string, unknown>): Promise<any>;
  /** Evaluate an expression in the page and return its value. */
  evaluate(expression: string): Promise<any>;
  /**
   * Resolve once `expression` is truthy, checked in the page after every DOM
   * mutation, focus change and animation frame rather than by polling.
   */
  waitFor(expression: string, timeoutMs?: number): Promise<void>;
  /** Rejects if the shared browser exits while the case runs. */
  exited: Promise<never>;
  close(): Promise<void>;
};

/**
 * Open an isolated page. Launch flags are fixed by the first caller in the
 * process; every caller of one file passes the same flags.
 */
export async function openChromePage(
  flags: string[] = ["--disable-gpu"],
): Promise<ChromePage> {
  started ??= launch(flags);
  const browser = await started;
  const { browserContextId } = await browser.send(
    "Target.createBrowserContext",
    { disposeOnDetach: true },
  );
  const { targetId } = await browser.send("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await browser.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const events = new Set<(method: string, params: any) => void>();
  browser.listeners.set(sessionId, (method, params) => {
    for (const listener of events) listener(method, params);
  });
  const cdp = (method: string, params?: Record<string, unknown>) =>
    browser.send(method, params, sessionId);
  const evaluate = async (expression: string) => {
    const result = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const watch = (expression: string) => `new Promise((resolve) => {
    const test = () => { try { return !!(${expression}); } catch { return false; } };
    if (test()) return resolve(true);
    let frame = 0;
    const done = () => {
      if (!test()) return;
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
    const tick = () => { done(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
  })`;
  // A navigation destroys the waiting context: resume once the next exists.
  const nextContext = () =>
    new Promise<void>((resolve) => {
      const once = (method: string) => {
        if (method !== "Runtime.executionContextCreated") return;
        events.delete(once);
        resolve();
      };
      events.add(once);
      void evaluate("1").then(
        () => {
          events.delete(once);
          resolve();
        },
        () => {},
      );
    });
  const waitFor = async (expression: string, timeoutMs = 20_000) => {
    let stopped = false;
    const watching = (async () => {
      while (!stopped) {
        const result = await browser
          .send(
            "Runtime.evaluate",
            {
              expression: watch(expression),
              returnByValue: true,
              awaitPromise: true,
            },
            sessionId,
            timeoutMs + 5_000,
          )
          .catch(() => undefined);
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
  await cdp("Runtime.enable");
  // Only one window holds real focus; every case behaves as the focused page.
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  const exited = browser.child.exited.then(async (code) => {
    throw new Error(
      `Browser exited (${code}): ${await readFile(browser.errorOutput, "utf8").catch(() => "")}`,
    );
  });
  exited.catch(() => {});
  return {
    cdp,
    evaluate,
    waitFor,
    exited,
    async close() {
      browser.listeners.delete(sessionId);
      await browser
        .send("Target.disposeBrowserContext", { browserContextId })
        .catch(() => {});
    },
  };
}
