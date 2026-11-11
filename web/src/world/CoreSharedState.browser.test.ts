import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectionManager } from "../../../server/src/connections/manager";
import { CoreObservationStore } from "../../../server/src/herdr-core/observations";
import {
  type CoreConnectionRuntime,
  createCoreConnectionRuntime,
} from "../../../server/src/herdr-core/runtime";
import { FakeCore } from "../../../server/src/herdr-core/testing/fake-core";
import { handleCoreSharedRpc } from "../../../server/src/rpc/core-shared";
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

async function until(predicate: () => boolean, ms = 3_000) {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

/** A World service's core side: production provider, RPC and read model. */
async function coreWorld(root: string) {
  const fake = new FakeCore({ heartbeatMs: 60_000, name: "fixture-host" });
  fake.revive();
  const stateDir = join(root, "core", "state");
  const socket = await fake.listen(stateDir, join(root, "core", "run"));
  let invalidate: (id: string) => void = () => {};
  const manager = new ConnectionManager<CoreConnectionRuntime>("");
  const none = {
    list: () => [],
    has: () => false,
    status: () => {
      throw new Error("no Herdr (TUI) connections here");
    },
    readyRuntimeLease: () => null,
  };
  const snapshots = new WorldSnapshotService(
    worldRuntimeRegistry(none as never, manager),
  );
  invalidate = (id) => snapshots.invalidate(id);
  const scout = fake.create({
    name: "scout",
    argv: ["gemini"],
    labels: {
      "herdr.space": "fx-web",
      "herdr.tab": "fx-research",
      where: "web / research",
    },
    foreground: { pid: 9, name: "gemini", argv: ["gemini"], cwd: "/w" },
  });
  fake.report(scout, { state: "working", app: "gemini" });
  manager.register({
    identity: { id: "core-fixture", label: "Fixture core", source: "local" },
    createRuntime: (context) =>
      createCoreConnectionRuntime({
        identity: {
          id: "core-fixture",
          label: "Fixture core",
          source: "local",
        },
        context,
        // The socket core.lock names (endpoint rules have their own tests).
        transport: { open: async () => socket, close: async () => {} },
        observations: new CoreObservationStore(() => {}),
        onFailure: () => {},
        onReadModel: () => invalidate("core-fixture"),
      }),
  });
  await manager.start("core-fixture");
  await until(() => manager.readyRuntimeLease("core-fixture") !== null);
  // The turn ends while World watches and nobody looks.
  fake.report(scout, { state: "done", app: "gemini" });
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const out: { result?: unknown; error?: string } = {};
    await handleCoreSharedRpc({
      id: "1",
      method,
      params,
      sendReply: (message: Record<string, unknown>) => {
        out.result = message.result;
        return true;
      },
      sendError: (_context: string, error: unknown) => {
        out.error = String(error);
      },
      services: { core: { manager } },
    });
    return out;
  };
  return {
    fake,
    scout,
    rpc,
    snapshot: () => snapshots.snapshot(),
    /** Herdr's app on the phone: mark unread is `turn − 1`. */
    unread: () => {
      const turn = Number(fake.terminal(scout)?.turn ?? 0);
      fake.label(scout, { "herdr.seen": String(Math.max(0, turn - 1)) });
    },
    stop: async () => {
      await manager.stopAll();
      fake.kill(socket);
    },
  };
}

test.skipIf(!chrome)(
  "core agents: seen and favourite round-trip with Herdr's apps from Town's and Board's peeks",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "core-shared-"));
    const { assets } = await buildWorldBrowserBundle("CoreSharedState", dir);
    let backend = await coreWorld(dir);
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
        if (path === "/snapshot")
          return Response.json(await backend.snapshot());
        if (path === "/rpc") {
          const { method, params } = await request.json();
          return Response.json(await backend.rpc(method, params));
        }
        if (path === "/app") {
          backend.unread();
          return Response.json({ ok: true });
        }
        if (path === "/") requested.resolve();
        const asset =
          path === "/"
            ? Bun.file(join(dir, "CoreSharedState/index.html"))
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
          "Core shared state",
          BROWSER_STARTUP_TIMEOUT_MS,
        ),
      ).toEqual([]);
      // Core received exactly World's two kinds of label, and nothing else.
      expect(
        backend.fake.calls
          .filter((call) => call.method === "terminal.label")
          .map((call) => call.params),
      ).toEqual([
        { terminal: backend.scout, labels: { "herdr.seen": "1" } },
        { terminal: backend.scout, labels: { "herdr.pinned": "1" } },
        { terminal: backend.scout, labels: { "herdr.seen": "1" } },
      ]);
      // Evidence captures for the PR, only when asked for.
      const captures = Bun.env.HERDR_WORLD_CORE_CAPTURES;
      if (!captures) return;
      await mkdir(captures, { recursive: true });
      connection = await connectCapture(
        await waitForChromePort(child, profile, log),
      );
      for (const theme of ["light", "dark"] as const)
        for (const viewport of VIEWPORTS) {
          await backend.stop();
          backend = await coreWorld(join(dir, `${theme}-${viewport.name}`));
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
              "Core shared state",
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
            join(captures, `shared-${viewport.name}-${theme}.png`),
            Buffer.from(shot.data, "base64"),
          );
        }
    } finally {
      connection?.close();
      await stopChrome(child);
      server.stop(true);
      await backend.stop();
      await rm(dir, { recursive: true, force: true });
    }
  },
  180000,
);
