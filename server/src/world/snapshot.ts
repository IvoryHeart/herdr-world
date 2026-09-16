import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionId, ConnectionStatus } from "../connections/types";

const MAX_CONNECTIONS = 64;
const MAX_WORKSPACES = 512;
const MAX_TABS = 2_048;
const MAX_PANES = 4_096;
const MAX_AGENTS = 4_096;
const MAX_CONCURRENT_CONNECTIONS = 4;

type RuntimeWithHerdr = {
  herdr: {
    call(
      method: string,
      params?: Record<string, unknown>,
      timeoutMs?: number,
    ): Promise<unknown>;
  };
};

type RuntimeLease<Runtime> = {
  connectionId: ConnectionId;
  generation: number;
  runtime: Runtime;
  isCurrent(): boolean;
};

export type WorldSnapshot = {
  workspaces: Record<string, unknown>[];
  tabs: Record<string, unknown>[];
  panes: Record<string, unknown>[];
  agents: Record<string, unknown>[];
};

export type WorldConnectionSnapshot = {
  connection_id: string;
  label: string;
  source: string;
  is_default: boolean;
  state: ConnectionStatus["state"];
  generation: number;
  snapshot_generation: number | null;
  stale: boolean;
  actionable: boolean;
  error?: { message: string };
  snapshot_error?: string;
  snapshot: WorldSnapshot | null;
};

export type WorldSnapshotResult = {
  revision: number;
  observed_at: number;
  truncated_connections: boolean;
  connections: WorldConnectionSnapshot[];
};

type Registry<Runtime> = {
  list(): ConnectionStatus[];
  readyRuntimeLease(connectionId: ConnectionId): RuntimeLease<Runtime> | null;
};

type CachedSnapshot = {
  generation: number;
  snapshot: WorldSnapshot;
};

function boundedRecords(value: unknown, key: string, limit: number) {
  const records = (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(records)) return [];
  return records
    .filter(
      (record): record is Record<string, unknown> =>
        !!record && typeof record === "object" && !Array.isArray(record),
    )
    .slice(0, limit);
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await map(values[index]);
      }
    }),
  );
  return results;
}

export class WorldSnapshotService<Runtime extends RuntimeWithHerdr> {
  private revision = 0;
  private readonly cache = new Map<string, CachedSnapshot>();

  constructor(
    private readonly registry: Registry<Runtime>,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): number {
    this.revision += 1;
    return this.revision;
  }

  async snapshot(): Promise<WorldSnapshotResult> {
    const allStatuses = this.registry.list();
    const statuses = allStatuses.slice(0, MAX_CONNECTIONS);
    const connections = await mapConcurrent(
      statuses,
      MAX_CONCURRENT_CONNECTIONS,
      (status) => this.snapshotConnection(status),
    );
    return {
      revision: this.revision,
      observed_at: this.now(),
      truncated_connections: allStatuses.length > statuses.length,
      connections,
    };
  }

  private fallback(
    status: ConnectionStatus,
    snapshotError?: string,
  ): WorldConnectionSnapshot {
    const cached = this.cache.get(status.id);
    return {
      connection_id: status.id,
      label: status.label,
      source: status.source,
      is_default: status.is_default,
      state: status.state,
      generation: status.generation,
      snapshot_generation: cached?.generation ?? null,
      stale: Boolean(cached),
      actionable: false,
      ...(status.error ? { error: status.error } : {}),
      ...(snapshotError ? { snapshot_error: snapshotError } : {}),
      snapshot: cached?.snapshot ?? null,
    };
  }

  private async snapshotConnection(
    status: ConnectionStatus,
  ): Promise<WorldConnectionSnapshot> {
    const lease = this.registry.readyRuntimeLease(status.id);
    if (!lease || lease.generation !== status.generation) {
      return this.fallback(status);
    }
    try {
      const [workspaceResult, tabResult, paneResult, agentResult] =
        await Promise.all([
          lease.runtime.herdr.call("workspace.list", {}, 5_000),
          lease.runtime.herdr.call("tab.list", {}, 5_000),
          lease.runtime.herdr.call("pane.list", {}, 5_000),
          lease.runtime.herdr.call("agent.list", {}, 5_000).catch(() => null),
        ]);
      if (!lease.isCurrent()) {
        return this.fallback(status, "connection changed during snapshot");
      }
      const snapshot: WorldSnapshot = {
        workspaces: boundedRecords(
          workspaceResult,
          "workspaces",
          MAX_WORKSPACES,
        ),
        tabs: boundedRecords(tabResult, "tabs", MAX_TABS),
        panes: boundedRecords(paneResult, "panes", MAX_PANES),
        agents: boundedRecords(agentResult, "agents", MAX_AGENTS),
      };
      this.cache.set(status.id, { generation: lease.generation, snapshot });
      return {
        connection_id: status.id,
        label: status.label,
        source: status.source,
        is_default: status.is_default,
        state: status.state,
        generation: lease.generation,
        snapshot_generation: lease.generation,
        stale: false,
        actionable: true,
        snapshot,
      };
    } catch (error) {
      return this.fallback(status, sanitizeConnectionError(error));
    }
  }
}
