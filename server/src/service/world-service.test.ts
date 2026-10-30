import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readWorldCliToken } from "../config/session-secret";
import { createLegacyConnectionRuntime } from "../connections/runtime";
import { configureServerLogger } from "../utils/logger";
import type { Scheduler } from "./ports";
import { type OpenStorage, openStorage } from "./storage";
import {
  askThroughCli,
  browserSocket,
  holdingHerdr,
  login,
  startTestService,
  type TestService,
} from "./testing/services";
import {
  MARKERS,
  runTwoServices,
  type TwoServicesReport,
} from "./testing/two-services";

beforeAll(() => configureServerLogger("error"));
afterAll(() => configureServerLogger("info"));

/** Where an environment-derived data path would land. */
const DATA_ENVIRONMENT = [
  "HOME",
  "XDG_CONFIG_HOME",
  "APPDATA",
  "USERPROFILE",
  "HERDR_WORLD_DATA_DIR",
  "HERDR_WORLD_SETTINGS_PATH",
  "HERDR_WORLD_CONNECTIONS_PATH",
  "HERDR_WORLD_BOARD_PATH",
  "HERDR_WORLD_LEDGER_PATH",
  "HERDR_WORLD_AGENT_PROFILES_PATH",
  "HERDR_WORLD_WEB_PUSH_PATH",
  "HERDR_WORLD_ASSISTANT_DIR",
] as const;

function decoyEnvironment(decoy: string) {
  return {
    HOME: decoy,
    XDG_CONFIG_HOME: decoy,
    APPDATA: decoy,
    USERPROFILE: decoy,
    HERDR_WORLD_DATA_DIR: join(decoy, "data"),
  };
}

/** Every file below `directory`, relative to it. */
function files(directory: string): string[] {
  return (readdirSync(directory, { recursive: true }) as string[])
    .filter((path) => statSync(join(directory, path)).isFile())
    .sort();
}

function expectOwnFolders(
  top: string,
  decoy: string,
  report: TwoServicesReport,
) {
  expect(files(decoy)).toEqual([]);
  for (const [name, other] of [
    ["first", "second"],
    ["second", "first"],
  ] as const) {
    const root = join(top, name);
    const read = (path: string) => readFileSync(join(root, path), "utf8");
    const marker = MARKERS[name];
    expect(JSON.parse(read("settings.json")).title_suffix).toBe(marker);
    expect(read("boards/board.json")).toContain(`${marker} note`);
    expect(read("boards/world-ledger.json")).toContain(`${marker} question?`);
    expect(read("agent-profiles.json")).toContain(`${marker} profile`);
    expect(read("connections.json")).toContain(marker);
    expect(read("source-secrets.json")).toContain(`${marker}-jira-token`);
    expect(existsSync(join(root, "session-secret.json"))).toBeTrue();
    expect(existsSync(join(root, "web-push.json"))).toBeTrue();
    for (const path of files(root))
      expect(read(path)).not.toContain(MARKERS[other]);
    expect(report.lockedWhileRunning[name]).toBeTrue();
    expect(existsSync(join(root, "instance.lock"))).toBeFalse();
    expect(report.crossCookieStatus[name]).toBe(401);
  }
  expect(report.publicKeys.first).toEqual(expect.any(String));
  expect(report.publicKeys.second).toEqual(expect.any(String));
  expect(report.publicKeys.first).not.toBe(report.publicKeys.second);
}

