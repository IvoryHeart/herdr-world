import { productionAdapterDescriptors } from "../adapters/registry";
import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import { CORE_AGENT_CAPABILITIES } from "../herdr-core/host-runtime";
import type { CoreRpcServices } from "../rpc/core";
import { createAgentCommands } from "../world/agent-commands";
import type { WorldSnapshotResult } from "../world/snapshot";

/** Adapt each exact runtime lease once; World owns targeting and publication. */
export function composeAgentCommands(deps: {
  connections(): Pick<
    ConnectionManager<LegacyConnectionRuntime>,
    "has" | "readyRuntimeLease"
  >;
  core(): CoreRpcServices;
  snapshots(): {
    snapshot(params: Record<string, never>): Promise<WorldSnapshotResult>;
  } | null;
}) {
  return createAgentCommands({
    snapshot: async () => {
      const snapshots = deps.snapshots();
      if (!snapshots) throw new Error("World snapshot service is unavailable");
      return snapshots.snapshot({});
    },
    capabilities: (kind) =>
      kind === "herdr-core"
        ? CORE_AGENT_CAPABILITIES
        : productionAdapterDescriptors().find(
            (descriptor) => descriptor.kind === kind,
          )?.agentCommands,
    lease: (id) => {
      const core = deps.core();
      if (core.manager.has(id)) {
        const lease = core.manager.readyRuntimeLease(id);
        return (
          lease && {
            ...lease,
            get operations() {
              return core.hostRuntime(lease).operations;
            },
            version: lease.runtime.core.version,
          }
        );
      }
      const connections = deps.connections();
      if (!connections.has(id)) return null;
      const lease = connections.readyRuntimeLease(id);
      return lease && { ...lease, operations: lease.runtime.operations };
    },
  });
}
