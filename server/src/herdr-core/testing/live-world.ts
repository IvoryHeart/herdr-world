import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConnectionManager,
  type ConnectionRuntime,
} from "../../connections/manager";
import {
  ConnectionProfileService,
  loadConnectionProfileBootstrap,
} from "../../connections/profile-service";
import { ConnectionProfileStore } from "../../connections/profiles";
import { memoryCoreTopologyPort } from "../../storage/core-topology";
import { silentLogger } from "../../utils/logger";
import { createCoreConnections } from "../connections";
import { localCoreTransport } from "../transport";

export async function until(
  predicate: () => boolean | Promise<boolean>,
  ms = 10_000,
) {
  const deadline = Date.now() + ms;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await Bun.sleep(10);
  }
}

/**
 * World's herdr-core connections to a scratch core: the production provider
 * under a throwaway profile store. The caller removes `root` and awaits
 * `stop` after the test.
 */
export async function connectedLive(stateDir: string) {
  const root = mkdtempSync(join(tmpdir(), "hcw-live-"));
  const topology = memoryCoreTopologyPort();
  const core = createCoreConnections({
    logger: silentLogger,
    changed: () => {},
    profiles: () => service,
    transportFor: () => localCoreTransport(stateDir),
    topology: () => topology,
  });
  const store = new ConnectionProfileStore({
    path: join(root, "connections.json"),
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
          label: "Default",
          type: "local",
          control_socket_path: "/synthetic/herdr.sock",
          client_socket_path: "/synthetic/herdr-client.sock",
          auto_connect: false,
        },
        explicitStartupOverride: false,
      }),
      createRuntime: () => () => ({
        identity: {
          id: "startup-default",
          label: "Default",
          source: "startup-config",
        },
        startTransport: async () => {},
        startBackground: () => {},
        stop: async () => {},
      }),
      retry: { baseDelayMs: 20, maxDelayMs: 200, random: () => 0 },
    });
  await service.create({
    id: "core",
    label: "Scratch core",
    type: "local",
    runtime: "herdr-core",
    core_session: "default",
    core_state_dir: stateDir,
    auto_connect: true,
  });
  await until(() => core.manager.status("core").state === "ready");
  const lease = () => core.manager.readyRuntimeLease("core")!;
  const record = (address: string) =>
    lease().runtime.core.mirror.terminal(address);
  return { root, core, topology, lease, record, stop: () => core.stop() };
}