test("two services in one process write only their own data folders", async () => {
  const top = mkdtempSync(join(tmpdir(), "world-services-"));
  const decoy = join(top, "decoy");
  mkdirSync(decoy);
  // A store that fell back to the environment would write the decoy.
  const saved = DATA_ENVIRONMENT.map((name) => [name, process.env[name]]);
  for (const name of DATA_ENVIRONMENT) delete process.env[name];
  Object.assign(process.env, decoyEnvironment(decoy));
  try {
    expectOwnFolders(top, decoy, await runTwoServices(top));
  } finally {
    for (const [name, value] of saved)
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a process started with a decoy HOME runs two services without writing it", async () => {
  // A process fixes its home folder when it starts, so only a new process can
  // show that nothing reads it for a write.
  const top = mkdtempSync(join(tmpdir(), "world-services-home-"));
  const decoy = join(top, "decoy");
  mkdirSync(decoy);
  try {
    const scenario = JSON.stringify(
      join(import.meta.dir, "testing", "two-services.ts"),
    );
    const logger = JSON.stringify(
      join(import.meta.dir, "..", "utils", "logger.ts"),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { configureServerLogger } from ${logger};
         import { runTwoServices } from ${scenario};
         configureServerLogger("error");
         console.log(JSON.stringify(await runTwoServices(${JSON.stringify(top)})));`,
      ],
      {
        env: {
          ...process.env,
          ...Object.fromEntries(
            DATA_ENVIRONMENT.map((name) => [name, undefined]),
          ),
          ...decoyEnvironment(decoy),
          // Bun's own transpiler cache, which is not World's to keep apart.
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(top, "bun-cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expectOwnFolders(top, decoy, JSON.parse(stdout));
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}, 30_000);

test("a service refuses a folder another live service in this process holds", async () => {
  const root = join(mkdtempSync(join(tmpdir(), "world-service-held-")), "data");
  const first = await startTestService(root);
  try {
    await expect(startTestService(root)).rejects.toThrow(
      `is in use by World (pid ${process.pid}, port 0)`,
    );
    // The refused start changed nothing: the first service still serves.
    expect((await fetch(`${first.base}/api/health`)).status).toBe(401);
  } finally {
    await first.service.stop();
  }
  const again = await startTestService(root);
  await again.service.stop();
  rmSync(join(root, ".."), { recursive: true, force: true });
});

test("a service whose storage cannot open releases its folder", async () => {
  const root = join(
    mkdtempSync(join(tmpdir(), "world-service-failed-")),
    "data",
  );
  await expect(
    startTestService(
      root,
      {},
      {},
      {
        storage: async () => {
          throw new Error("storage refused");
        },
      },
    ),
  ).rejects.toThrow("storage refused");
  expect(existsSync(join(root, "instance.lock"))).toBeFalse();
  const started = await startTestService(root);
  await started.service.stop();
  rmSync(join(root, ".."), { recursive: true, force: true });
});

/** Fires every timer at once, as if each budget had run out. */
const expired: Scheduler = {
  schedule(callback) {
    queueMicrotask(callback);
    return { cancel() {} };
  },
};

/** Never fires: a stop that waits must be released by the work itself. */
const never: Scheduler = { schedule: () => ({ cancel() {} }) };

/** Today's storage, recording what `record` sees as it closes. */
function storageClosing(record: () => unknown): OpenStorage {
  return async (paths, ports) => {
    const storage = await openStorage(paths, ports);
    return {
      ...storage,
      close: async () => {
        await record();
        await storage.close();
      },
    };
  };
}

function scratch(prefix: string) {
  const top = mkdtempSync(join(tmpdir(), prefix));
  return { top, root: join(top, "data") };
}

test("stop refuses new work and closes storage and the folder before the listener", async () => {
  const { top, root } = scratch("world-service-stop-");
  const lock = join(root, "instance.lock");
  const seen: { health: number; locked: boolean }[] = [];
  let base = "";
  const started = await startTestService(
    root,
    {},
    {},
    {
      storage: storageClosing(async () =>
        seen.push({
          health: (await fetch(`${base}/healthz`)).status,
          locked: existsSync(lock),
        }),
      ),
    },
  );
  base = started.base;
  expect((await fetch(`${base}/healthz`)).status).toBe(200);
  // A process about to exit keeps its port bound until it exits.
  await started.service.stop({ keepListener: true });
  expect(seen).toEqual([{ health: 503, locked: true }]);
  expect(existsSync(lock)).toBeFalse();
  expect((await fetch(`${base}/healthz`)).status).toBe(503);
  await Promise.all([started.service.stop(), started.service.stop()]);
  await expect(fetch(`${base}/healthz`)).rejects.toThrow();
  rmSync(top, { recursive: true, force: true });
});

test("stopping during startup keeps Ranger from starting and waits for startup", async () => {
  const { top, root } = scratch("world-service-startup-");
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const events: string[] = [];
  const started = await startTestService(
    root,
    {},
    {},
    {
      adapters: {
        herdr: {
          createRuntime(options) {
            const runtime = createLegacyConnectionRuntime(options);
            return {
              ...runtime,
              startTransport: async () => {
                entered.resolve();
                await gate.promise;
                return runtime.startTransport();
              },
              // Stopping the connection unblocks startup, a turn later.
              stop: async () => {
                await runtime.stop();
                setImmediate(gate.resolve);
              },
            };
          },
        },
      },
      storage: storageClosing(() => events.push("storage closed")),
    },
  );
  void started.connected.then(() => events.push("startup settled"));
  await entered.promise;
  await started.service.stop();
  await started.connected;
  expect(events).toEqual(["startup settled", "storage closed"]);
  // Ranger never started, so it wrote nothing.
  expect(existsSync(join(root, "assistant"))).toBeFalse();
  rmSync(top, { recursive: true, force: true });
});

test("stop fails a Herdr call still waiting before storage closes, whatever the drain budget", async () => {
  const { top, root } = scratch("wsh-");
  const control = join(top, "c.sock");
  const herdr = await holdingHerdr(control, "workspace.list");
  const events: string[] = [];
  const started = await startTestService(
    root,
    { socketPath: control, clientSocketPath: join(top, "r.sock") },
    {},
    {
      // Runtimes without the production probe of the render socket.
      adapters: {
        herdr: {
          createRuntime(options) {
            const runtime = createLegacyConnectionRuntime(options);
            const call = runtime.herdr.call.bind(runtime.herdr);
            runtime.herdr.call = (method, ...rest) => {
              const reply = call(method, ...rest);
              if (method === "workspace.list")
                void reply.then(
                  () => events.push("held call answered"),
                  () => events.push("held call failed"),
                );
              return reply;
            };
            return runtime;
          },
        },
      },
      scheduler: expired,
      storage: storageClosing(() =>
        events.push(
          `storage closed (locked: ${existsSync(join(root, "instance.lock"))})`,
        ),
      ),
    },
  );
  await started.connected;
  const socket = await browserSocket(
    started.base,
    await login(started.base, "world-service-test-password"),
  );
  void socket.call("workspace.list", {}).catch(() => {});
  await herdr.arrived;
  await started.service.stop();
  expect(events).toEqual(["held call failed", "storage closed (locked: true)"]);
  await herdr.released;
  socket.close();
  await herdr.close();
  rmSync(top, { recursive: true, force: true });
});

test("stop ends a wait for an answer before storage closes", async () => {
  const { top, root } = scratch("world-service-wait-");
  let closed = false;
  let armed = false;
  const waiting = Promise.withResolvers<void>();
  const readsAfterClose: string[] = [];
  const started = await startTestService(
    root,
    {},
    {},
    {
      // A frozen clock: only stop can end the wait.
      clock: { now: () => 1_000, monotonic: () => performance.now() },
      scheduler: never,
      storage: async (paths, ports) => {
        const storage = await openStorage(paths, ports);
        return {
          ...storage,
          ledger: () => {
            const ledger = storage.ledger();
            const ask = ledger.ask.bind(ledger);
            ledger.ask = (id) => {
              if (armed) waiting.resolve();
              if (closed) readsAfterClose.push(id);
              return ask(id);
            };
            return ledger;
          },
          close: async () => {
            closed = true;
            await storage.close();
          },
        };
      },
    },
  );
  await started.connected;
  const { result } = (await (
    await askThroughCli(started, "Ship it?")
  ).json()) as { result: { id: string } };
  armed = true;
  const answer = fetch(`${started.base}/api/world/cli`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${readWorldCliToken(started.service.paths.sessionSecret)}`,
    },
    body: JSON.stringify({
      command: "ask get",
      params: { id: result.id, wait_ms: 20_000 },
    }),
  });
  await waiting.promise;
  await started.service.stop();
  expect(readsAfterClose).toEqual([]);
  expect(await (await answer).json()).toMatchObject({
    ok: true,
    result: { id: result.id, question: "Ship it?" },
  });
  rmSync(top, { recursive: true, force: true });
});

