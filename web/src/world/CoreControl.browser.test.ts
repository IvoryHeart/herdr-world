import {
  launchTestBrowser,
  type TestBrowser,
} from "../../../scripts/testing/browser-session";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreMirror } from "../../../server/src/herdr-core/mirror";
import {
  CoreFirstSight,
  coreRuntimeReader,
} from "../../../server/src/herdr-core/topology";
import { worldRuntimeRegistry } from "../../../server/src/world/runtime-registry";
import { WorldSnapshotService } from "../../../server/src/world/snapshot";
import {
  BROWSER_STARTUP_TIMEOUT_MS,
  stopChrome,
  waitForBrowserFixture,
  waitForChromePort,
} from "../browserChrome";
import { InputDriver } from "./browserAcceptanceFixture";
import { buildWorldBrowserBundle } from "./testing/browserBundles";
import { chromeRenderingFlags } from "./testing/chromeRendering";
import { connectCapture } from "./testing/connectCapture";

const chrome =
  Bun.env.CHROME_BIN ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin" &&
  existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

/** The repository's standard capture viewports. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1512, height: 982, mobile: false },
  { name: "wide", width: 2560, height: 1440, mobile: false },
  { name: "half", width: 1280, height: 1440, mobile: false },
  { name: "portrait", width: 1440, height: 2560, mobile: false },
] as const;

/**
 * Terminals a start leaves on the host: a shell (t9), an agent (t10) and a
 * second shell started while the Hosts filter hides the host (t11).
 */
const STARTED = {
  t9: { address: "t9", labels: {}, argv: ["/bin/sh"], state: "live", pid: 19 },
  t11: {
    address: "t11",
    labels: {},
    argv: ["/bin/sh"],
    state: "live",
    pid: 21,
  },
  t10: {
    address: "t10",
    labels: {},
    argv: ["claude"],
    state: "live",
    pid: 20,
    turn: 0,
    status: { state: "idle", app: "claude-code" },
  },
} as const;

/**
 * A core host: the builder has a sub-agent that ends with it and one that
 * outlives it; `started` adds what a start left. `beta` adds a second core
 * host with one shell, for a Hosts filter that hides the first.
 */
async function coreSnapshot(
  started: readonly (keyof typeof STARTED)[] = [],
  beta = false,
) {
  const placed = (tab: string, where: string) => ({
    "herdr.space": "fx-web",
    "herdr.tab": tab,
    where,
  });
  const terminals = [
    {
      address: "t1",
      name: "reviewer",
      labels: placed("fx-review", "web / review"),
      argv: ["claude"],
      state: "live",
      pid: 11,
      turn: 0,
      status: { state: "working", app: "claude-code" },
    },
    {
      address: "t2",
      name: "builder",
      labels: placed("fx-review", "web / review"),
      argv: ["codex"],
      state: "live",
      pid: 12,
      turn: 0,
      status: { state: "working", app: "codex" },
    },
    {
      address: "t3",
      name: "tests",
      labels: {},
      argv: ["claude"],
      parent: "t2",
      die_with_parent: true,
      state: "live",
      pid: 13,
      turn: 0,
      status: { state: "working", app: "claude-code" },
    },
    {
      address: "t4",
      name: "preview-server",
      labels: {},
      argv: ["/bin/sh"],
      parent: "t2",
      die_with_parent: false,
      state: "live",
      pid: 14,
    },
    { address: "t5", labels: {}, argv: ["/bin/sh"], state: "live", pid: 15 },
    ...started.map((address) => STARTED[address]),
  ];
  const reader = (
    coreId: string,
    name: string,
    hosted: readonly Record<string, unknown>[],
  ) => {
    const mirror = new CoreMirror();
    const sight = new CoreFirstSight();
    mirror.baseline(1, hosted as never);
    sight.observe(coreId, hosted as never);
    return {
      operations: coreRuntimeReader({
        mirror,
        actionable: true,
        coreName: () => name,
        firstSight: sight,
      }),
    };
  };
  const runtimes = new Map([
    ["core-fixture", reader("c0ffee", "fixture-host", terminals)],
    ...(beta
      ? [
          [
            "core-beta",
            reader("beta0", "beta-host", [
              {
                address: "b1",
                labels: {},
                argv: ["/bin/sh"],
                state: "live",
                pid: 31,
              },
            ]),
          ] as const,
        ]
      : []),
  ]);
  const none = {
    list: () => [],
    has: () => false,
    status: () => {
      throw new Error("none");
    },
    readyRuntimeLease: () => null,
  };
  const core = {
    list: () =>
      [...runtimes.keys()].map((id) => ({
        id,
        label: id === "core-beta" ? "Beta core" : "Fixture core",
        source: "local-profile",
        is_default: false,
        state: "ready" as const,
        generation: 1,
      })),
    has: (id: string) => runtimes.has(id),
    status: (id: string) => core.list().find((status) => status.id === id)!,
    readyRuntimeLease: (id: string) => {
      const runtime = runtimes.get(id);
      return runtime
        ? {
            connectionId: id,
            generation: 1,
            runtime,
            isCurrent: () => true,
          }
        : null;
    },
  };
  const service = new WorldSnapshotService(
    worldRuntimeRegistry(none as never, core as never),
  );
  return service.snapshot();
}

