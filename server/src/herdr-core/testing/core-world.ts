import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
  type ConnectionRuntimeContext,
} from "../../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
  type TuiManagedProfile,
} from "../../connections/profile-service";
import { ConnectionProfileStore } from "../../connections/profiles";
import {
  type CoreTopologyPort,
  memoryCoreTopologyPort,
} from "../../storage/core-topology";
import { silentLogger } from "../../utils/logger";
import type {
  RuntimeRow,
  TerminalRow,
  WorkspaceRow,
} from "../../adapters/runtime-ports";
import { createCoreConnections } from "../connections";
import { localCoreTransport } from "../transport";
import { FakeCore, type FakeCoreOptions } from "./fake-core";

/**
 * One World service's core side against an in-process core: the real
 * profile service, manager, framed client, mirror and read model, with
 * World's layout in memory. Call `dispose` after each test.
 */
export async function coreWorld(
  options: FakeCoreOptions & { topology?: CoreTopologyPort } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "hcw-op-"));
  const fake = new FakeCore({ heartbeatMs: 60_000, ...options });
  const stateDir = join(root, "core", "state");
  const socket = await fake.listen(stateDir, join(root, "core", "run"));
  const topology = options.topology ?? memoryCoreTopologyPort();
  const changes: string[] = [];
  /** When each read-model change was announced. */
  const changedAt: number[] = [];
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    observed: (id) => {
      changes.push(id);
      changedAt.push(Date.now());
    },
    profiles: () => service,
    transportFor: (profile) => localCoreTransport(profile.core_state_dir),
    topology: () => topology,
  });
  const store = new ConnectionProfileStore({
    path: join(root, "data", "connections.json"),
  });
  const service: ConnectionProfileService<ConnectionRuntime, never> =
    new ConnectionProfileService({
      manager: new ConnectionManager<ConnectionRuntime>("startup-default"),
      core: core.support as never,
      store,
      bootstrap: loadConnectionProfileBootstrap({
        store,
        startupProfile: {
          id: "startup-default",
          label: "Herdr",
          type: "local",
          control_socket_path: "/synthetic/herdr.sock",
          client_socket_path: "/synthetic/herdr-client.sock",
          auto_connect: false,
        },
        explicitStartupOverride: false,
      }),
      createRuntime:
        (profile: TuiManagedProfile) =>
        (context: ConnectionRuntimeContext) => ({
          identity: {
            id: profile.id,
            label: profile.label,
            source: "local-profile",
          },
          context,
          startTransport: async () => {},
          startBackground: () => {},
          stop: async () => {},
        }),
      retry: { baseDelayMs: 5, maxDelayMs: 20, random: () => 0 },
    });
  const connect = async (id = "box") => {
    await service.create({
      id,
      label: id,
      type: "local",
      runtime: "herdr-core",
      core_session: "default",
      core_state_dir: stateDir,
      auto_connect: true,
    });
    await until(() => core.manager.status(id).state === "ready");
  };
  const lease = (id = "box") => {
    const value = core.manager.readyRuntimeLease(id);
    if (!value) throw new Error("no ready lease");
    return value;
  };
  /** The read model's rows, as World's snapshot reads them. */
  const rows = async (id = "box") => {
    const ops = lease(id).runtime.operations;
    const [w, t, p] = await Promise.all([
      ops.listWorkspaces(),
      ops.listTabs(),
      ops.listTerminals(),
    ]);
    return {
      workspaces: (w.workspaces ?? []) as WorkspaceRow[],
      tabs: (t.tabs ?? []) as RuntimeRow[],
      panes: (p.panes ?? []) as Array<TerminalRow & { pane_id: string }>,
    };
  };
  return {
    root,
    fake,
    socket,
    stateDir,
    topology,
    core,
    service,
    changes,
    changedAt,
    connect,
    lease,
    rows,
    /** Waits until the mirror has applied everything core has sent. */
    settle: () =>
      until(() => lease().runtime.core.mirror.cursor === fake.currentSeq),
    async dispose() {
      await core.stop();
      fake.kill(socket);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 3_000,
) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(2);
  }
}