test("the service's clock times questions, answers and observations", async () => {
  const { top, root } = scratch("world-service-clock-");
  const at = 1_700_000_000_000;
  const started = await startTestService(
    root,
    {},
    {},
    { clock: { now: () => at, monotonic: () => performance.now() } },
  );
  await started.connected;
  const { result } = (await (
    await askThroughCli(started, "Clocked?")
  ).json()) as { result: { id: string } };
  const cookie = await login(started.base, "world-service-test-password");
  const socket = await browserSocket(started.base, cookie);
  const open = (await socket.call("world.asks.get")) as {
    asks: { id: string; at: number }[];
  };
  expect(open.asks.find((ask) => ask.id === result.id)?.at).toBe(at);
  await socket.call("world.ask.answer", { id: result.id, answer: "Yes" });
  socket.close();
  expect(started.service.storage.ledger().ask(result.id)?.answer?.at).toBe(at);
  const json = { cookie, "content-type": "application/json" };
  // Nothing listens on port 9, so the refresh fails, but it is still timed.
  expect(
    (
      await fetch(`${started.base}/api/world/observability/configuration`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify({ prometheus_url: "http://127.0.0.1:9" }),
      })
    ).status,
  ).toBe(200);
  const snapshot = (await (
    await fetch(`${started.base}/api/world/observability/snapshot`, {
      headers: { cookie },
    })
  ).json()) as { observedAt: number };
  expect(snapshot.observedAt).toBe(at);
  await started.service.stop();
  rmSync(top, { recursive: true, force: true });
});

