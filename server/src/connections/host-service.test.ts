import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDiscoveryError, type DiscoverHost } from "./host-discovery";
import { hostId, migrateHosts } from "./hosts";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "./manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
  type ConnectionRetryOptions,
} from "./profile-service";
import { ConnectionProfileStore, type ConnectionProfile } from "./profiles";

const roots: string[] = [];
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function tui(id: string, destination?: string): ConnectionProfile {
  return destination
    ? {
        id,
        label: id,
        type: "ssh",
        ssh_destination: destination,
        remote_control_socket_path: "",
        remote_client_socket_path: "",
        auto_connect: true,
      }
    : {
        id,
        label: id,
        type: "local",
        control_socket_path: join(tmpdir(), `${id}.sock`),
        client_socket_path: join(tmpdir(), `${id}-client.sock`),
        auto_connect: true,
      };
}
function core(id: string, destination?: string): ConnectionProfile {
  return {
    id,
    label: id,
    type: destination ? "ssh" : "local",
    runtime: "herdr-core",
    ...(destination ? { ssh_destination: destination } : {}),
    core_session: "default",
    core_state_dir: "",
    auto_connect: true,
  };
}

async function fixture(
  initial: ConnectionProfile[],
  discover: DiscoverHost,
  options: { retry?: ConnectionRetryOptions; changed?(): void } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "world-hosts-"));
  roots.push(root);
  const store = new ConnectionProfileStore({
    path: join(root, "private", "connections.json"),
  });
  if (initial.length)
    await store.save({
      version: 2,
      default_connection_id: initial[0]!.id,
      profiles: initial,
    });
  const bootstrap = loadConnectionProfileBootstrap({
    store,
    startupProfile: {
      ...(tui("startup") as Exclude<
        ReturnType<typeof tui>,
        { runtime: string }
      >),
      id: "startup-default",
      type: "local",
      control_socket_path: join(root, "control.sock"),
      client_socket_path: join(root, "client.sock"),
      auto_connect: true,
    },
    explicitStartupOverride: false,
  });
  const manager = new ConnectionManager(bootstrap.defaultConnectionId);
  const coreManager = new ConnectionManager<ConnectionRuntime>("core-default");
  const failures = new Set<string>();
  const starts: string[] = [];
  const contexts = new Map<string, ConnectionRuntimeContext>();
  const runtime =
    (profile: ConnectionProfile) => (context: ConnectionRuntimeContext) => {
      contexts.set(profile.id, context);
      return {
        identity: { id: profile.id, label: profile.label, source: "test" },
        async startTransport() {
          starts.push(profile.id);
          if (failures.has(profile.id))
            throw new Error("synthetic runtime unavailable");
        },
        startBackground() {},
        async stop() {},
      };
    };
  const service = new ConnectionProfileService({
    manager,
    store,
    bootstrap,
    discoverHost: discover,
    createRuntime: runtime,
    core: { manager: coreManager, createRuntime: runtime },
    ...options,
  });
  cleanups.push(async () => {
    service.stopSupervision();
    await manager.stopAll();
    await coreManager.stopAll();
  });
  return { service, store, manager, coreManager, failures, starts, contexts };
}

test("migration groups two runtimes per machine without renaming resource/filter IDs", () => {
  const profiles = [
    tui("local-old"),
    core("core-old"),
    tui("laptop-tui", "sample@laptop.example"),
    core("laptop-core", "sample@laptop.example"),
  ];
  const hosts = migrateHosts(profiles);
  expect(hosts).toHaveLength(2);
  expect(profiles.map((profile) => profile.id)).toEqual([
    "local-old",
    "core-old",
    "laptop-tui",
    "laptop-core",
  ]);
  expect(hostId(tui("alias", "other-alias"))).not.toBe(hostId(profiles[2]!));
});

test("first host persistence keeps the implicit runtime's ID across restart", async () => {
  const { service, store } = await fixture([], async (_host, profiles) =>
    profiles.map((profile) => ({ profile, version: "0.9.5" })),
  );
  await service.hosts.add({ type: "local" });
  expect(store.load()?.profiles[0]?.id).toBe("startup-default");
  expect(store.load()?.hosts?.[0]?.discovered?.[0]?.connection_id).toBe(
    "startup-default",
  );
  expect(service.hosts.list()[0]?.connection_ids).toEqual(["startup-default"]);
});

