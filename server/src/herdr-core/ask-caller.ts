import { CoreOperationFence } from "./fence";
import { coreOccupantFingerprint } from "./occupant";
export { coreOccupantFingerprint } from "./occupant";
import type { ReadyRuntimeLease } from "../connections/manager";
import type { CoreConnectionRuntime } from "./runtime";
import type { CoreHost } from "./host";
import type {
  CoreCallerSource,
  CoreCliHost,
  CoreCliOccupant,
} from "../world/world-cli-actor";

type CoreConnections = {
  manager: {
    has(id: string): boolean;
    list(): { id: string }[];
    readyRuntimeLease(
      id: string,
    ): ReadyRuntimeLease<CoreConnectionRuntime> | null;
  };
  host(connectionId: string): Pick<CoreHost, "destination"> | null;
};

function text(value: unknown, max = 100): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

/** One ready core connection, as the agent CLI checks callers against it. */
function cliHost(
  lease: ReadyRuntimeLease<CoreConnectionRuntime>,
  local: boolean,
): CoreCliHost {
  const runtime = lease.runtime;
  return {
    connection_id: lease.connectionId,
    generation: lease.generation,
    local,
    isCurrent: () => lease.isCurrent() && runtime.core.actionable,
    coreId: () => runtime.core.epoch?.coreId ?? null,
    occupant: (address): CoreCliOccupant | null => {
      const coreId = runtime.core.epoch?.coreId;
      const record = runtime.core.terminal(address);
      if (!coreId || !record || record.remote || record.state !== "live")
        return null;
      const fingerprint = coreOccupantFingerprint(coreId, record);
      if (!fingerprint || typeof record.pid !== "number") return null;
      const foreground = record.foreground as
        | { pid?: unknown; name?: unknown }
        | undefined;
      return {
        coreId,
        pid: record.pid,
        foregroundPid:
          typeof foreground?.pid === "number" ? foreground.pid : null,
        ...(typeof foreground?.pid === "number" &&
        typeof foreground.name === "string"
          ? { foreground: { pid: foreground.pid, name: foreground.name } }
          : {}),
        fingerprint,
      };
    },
    delivery: (address, fingerprint, foreground) => {
      const record = runtime.core.terminal(address);
      if (
        !record ||
        coreOccupantFingerprint(runtime.core.epoch?.coreId ?? "", record) !==
          fingerprint
      )
        return null;
      let fence: CoreOperationFence<CoreConnectionRuntime>;
      try {
        fence = CoreOperationFence.admit(lease, address);
      } catch {
        return null;
      }
      if (
        fence.occupant?.foreground?.pid !== foreground.pid ||
        fence.occupant.foreground.name !== foreground.name
      )
        return null;
      return {
        connectionId: lease.connectionId,
        generation: lease.generation,
        isCurrent: () => {
          try {
            fence.check("dispatch");
            return true;
          } catch {
            return false;
          }
        },
        send: (text, beforeSubmit, authorized) =>
          runtime.send(fence, text, beforeSubmit, undefined, authorized),
      };
    },
    describe: async (address) => {
      const [panes, agents] = await Promise.all([
        runtime.operations.listTerminals(),
        runtime.operations.listAgents(),
      ]);
      const pane = (panes.panes ?? []).find((row) => row.pane_id === address);
      if (!pane) return null;
      const agent = (agents.agents ?? []).find(
        (row) => row.pane_id === address,
      );
      const workspaceId = text(pane.workspace_id, 256);
      const harness = text(pane.agent, 64);
      const name = text(agent?.name);
      return {
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(harness ? { agent: harness } : {}),
        ...(name ? { name } : {}),
      };
    },
  };
}

/**
 * The herdr-core connections the agent CLI checks callers against: every
 * ready, current one, marked local when its core runs on this computer
 * (only there can the caller's processes be checked).
 */
export function coreCallerSource(
  core: () => CoreConnections | undefined,
): CoreCallerSource {
  return {
    has: (id) => core()?.manager.has(id) ?? false,
    hosts: () => {
      const services = core();
      if (!services) return [];
      return services.manager.list().flatMap(({ id }) => {
        const lease = services.manager.readyRuntimeLease(id);
        if (!lease?.isCurrent()) return [];
        const host = services.host(id);
        return [cliHost(lease, Boolean(host) && !host!.destination)];
      });
    },
  };
}
