import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { createTestCli, type TestCli } from "./test-context";
import { runCli } from "./index";
import { createConnectionsCommand } from "./connections";
import { applyLiveConnectionChange } from "./connections-live";
import { readServiceSetup } from "./service-context";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
  type StartupLocalProfile,
} from "../connections/profile-service";
import {
  ConnectionProfileStore,
  type LocalConnectionProfile,
} from "../connections/profiles";
import { createAuthHandlers } from "../http/auth";
import { worldCliToken } from "../config/session-secret";
import { createWorldCliService } from "../world/world-cli-service";
import { WorldLedger } from "../world/world-ledger";
import { BoardStore } from "../world/board-store";

let cli: TestCli;
let profiles: ConnectionProfileService;
let manager: ConnectionManager;
let coreManager: ConnectionManager;
afterEach(async () => {
  await profiles?.stopSupervision();
  await manager?.stopAll();
  await coreManager?.stopAll();
  cli?.cleanup();
});

const secret = "ab".repeat(32);
const local = (id: string, auto_connect = true): LocalConnectionProfile => ({
  id,
  label: id,
  type: "local",
  auto_connect,
  control_socket_path: `/synthetic/${id}.sock`,
  client_socket_path: `/synthetic/${id}-client.sock`,
});

async function serving(seed = true, explicitStartupOverride = false) {
  cli = createTestCli({
    runtime: {
      env: {
        HERDR_WORLD_URL: "http://wrong.example",
        HERDR_WORLD_TOKEN: "wrong-token",
      },
    },
  });
  cli.writeConfig("PORT=9876\n");
  const root = join(cli.home, ".config", "herdr-world");
  writeFileSync(
    join(root, "session-secret.json"),
    JSON.stringify({
      version: 1,
      secret,
      credentialFingerprint: "cd".repeat(32),
    }),
  );
  const store = new ConnectionProfileStore({
    path: join(root, "connections.json"),
  });
  if (seed)
    await store.save({
      version: 1,
      default_connection_id: "alpha",
      profiles: [local("alpha"), local("beta")],
    });
  const bootstrap = loadConnectionProfileBootstrap({
    store,
    startupProfile: {
      ...local("startup-default"),
      id: "startup-default",
    } as StartupLocalProfile,
    explicitStartupOverride,
  });
  manager = new ConnectionManager(bootstrap.defaultConnectionId);
  coreManager = new ConnectionManager("core-internal-default");
  const runtimes = new Map<string, ConnectionRuntime & { stops: number }>();
  let changes = 0;
  const createRuntime = (profile: { id: string; label: string }) => () => ({
    identity: {
      id: profile.id,
      label: profile.label,
      source: "local-profile" as const,
    },
    async startTransport() {},
    startBackground() {},
    async stop() {},
  });
  profiles = new ConnectionProfileService({
    core: { manager: coreManager, createRuntime },
    manager,
    store,
    bootstrap,
    testProfile: async () => ({ ok: true, version: "0.9.4", protocol: 14 }),
    changed: () => {
      changes += 1;
    },
    createRuntime: (profile) => () => {
      const runtime = {
        identity: {
          id: profile.id,
          label: profile.label,
          source: "local-profile" as const,
        },
        stops: 0,
        async startTransport() {},
        startBackground() {},
        async stop() {
          runtime.stops += 1;
        },
      };
      runtimes.set(profile.id, runtime);
      return runtime;
    },
  });
  await profiles.startConfigured();
  const board = new BoardStore(join(root, "board.json"));
  const ledger = new WorldLedger(join(root, "ledger.json"));
  const service = createWorldCliService({
    connectionProfiles: () => ({ service: profiles, path: store.path }),
    board: () => board,
    ledger: () => ledger,
    now: Date.now,
    connections: () => ({
      list: () => [],
      readyRuntimeLease: () => null,
      defaultId: () => manager.defaultId(),
    }),
    snapshots: () => null,
    townMoveQueues: new Map(),
    publishBoard() {},
    broadcast() {},
  });
  const auth = createAuthHandlers({
    password: "synthetic-password",
    sessionSecret: secret,
  });
  const http = (request: Request, peer = "127.0.0.1") =>
    service.http(
      request,
      { address: peer, port: 51000 },
      9876,
      auth.bearerAuth,
    );
  const fetcher: typeof fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      expect(String(input)).toBe("http://127.0.0.1:9876/api/world/cli");
      return http(new Request(String(input), init));
    },
    { preconnect() {} },
  );
  let beforeAdmission: (() => Promise<unknown>) | undefined;
  const command = (args: string[]) =>
    runCli(["connections", ...args], cli.context, [
      createConnectionsCommand({
        probe: async () => true,
        applyLive: async (context, setup, change) => {
          // Runs after the CLI loaded its disk snapshot, like a concurrent Settings edit.
          const concurrent = beforeAdmission?.();
          await applyLiveConnectionChange(context, setup, change, fetcher);
          await concurrent;
        },
      }),
    ]);
  return {
    store,
    runtimes,
    command,
    http,
    changes: () => changes,
    concurrent: (work: () => Promise<unknown>) => {
      beforeAdmission = work;
    },
  };
}