test("a saved live runtime remains discoverable when its executable is off PATH", async () => {
  const { service, manager } = await fixture(
    [tui("configured-tui")],
    async () => [],
  );
  await service.startConfigured();
  expect(manager.readyRuntimeLease("configured-tui")?.isCurrent()).toBeTrue();
  expect(service.hosts.list()[0]).toMatchObject({
    state: "ready",
    installable_runtimes: [],
  });
});

test("an explicit startup override shadows the migrated ID without overwriting its saved profile", async () => {
  const { service, store } = await fixture([], async (_host, profiles) =>
    profiles.map((profile) => ({ profile, version: null })),
  );
  await service.hosts.add({ type: "local" });
  const original = store.load()!.profiles[0]!;
  const bootstrap = loadConnectionProfileBootstrap({
    store,
    explicitStartupOverride: true,
    startupProfile: {
      id: "startup-default",
      label: "Default",
      type: "local",
      auto_connect: true,
      control_socket_path: join(tmpdir(), "synthetic-override-control.sock"),
      client_socket_path: join(tmpdir(), "synthetic-override-render.sock"),
    },
  });
  expect(
    bootstrap.registrations.filter(
      (registration) => registration.profile.id === "startup-default",
    ),
  ).toHaveLength(1);
  const manager = new ConnectionManager(bootstrap.defaultConnectionId);
  const shadow = new ConnectionProfileService({
    manager,
    store,
    bootstrap,
    discoverHost: async () => [],
    createRuntime: (profile) => () => ({
      identity: { id: profile.id, label: profile.label, source: "test" },
      async startTransport() {},
      startBackground() {},
      async stop() {},
    }),
  });
  cleanups.push(async () => {
    shadow.stopSupervision();
    await manager.stopAll();
  });
  await shadow.hosts.add({
    type: "ssh",
    ssh_destination: "sample@override.example",
  });
  expect(
    store.load()!.profiles.find((profile) => profile.id === "startup-default"),
  ).toEqual(original);
  expect(shadow.list()[0]?.read_only).toBeTrue();
});

test("all found runtimes connect; a failed sibling never captures another runtime's lease", async () => {
  const profiles = [tui("tui-old"), core("core-old")];
  const { service, store, manager, coreManager, failures } = await fixture(
    profiles,
    async () => profiles.map((profile) => ({ profile, version: "1.2.3" })),
  );
  failures.add("core-old");
  await service.startConfigured();
  const [host] = service.hosts.list();
  expect(host).toMatchObject({
    host_id: "host-local",
    state: "degraded",
    connection_ids: ["tui-old", "core-old"],
    installable_runtimes: [],
  });
  expect(manager.readyRuntimeLease("tui-old")?.isCurrent()).toBeTrue();
  expect(coreManager.readyRuntimeLease("core-old")).toBeNull();
  expect(manager.has("core-old")).toBeFalse();
  expect(store.load()?.profiles).toEqual(profiles);
  expect(store.load()?.hosts).toHaveLength(1);
  expect(service.hosts.integrations()[0]!.available_runtimes).toEqual([]);
});

test("a provider cannot reinterpret an existing runtime ID as another runtime kind", async () => {
  let invalid = false;
  const { service, manager, coreManager } = await fixture(
    [tui("tui-old")],
    async (_host, profiles) =>
      invalid
        ? [{ profile: core("tui-old"), version: null, kind: "herdr-core" }]
        : profiles.map((profile) => ({ profile, version: null })),
  );
  await service.startConfigured();
  const original = manager.readyRuntimeLease("tui-old")!;
  invalid = true;
  await expect(service.hosts.connect("host-local")).rejects.toThrow(
    "ownership mismatch",
  );
  expect(original.isCurrent()).toBeTrue();
  expect(coreManager.has("tui-old")).toBeFalse();
});