for (const scene of ["launcher", "bin"] as const)
  test.skipIf(!chrome)(
    `core control: the launcher starts in core and the bin names what ends (${scene})`,
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "core-control-"));
      const { assets } = await buildWorldBrowserBundle("CoreControl", dir);
      const snapshot = JSON.stringify(await coreSnapshot());
      let result = Promise.withResolvers<string[]>();
      let requested = Promise.withResolvers<void>();
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/result") {
            result.resolve(await request.json());
            return new Response("ok");
          }
          if (path === "/snapshot") return new Response(snapshot);
          if (path === "/") requested.resolve();
          const asset =
            path === "/"
              ? Bun.file(join(dir, "CoreControl/index.html"))
              : assets.get(path);
          return asset
            ? new Response(asset)
            : new Response("Not found", { status: 404 });
        },
      });
      let child: TestBrowser | undefined;
      let connection: Awaited<ReturnType<typeof connectCapture>> | undefined;
      try {
        const profile = join(dir, "profile"),
          log = join(dir, "chrome.log");
        child = await launchTestBrowser(
          [
            chrome!,
            "--headless=new",
            "--disable-gpu",
            "--remote-debugging-port=0",
            "--window-size=1000,900",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            `${server.url.href}?scene=${scene}`,
          ],
          { stdout: "ignore", stderr: Bun.file(log) },
        );
        await child.start();
        const exited = child.exited.then(async (code) => {
          throw new Error(
            `Chrome exited ${code}: ${await Bun.file(log).text()}`,
          );
        });
        expect(
          await waitForBrowserFixture(
            requested.promise,
            result.promise,
            exited,
            `Core control ${scene}`,
            BROWSER_STARTUP_TIMEOUT_MS,
          ),
        ).toEqual([]);
        // Evidence captures for the PR, only when asked for.
        const captures = Bun.env.HERDR_WORLD_CORE_CAPTURES;
        if (!captures) return;
        await mkdir(captures, { recursive: true });
        connection = await connectCapture(
          await waitForChromePort(child, profile, log),
        );
        for (const theme of ["light", "dark"] as const)
          for (const viewport of VIEWPORTS) {
            await connection.command("Emulation.setDeviceMetricsOverride", {
              width: viewport.width,
              height: viewport.height,
              deviceScaleFactor: 1,
              mobile: viewport.mobile,
            });
            result = Promise.withResolvers<string[]>();
            requested = Promise.withResolvers<void>();
            await connection.command("Page.navigate", {
              url: `${server.url.href}?scene=${scene}`,
            });
            expect(
              await waitForBrowserFixture(
                requested.promise,
                result.promise,
                exited,
                `Core control ${scene}`,
                BROWSER_STARTUP_TIMEOUT_MS,
              ),
            ).toEqual([]);
            await connection.command("Runtime.evaluate", {
              expression: `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`,
              awaitPromise: true,
            });
            const shot = await connection.command("Page.captureScreenshot", {
              format: "png",
            });
            await writeFile(
              join(captures, `${scene}-${viewport.name}-${theme}.png`),
              Buffer.from(shot.data, "base64"),
            );
          }
      } finally {
        connection?.close();
        await stopChrome(child);
        server.stop(true);
        await rm(dir, { recursive: true, force: true });
      }
    },
    120000,
  );

// One click on a core room's + and one on Terminal open the started shell's
// window; one on + and one on Claude open the started agent's; a start in a
// room the Hosts filter hides still opens its window (#1075).
test.skipIf(!chrome).each([1440, 390])(
  "core control: one click starts a core terminal and opens its window at %ipx",
  async (width) => {
    const dir = await mkdtemp(join(tmpdir(), "core-control-start-"));
    const { assets } = await buildWorldBrowserBundle("CoreControl", dir);
    const snapshots = new Map<string, string>();
    for (const started of [
      [],
      ["t9"],
      ["t9", "t10"],
      ["t9", "t10", "t11"],
    ] as const)
      snapshots.set(
        started.join(","),
        JSON.stringify(await coreSnapshot(started, true)),
      );
    const result = Promise.withResolvers<string[]>();
    const requested = Promise.withResolvers<void>();
    const profile = join(dir, "profile"),
      log = join(dir, "chrome.log");
    let child: TestBrowser | undefined;
    let socket: WebSocket | undefined;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/snapshot")
          return new Response(
            snapshots.get(url.searchParams.get("started") ?? ""),
          );
        if (path === "/viewport-ready") {
          const port = await waitForChromePort(child!, profile, log);
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
          const driver = new InputDriver(socket);
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
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "CoreControl/index.html"))
            : assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      },
    });
    try {
      child = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--window-size=1440,1000",
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          `${server.url.href}?scene=start`,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      await child.start();
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          `Core control start at ${width}px`,
          BROWSER_STARTUP_TIMEOUT_MS,
        ),
      ).toEqual([]);
    } finally {
      socket?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  120000,
);