test("live add, set-default and remove preserve sibling runtimes and concurrent Settings changes", async () => {
  const app = await serving();
  const alpha = manager.readyRuntimeLease("alpha")!;
  const beta = manager.readyRuntimeLease("beta")!;
  app.concurrent(() => profiles.create(local("settings-added", false)));
  expect(
    await app.command([
      "add",
      "gamma",
      "--ssh",
      "gamma.example",
      "--auto-connect",
      "--default",
    ]),
  ).toBe(0);
  expect(manager.status("gamma").state).toBe("ready");
  expect(manager.defaultId()).toBe("gamma");
  expect(
    app.store.load()?.profiles.some((p) => p.id === "settings-added"),
  ).toBe(true);
  expect(alpha.isCurrent()).toBe(true);
  expect(beta.isCurrent()).toBe(true);
  app.concurrent(() =>
    profiles.update("settings-added", {
      ...local("settings-added", false),
      label: "Settings edit",
    }),
  );
  expect(await app.command(["set-default", "alpha"])).toBe(0);
  expect(app.store.load()?.default_connection_id).toBe("alpha");
  expect(manager.defaultId()).toBe("alpha");
  const gamma = manager.readyRuntimeLease("gamma")!;
  app.concurrent(() =>
    profiles.update("settings-added", {
      ...local("settings-added", false),
      label: "Kept during removal",
    }),
  );
  expect(await app.command(["remove", "gamma"])).toBe(0);
  expect(gamma.isCurrent()).toBe(false);
  expect(app.runtimes.get("gamma")?.stops).toBe(1);
  expect(profiles.list().some((p) => p.id === "gamma")).toBe(false);
  expect(app.store.load()?.profiles.map((p) => p.id)).toEqual([
    "alpha",
    "beta",
    "settings-added",
  ]);
  expect(
    app.store.load()?.profiles.find((p) => p.id === "settings-added")?.label,
  ).toBe("Kept during removal");
  expect(alpha.isCurrent()).toBe(true);
  expect(beta.isCurrent()).toBe(true);
  expect(app.runtimes.get("alpha")?.stops).toBe(0);
  expect(cli.commands).toEqual([]);
  expect(app.changes()).toBe(6);
});

test("live add without auto-connect stays disconnected and cannot remove the default", async () => {
  const app = await serving();
  expect(await app.command(["add", "gamma", "--ssh", "gamma.example"])).toBe(0);
  expect(manager.status("gamma").state).toBe("disconnected");
  expect(await app.command(["remove", "alpha"])).toBe(1);
  expect(app.store.load()?.profiles.map((p) => p.id)).toEqual([
    "alpha",
    "beta",
    "gamma",
  ]);
});

test("first live add preserves the CLI Local default", async () => {
  const app = await serving(false);
  expect(await app.command(["add", "gamma", "--ssh", "gamma.example"])).toBe(0);
  expect(manager.defaultId()).toBe("local");
  expect(app.store.load()?.default_connection_id).toBe("local");
  expect(manager.status("gamma").state).toBe("disconnected");
});

test("service refuses an atomic add+default under an explicit startup override", async () => {
  const app = await serving(true, true);
  expect(
    await app.command(["add", "gamma", "--ssh", "gamma.example", "--default"]),
  ).toBe(1);
  expect(app.store.load()?.profiles.map((p) => p.id)).toEqual([
    "alpha",
    "beta",
  ]);
  expect(manager.has("gamma")).toBe(false);
});

test("live admission rejects browser, remote, wrong-token and mismatched-registry requests", async () => {
  const app = await serving();
  const call = (
    headers: Record<string, string> = {},
    peer?: string,
    path = app.store.path,
  ) =>
    app.http(
      new Request("http://127.0.0.1:9876/api/world/cli", {
        method: "POST",
        headers: {
          authorization: `Bearer ${worldCliToken(secret)}`,
          ...headers,
        },
        body: JSON.stringify({
          command: "connections.remove",
          params: { id: "beta", registry_path: path },
        }),
      }),
      peer,
    );
  expect((await call({ origin: "http://127.0.0.1:9876" })).status).toBe(403);
  expect((await call({}, "192.0.2.1")).status).toBe(403);
  expect((await call({ authorization: "Bearer wrong" })).status).toBe(401);
  expect((await call({}, undefined, join(cli.home, "other.json"))).status).toBe(
    503,
  );
  expect(app.store.load()?.profiles).toHaveLength(2);
});

test("live core additions and default changes use their own manager", async () => {
  const app = await serving();
  const alpha = manager.readyRuntimeLease("alpha")!;
  expect(
    await app.command([
      "add",
      "core-test",
      "--core",
      "--auto-connect",
      "--default",
    ]),
  ).toBe(0);
  expect(coreManager.status("core-test").state).toBe("ready");
  expect(manager.defaultId()).toBe("core-test");
  expect(app.store.load()?.default_connection_id).toBe("core-test");
  expect(await app.command(["set-default", "alpha"])).toBe(0);
  expect(await app.command(["remove", "core-test"])).toBe(0);
  expect(coreManager.has("core-test")).toBe(false);
  expect(alpha.isCurrent()).toBe(true);
});

test("a persistence refusal fails live admission without changing memory or disk", async () => {
  const app = await serving();
  const before = app.store.load();
  const save = app.store.save;
  app.store.save = async () => {
    throw new Error("synthetic persistence refusal");
  };
  try {
    expect(await app.command(["add", "gamma", "--ssh", "gamma.example"])).toBe(
      1,
    );
    expect(manager.has("gamma")).toBe(false);
    expect(app.store.load()).toEqual(before);
  } finally {
    app.store.save = save;
  }
});

test("missing service token refuses the live change without a local write", async () => {
  cli = createTestCli();
  cli.writeConfig("");
  await expect(
    applyLiveConnectionChange(
      cli.context,
      readServiceSetup(cli.context.runtime),
      { action: "remove", id: "beta" },
    ),
  ).rejects.toThrow("no World CLI token");
});