test("an empty SSH host persists; installation choices disappear as soon as any runtime exists", async () => {
  let installed = false;
  const remote = "sample@empty.example";
  const { service, store } = await fixture([tui("local-old")], async (host) =>
    installed
      ? [{ profile: core(`${host.id}-herdr-core`, remote), version: "2.3.4" }]
      : [],
  );
  const empty = await service.hosts.add({
    type: "ssh",
    ssh_destination: remote,
  });
  expect(empty).toMatchObject({
    state: "empty",
    runtimes: [],
    discovery: "complete",
  });
  expect(empty.installable_runtimes.map((runtime) => runtime.kind)).toEqual([
    "herdr-core",
    "herdr",
  ]);
  expect(
    store.load()?.hosts?.some((host) => host.id === empty.host_id),
  ).toBeTrue();
  installed = true;
  const found = await service.hosts.connect(empty.host_id);
  expect(found).toMatchObject({ state: "ready", installable_runtimes: [] });
  expect(found.runtimes[0]).toMatchObject({
    kind: "herdr-core",
    version: "2.3.4",
    state: "ready",
  });
  expect(
    service.hosts
      .integrations()
      .find((host) => host.host_id === empty.host_id)
      ?.available_runtimes.map((runtime) => runtime.kind),
  ).toEqual(["herdr"]);
});

test("removal retires only its runtime; rediscovery reuses its ID and advances its generation", async () => {
  const profiles = [tui("tui-old"), core("core-old")];
  let present = profiles;
  const { service, manager, coreManager, failures } = await fixture(
    profiles,
    async () => present.map((profile) => ({ profile, version: null })),
  );
  await service.startConfigured();
  const old = coreManager.readyRuntimeLease("core-old")!;
  const sibling = manager.readyRuntimeLease("tui-old")!;
  present = [profiles[0]!];
  await coreManager.stop("core-old");
  failures.add("core-old");
  await service.hosts.connect("host-local");
  expect(old.isCurrent()).toBeFalse();
  expect(sibling.isCurrent()).toBeTrue();
  expect(service.hosts.list()[0]).toMatchObject({ state: "degraded" });
  expect(
    service.hosts
      .list()[0]!
      .runtimes.find((runtime) => runtime.connection_id === "core-old")?.state,
  ).toBe("absent");
  present = profiles;
  failures.delete("core-old");
  await service.hosts.connect("host-local");
  expect(coreManager.readyRuntimeLease("core-old")!.generation).toBeGreaterThan(
    old.generation,
  );
  expect(service.hosts.list()[0]!.connection_ids).toEqual([
    "tui-old",
    "core-old",
  ]);
});

test("SSH discovery failure is unavailable rather than an installation suggestion", async () => {
  const { service } = await fixture([tui("local-old")], async () => {
    throw new Error("SSH access refused");
  });
  const host = await service.hosts.add({
    type: "ssh",
    ssh_destination: "sample@offline.example",
  });
  expect(host).toMatchObject({
    state: "unavailable",
    discovery: "error",
    installable_runtimes: [],
  });
});

test("the explicit empty-host preview fixture never probes SSH and cannot target a real host", async () => {
  let probes = 0;
  const { service } = await fixture([tui("local-old")], async () => {
    probes++;
    throw new Error("must not probe");
  });
  const host = await service.hosts.add({
    type: "ssh",
    ssh_destination: "runtime-fixture.example",
    auto_connect: false,
    preview_fixture: "empty",
  });
  expect(host).toMatchObject({
    state: "empty",
    preview_fixture: "empty",
    auto_connect: false,
  });
  expect((await service.hosts.connect(host.host_id)).state).toBe("empty");
  expect(probes).toBe(0);
  await expect(
    service.hosts.add({
      type: "ssh",
      ssh_destination: "other.example",
      auto_connect: false,
      preview_fixture: "empty",
    }),
  ).rejects.toThrow("preview fixture");
});

test("a partial probe failure still attaches the reachable runtime without inferring removal", async () => {
  const remote = "sample@partial.example";
  const { service } = await fixture([tui("local-old")], async (host) => {
    throw new HostDiscoveryError(
      [{ profile: tui(`${host.id}-herdr`, remote), version: "1.2.3" }],
      ["herdr"],
    );
  });
  const host = await service.hosts.add({
    type: "ssh",
    ssh_destination: remote,
  });
  expect(host).toMatchObject({
    state: "degraded",
    discovery: "error",
    installable_runtimes: [],
  });
  expect(host.runtimes[0]).toMatchObject({ kind: "herdr", state: "ready" });
});

