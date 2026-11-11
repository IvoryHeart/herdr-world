import type { RuntimeReader } from "../adapters/runtime-ports";
import type {
  ConnectionRuntime,
  ReadyRuntimeLease,
} from "../connections/manager";
import type { ConnectionId, ConnectionStatus } from "../connections/types";

/** Which runtime a World connection observes. Absent means Herdr (TUI). */
export type WorldRuntimeKind = "herdr" | "herdr-core";

export type WorldRuntimeStatus = ConnectionStatus & {
  runtime?: "herdr-core";
};

type Manager<Runtime extends ConnectionRuntime> = {
  list(): ConnectionStatus[];
  has(connectionId: ConnectionId): boolean;
  status(connectionId: ConnectionId): ConnectionStatus;
  readyRuntimeLease(
    connectionId: ConnectionId,
  ): ReadyRuntimeLease<Runtime> | null;
};

type Observed = ConnectionRuntime & { operations: RuntimeReader };

/**
 * Every observed connection for World's aggregate read model: Herdr's (TUI)
 * and herdr-core's, side by side. Each keeps its own manager, generation and
 * identity; a lease is only ever taken from the manager that owns the ID, so
 * a core observation can never be answered by a TUI runtime or the reverse.
 * Only reads go through here: every control still resolves its runtime from
 * its own manager.
 */
export function worldRuntimeRegistry<
  Tui extends Observed,
  Core extends Observed,
>(tui: Manager<Tui>, core: Manager<Core>) {
  const owner = (id: ConnectionId) =>
    tui.has(id) ? tui : core.has(id) ? core : null;
  return {
    list(): WorldRuntimeStatus[] {
      return [
        ...tui.list(),
        ...core
          .list()
          .filter(({ id }) => !tui.has(id))
          .map((status) => ({ ...status, runtime: "herdr-core" as const })),
      ];
    },
    has: (id: ConnectionId) => owner(id) !== null,
    status(id: ConnectionId): ConnectionStatus {
      const manager = owner(id);
      if (!manager) throw new Error(`unknown connection: ${id}`);
      return manager.status(id);
    },
    readyRuntimeLease(id: ConnectionId): ReadyRuntimeLease<Tui | Core> | null {
      const manager = owner(id);
      if (!manager) throw new Error(`unknown connection: ${id}`);
      return manager.readyRuntimeLease(id);
    },
  };
}

/** An observer called only for connections `manager` owns. */
export function ownedBy<Rest extends unknown[]>(
  manager: { has(connectionId: ConnectionId): boolean },
  observe: (connectionId: string, ...rest: Rest) => unknown,
) {
  return (connectionId: string, ...rest: Rest): void => {
    if (manager.has(connectionId)) void observe(connectionId, ...rest);
  };
}
