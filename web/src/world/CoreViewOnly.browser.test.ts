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

/** The repository's standard capture viewports. */
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, mobile: true },
  { name: "laptop", width: 1512, height: 982, mobile: false },
  { name: "wide", width: 2560, height: 1440, mobile: false },
  { name: "half", width: 1280, height: 1440, mobile: false },
  { name: "portrait", width: 1440, height: 2560, mobile: false },
] as const;

/** The fixture core's agents, through the production provider's read model. */
async function coreSnapshot() {
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
      turn: 1,
      status: {
        state: "blocked",
        kind: "question",
        app: "claude-code",
        msg: "Which branch should I merge into?",
      },
    },
    {
      address: "t2",
      name: "builder",
      labels: placed("fx-review", "web / review"),
      argv: ["codex"],
      state: "live",
      turn: 0,
      status: { state: "working", app: "codex" },
    },
    {
      address: "t3",
      name: "scout",
      labels: placed("fx-research", "web / research"),
      argv: ["gemini"],
      state: "live",
      turn: 0,
      status: { state: "working", app: "gemini" },
    },
  ];
  const mirror = new CoreMirror();
  const sight = new CoreFirstSight();
  mirror.baseline(1, terminals);
  sight.observe("c0ffee", terminals);
  mirror.apply({
    method: "event",
    params: {
      seq: 2,
      type: "status",
      terminal: "t3",
      data: { status: { state: "idle", app: "gemini" }, reported: true },
    },
  });
  mirror.apply({
    method: "event",
    params: { seq: 3, type: "turn", terminal: "t3", data: { turn: 1 } },
  });
  const runtime = {
    operations: coreRuntimeReader({
      mirror,
      actionable: true,
      coreName: () => "fixture-host",
      firstSight: sight,
    }),
  };
  const none = {
    list: () => [],
    has: () => false,
    status: () => {
      throw new Error("none");
    },
    readyRuntimeLease: () => null,
  };
  const core = {
    list: () => [
      {
        id: "core-fixture",
        label: "Fixture core",
        source: "local-profile",
        is_default: false,
        state: "ready" as const,
        generation: 1,
      },
    ],
    has: (id: string) => id === "core-fixture",
    status: () => core.list()[0]!,
    readyRuntimeLease: () => ({
      connectionId: "core-fixture",
      generation: 1,
      runtime,
      isCurrent: () => true,
    }),
  };
  const service = new WorldSnapshotService(
    worldRuntimeRegistry(none as never, core as never),
  );
  return service.snapshot();
}

test.skipIf(!chrome)(
  "core agents: answers are available while terminal controls remain disabled",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-view-only-"));
    const { assets } = await buildWorldBrowserBundle("CoreViewOnly", dir);
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
            ? Bun.file(join(dir, "CoreViewOnly/index.html"))
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
      const exited = child.exited.then(async (code) => {
        throw new Error(`Chrome exited ${code}: ${await Bun.file(log).text()}`);
      });
      expect(
        await waitForBrowserFixture(
          requested.promise,
          result.promise,
          exited,
          "Core view-only",
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
          await connection.command("Page.navigate", { url: server.url.href });
          expect(
            await waitForBrowserFixture(
              requested.promise,
              result.promise,
              exited,
              "Core view-only",
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
            join(captures, `${viewport.name}-${theme}.png`),
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