test("runtime settings, SSH options and credentials cannot enter a host record", async () => {
  const { service, store } = await fixture([tui("local-old")], async () => []);
  for (const extra of [
    { runtime: "herdr-core" },
    { password: "synthetic" },
    { ssh_options: ["-o", "ProxyCommand=anything"] },
  ])
    await expect(
      service.hosts.add({
        type: "ssh",
        ssh_destination: "sample@safe.example",
        ...extra,
      }),
    ).rejects.toThrow("runtime settings");
  await expect(
    service.hosts.add({
      type: "ssh",
      ssh_destination: "sample@safe.example;id",
    }),
  ).rejects.toThrow("OpenSSH alias");
  expect(store.load()?.hosts).toBeUndefined();
});

test("a late discovery cannot start runtimes after service shutdown", async () => {
  let release!: (value: Awaited<ReturnType<DiscoverHost>>) => void;
  const pending = new Promise<Awaited<ReturnType<DiscoverHost>>>((resolve) => {
    release = resolve;
  });
  const { service, starts } = await fixture([tui("local-old")], () => pending);
  const connecting = service.hosts.connect("host-local");
  await Promise.resolve();
  const beforeShutdown = [...starts];
  service.stopSupervision();
  release([{ profile: core("late-core"), version: null }]);
  await expect(connecting).rejects.toThrow("stopping");
  expect(starts).toEqual(beforeShutdown);
  expect(service.coreList()).toEqual([]);
});

test("removing a host drains only its runtimes and forgets its discovery records", async () => {
  const remote = "sample@remove.example";
  const profiles = [
    tui("local-old"),
    tui("remote-tui", remote),
    core("remote-core", remote),
  ];
  const { service, store, manager, coreManager } = await fixture(
    profiles,
    async (host, profiles) =>
      profiles
        .filter((profile) => hostId(profile) === host.id)
        .map((profile) => ({ profile, version: null })),
  );
  await service.startConfigured();
  const sibling = manager.readyRuntimeLease("local-old")!;
  const remoteLease = coreManager.readyRuntimeLease("remote-core")!;
  await service.hosts.remove(hostId(profiles[1]!));
  expect(remoteLease.isCurrent()).toBeFalse();
  expect(sibling.isCurrent()).toBeTrue();
  expect(service.hosts.list()).toHaveLength(1);
  expect(store.load()?.profiles.map((profile) => profile.id)).toEqual([
    "local-old",
  ]);
  expect(store.load()?.hosts).toHaveLength(1);
  await expect(service.hosts.remove("host-local")).rejects.toThrow(
    "default connection",
  );
});

test("a successful automatic reconnect rediscovers newly installed sibling runtimes", async () => {
  const jobs: (() => void)[] = [];
  const discovered = Promise.withResolvers<void>();
  let installed = false;
  let rounds = 0;
  const { service, coreManager, contexts } = await fixture(
    [tui("tui-old")],
    async (_host, profiles) => {
      rounds++;
      return [
        ...profiles,
        ...(installed &&
        !profiles.some((profile) => profile.id === "later-core")
          ? [core("later-core")]
          : []),
      ].map((profile) => ({ profile, version: null }));
    },
    {
      retry: {
        schedule: (callback) => {
          jobs.push(callback);
          return { cancel() {} };
        },
      },
      changed: () => {
        if (rounds > 1) discovered.resolve();
      },
    },
  );
  await service.startConfigured();
  installed = true;
  const outage = new Error("ECONNREFUSED: synthetic outage");
  expect(service.willRetry("tui-old", outage)).toBeTrue();
  contexts.get("tui-old")!.reportError(outage, { reconnecting: true });
  service.runtimeFailed("tui-old", outage);
  jobs.shift()!();
  await discovered.promise;
  expect(coreManager.readyRuntimeLease("later-core")?.isCurrent()).toBeTrue();
  expect(service.hosts.list()[0]?.runtimes).toHaveLength(2);
});
