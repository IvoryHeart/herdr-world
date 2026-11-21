import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../server/src/connections/manager";
import { ConnectionProfileService } from "../server/src/connections/profile-service";
import {
  ConnectionProfileStore,
  type LocalConnectionProfile,
  type PersistedConnectionRegistry,
} from "../server/src/connections/profiles";

export const registryWitnesses = [
  "add",
  "remove",
  "default",
  "cliFirst",
  "settingsFirst",
  "queued",
  "late",
  "failedFirst",
  "failedSecond",
  "retryLatest",
] as const;
type Config = {
  kind: number;
  cliFirst: boolean;
  early: boolean;
  failFirst: boolean;
  failSecond: boolean;
};
export function registryConfigurations(): Config[] {
  const result: Config[] = [];
  for (const kind of [0, 1, 2])
    for (const cliFirst of [false, true])
      for (const early of [false, true])
        for (const failFirst of [false, true])
          for (const failSecond of [false, true])
            result.push({ kind, cliFirst, early, failFirst, failSecond });
  return result;
}
function profile(id: string): LocalConnectionProfile {
  return {
    id,
    label: id,
    type: "local",
    control_socket_path: `/tmp/synthetic-${id}.sock`,
    client_socket_path: `/tmp/synthetic-${id}-client.sock`,
    auto_connect: false,
  };
}
type View = { members: string[]; defaultId: string };
const edit = (view: View, cli: boolean, kind: number): View => ({
  members: [
    ...new Set(
      !cli
        ? [...view.members, "settings"]
        : kind === 0
          ? [...view.members, "gamma"]
          : kind === 1
            ? view.members.filter((id) => id !== "beta")
            : view.members,
    ),
  ].sort(),
  defaultId: cli && kind === 2 ? "beta" : view.defaultId,
});

/** Independent schedules and expected composition; no duplicate implementation reducer. */
export async function replayRegistry(
  config: Config,
  Service = ConnectionProfileService,
) {
  const root = mkdtempSync(join(tmpdir(), "world-registry-model-"));
  const store = new ConnectionProfileStore({
    path: join(root, "connections.json"),
  });
  const initial: PersistedConnectionRegistry = {
    version: 2,
    default_connection_id: "alpha",
    profiles: [profile("alpha"), profile("beta")],
  };
  await store.save(initial);
  const manager = new ConnectionManager<ConnectionRuntime>("alpha");
  const service = new Service({
    store,
    manager,
    bootstrap: {
      persistedRegistry: initial,
      defaultConnectionId: "alpha",
      explicitStartupOverride: false,
      registrations: initial.profiles.map((profile) => ({
        profile,
        readOnly: false,
      })),
    },
    createRuntime: (profile) => () => ({
      identity: { id: profile.id, label: profile.label, source: "synthetic" },
      async startTransport() {},
      startBackground() {},
      async stop() {},
    }),
  });
  const save = store.save.bind(store);
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  let saves = 0;
  let active = 0;
  let overlap = false;
  let failed = false;
  const tasks: Promise<boolean>[] = [];
  store.save = async (registry) => {
    saves++;
    active++;
    overlap ||= active > 1;
    const gate = release;
    entered.resolve();
    try {
      await gate.promise;
      if (failed) throw new Error("synthetic persistence refusal");
      await save(registry);
    } finally {
      active--;
    }
  };
  const request = (cli: boolean) => {
    const task = (
      cli
        ? config.kind === 0
          ? service.create(profile("gamma"))
          : config.kind === 1
            ? service.remove("beta")
            : service.setDefault("beta")
        : service.create(profile("settings"))
    ).then(
      () => true,
      () => false,
    );
    tasks.push(task);
    return task;
  };
  const view = (registry: PersistedConnectionRegistry): View => ({
    members: registry.profiles.map((p) => p.id).sort(),
    defaultId: registry.default_connection_id,
  });
  let expected: View = view(initial);
  const check = () => {
    assert.equal(overlap, false, "registry.overlap");
    assert.deepEqual(view(store.load()!), expected, "registry.disk");
    assert.deepEqual(
      {
        members: service
          .list()
          .map((p) => p.id)
          .sort(),
        defaultId: manager.defaultId(),
      },
      expected,
      "registry.catalogue",
    );
  };
  const resetGate = () => {
    entered = Promise.withResolvers<void>();
    release = Promise.withResolvers<void>();
  };
  try {
    const first = request(config.cliFirst);
    await entered.promise;
    let second: Promise<boolean> | undefined;
    if (config.early) {
      second = request(!config.cliFirst);
      // A deterministic microtask fence, not a timer: admission schedules its
      // work in Promise.then; no legitimate second save can enter while held.
      await Promise.resolve();
      assert.equal(saves, 1, "registry.overlap");
    }
    failed = config.failFirst;
    const firstGate = release;
    resetGate();
    firstGate.resolve();
    assert.equal(await first, !config.failFirst, "registry.first.result");
    if (!config.failFirst)
      expected = edit(expected, config.cliFirst, config.kind);
    check();
    second ??= request(!config.cliFirst);
    await entered.promise;
    failed = config.failSecond;
    release.resolve();
    assert.equal(await second, !config.failSecond, "registry.second.result");
    if (!config.failSecond)
      expected = edit(expected, !config.cliFirst, config.kind);
    check();
    for (const [retry, cli] of [
      [config.failFirst, config.cliFirst],
      [config.failSecond, !config.cliFirst],
    ]) {
      if (!retry) continue;
      resetGate();
      failed = false;
      const task = request(cli!);
      await entered.promise;
      release.resolve();
      assert.equal(await task, true, "registry.retry.result");
      expected = edit(expected, cli!, config.kind);
      check();
    }
    return new Set<string>([
      registryWitnesses[config.kind]!,
      config.cliFirst ? "cliFirst" : "settingsFirst",
      config.early ? "queued" : "late",
      ...(config.failFirst ? ["failedFirst", "retryLatest"] : []),
      ...(config.failSecond ? ["failedSecond", "retryLatest"] : []),
    ]);
  } finally {
    release.resolve();
    await Promise.all(tasks);
    await manager.stopAll();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function replayRegistryMatrix(Service = ConnectionProfileService) {
  const counts: Record<string, number> = {};
  for (const config of registryConfigurations())
    for (const name of await replayRegistry(config, Service))
      counts[name] = (counts[name] ?? 0) + 1;
  for (const witness of registryWitnesses)
    assert((counts[witness] ?? 0) > 0, `missing registry witness ${witness}`);
  return { configurations: registryConfigurations().length, witnesses: counts };
}