/**
 * Send a request, let the service admit it, stop the service as the entry
 * point does (the port stays bound), then send the body. Returns the reply.
 */
async function finishAfterStop(
  started: TestService,
  head: string[],
  body: string,
): Promise<string> {
  const socket = net.createConnection({
    host: "127.0.0.1",
    port: Number(new URL(started.base).port),
  });
  socket.setEncoding("utf8");
  let received = "";
  const admitted = Promise.withResolvers<void>();
  const answered = Promise.withResolvers<string>();
  socket.on("data", (chunk) => {
    received += chunk;
    // Bun asks for the body only once the handler is reading it.
    if (received.includes("100 Continue")) admitted.resolve();
  });
  socket.on("close", () => answered.resolve(received));
  try {
    await new Promise<void>((resolve) => socket.once("connect", resolve));
    socket.write(
      [
        ...head,
        `Host: ${new URL(started.base).host}`,
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Expect: 100-continue",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
    await admitted.promise;
    await started.service.stop({ keepListener: true });
    expect(
      existsSync(join(started.service.paths.root, "instance.lock")),
    ).toBeFalse();
    socket.write(body);
    return await answered.promise;
  } finally {
    socket.destroy();
  }
}

test("a request admitted before stop cannot write once storage has closed", async () => {
  const { top, root } = scratch("world-service-held-body-");
  // The drain budget runs out at once, so stop does not wait for the body.
  const started = await startTestService(root, {}, {}, { scheduler: expired });
  try {
    await started.connected;
    const cookie = await login(started.base, "world-service-test-password");
    const response = await finishAfterStop(
      started,
      [
        "PUT /api/instance-settings HTTP/1.1",
        `Cookie: ${cookie}`,
        "X-Herdr-World-Settings: 1",
      ],
      JSON.stringify({ title_suffix: "after-close" }),
    );
    expect(response).toContain("HTTP/1.1 500");
    expect(response).not.toContain("HTTP/1.1 200");
    expect(existsSync(join(root, "settings.json"))).toBeFalse();
  } finally {
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
});

test("a request admitted before stop cannot open a store and set its file aside", async () => {
  const { top, root } = scratch("world-service-held-ledger-");
  const started = await startTestService(root, {}, {}, { scheduler: expired });
  // Unreadable and not yet open: opening the ledger would set it aside.
  const ledger = started.service.paths.ledger;
  mkdirSync(dirname(ledger), { recursive: true });
  writeFileSync(ledger, "{ invalid");
  try {
    await started.connected;
    const response = await finishAfterStop(
      started,
      [
        "POST /api/world/cli HTTP/1.1",
        `Authorization: Bearer ${readWorldCliToken(started.service.paths.sessionSecret)}`,
      ],
      JSON.stringify({ command: "history", params: {} }),
    );
    expect(response).not.toContain("HTTP/1.1 200");
    expect(readFileSync(ledger, "utf8")).toBe("{ invalid");
    expect(readdirSync(dirname(ledger))).toEqual(["world-ledger.json"]);
  } finally {
    await started.service.stop();
    rmSync(top, { recursive: true, force: true });
  }
});