// Cmd+K opens a found herdr-core agent's terminal in the view it was opened
// in, never changing the view (#1356), with Chrome's own mouse and keys:
// Shift+Enter, the row's Open terminal button and, in Code and Spaces, Enter.
test.skipIf(!chrome)(
  "core control: a found core agent's terminal opens in the current view",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-control-find-"));
    const { assets } = await buildWorldBrowserBundle("CoreControl", dir);
    const snapshot = JSON.stringify(await coreSnapshot());
    const result = Promise.withResolvers<string[]>();
    const requested = Promise.withResolvers<void>();
    const profile = join(dir, "profile"),
      log = join(dir, "chrome.log");
    let child: TestBrowser | undefined;
    let socket: WebSocket | undefined;
    let driver: InputDriver | undefined;
    const KEYS: Record<
      string,
      {
        key?: string;
        code: string;
        keyCode: number;
        text?: string;
        modifiers?: number;
      }
    > = {
      k: { code: "KeyK", keyCode: 75, modifiers: 2 },
      Enter: { code: "Enter", keyCode: 13, text: "\r" },
      "Shift+Enter": {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        text: "\r",
        modifiers: 8,
      },
      Escape: { code: "Escape", keyCode: 27 },
    };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const path = url.pathname;
        if (path === "/result") {
          result.resolve(await request.json());
          return new Response("ok");
        }
        if (path === "/snapshot") return new Response(snapshot);
        if (path === "/input") {
          const body = (await request.json()) as {
            click?: { x: number; y: number };
            key?: string;
            text?: string;
          };
          if (body.click) {
            const at = { x: body.click.x, y: body.click.y };
            await driver!.call("Input.dispatchMouseEvent", {
              type: "mouseMoved",
              ...at,
            });
            await driver!.call("Input.dispatchMouseEvent", {
              type: "mousePressed",
              button: "left",
              buttons: 1,
              clickCount: 1,
              ...at,
            });
            await driver!.call("Input.dispatchMouseEvent", {
              type: "mouseReleased",
              button: "left",
              buttons: 0,
              clickCount: 1,
              ...at,
            });
          }
          if (body.key) {
            const key = KEYS[body.key]!;
            const common = {
              key: key.key ?? body.key,
              code: key.code,
              windowsVirtualKeyCode: key.keyCode,
              modifiers: key.modifiers ?? 0,
            };
            await driver!.call("Input.dispatchKeyEvent", {
              type: key.text ? "keyDown" : "rawKeyDown",
              ...common,
              ...(key.text ? { text: key.text } : {}),
            });
            await driver!.call("Input.dispatchKeyEvent", {
              type: "keyUp",
              ...common,
            });
          }
          if (body.text)
            await driver!.call("Input.insertText", { text: body.text });
          return new Response("ok");
        }
        if (path === "/viewport-ready") {
          const port = await waitForChromePort(child!, profile, log);
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
            width: 1440,
            height: 1000,
            deviceScaleFactor: 1,
            mobile: false,
          });
          return new Response("1440");
        }
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "CoreControl/index.html"))
            : assets.get(path);
        if (asset) return new Response(asset);
        if (path.startsWith("/world/") || path.endsWith(".svg")) {
          const file = Bun.file(
            join(import.meta.dir, "../../public", path.slice(1)),
          );
          if (await file.exists()) return new Response(file);
        }
        return new Response("Not found", { status: 404 });
      },
    });
    try {
      child = await launchTestBrowser(
        [
          chrome!,
          "--headless=new",
          "--remote-debugging-port=0",
          "--window-size=1440,1000",
          "--enable-webgl",
          ...(await chromeRenderingFlags(chrome!)),
          "--disable-dev-shm-usage",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${profile}`,
          `${server.url.href}?scene=find`,
        ],
        { stdout: "ignore", stderr: Bun.file(log) },
      );
      await child.start();
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          "Core control find",
          BROWSER_STARTUP_TIMEOUT_MS + 60_000,
        ),
      ).toEqual([]);
    } finally {
      socket?.close();
      await stopChrome(child);
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  },
  180000,
);
