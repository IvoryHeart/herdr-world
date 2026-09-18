import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionId, ConnectionStatus } from "../connections/types";

const MAX_WORKSPACES = 512;
const MAX_TABS = 2_048;
const MAX_PANES = 4_096;
const MAX_AGENTS = 4_096;
const MAX_CONCURRENT_CONNECTIONS = 4;
const MAX_PRIORITIES = 8;
const MAX_NATIVE_ID_LENGTH = 512;
const MAX_PRESENTED_SPACES = 128;
const MAX_PRESENTED_TABS_PER_SPACE = 8;
const MAX_PRESENTED_LEAVES_PER_SPACE = 16;

type WorldAgentStatus = "working" | "idle" | "blocked" | "done" | "unknown";
type WorldAgentStatusCounts = Record<WorldAgentStatus, number>;

export type WorldSnapshotPriority = {
  connection_id: string;
  workspace_id: string;
  pane_id?: string;
  terminal_id?: string;
};

export type WorldWorkspaceCoverage = {
  workspace_id: string;
  tabs: number;
  panes: number;
  agent_panes: number;
  status: WorldAgentStatusCounts;
};

export type WorldSnapshotCoverage = {
  workspaces: number;
  tabs: number;
  panes: number;
  agent_panes: number;
  status: WorldAgentStatusCounts;
  by_workspace: WorldWorkspaceCoverage[];
};

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
  coverage: WorldSnapshotCoverage;
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

function records(value: unknown, key: string) {
  const records = (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is Record<string, unknown> =>
      !!record && typeof record === "object" && !Array.isArray(record),
  );
}

function boundedRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  priority: (record: Record<string, unknown>) => boolean,
) {
  if (records.length <= limit) return [...records];
  const admitted = new Set(
    [
      ...records.filter(priority),
      ...records.filter((record) => !priority(record)),
    ].slice(0, limit),
  );
  return records.filter((record) => admitted.has(record));
}

function rankedRelevantRecords(
  records: readonly Record<string, unknown>[],
  relevance: (record: Record<string, unknown>) => readonly number[],
) {
  return records
    .map((record, index) => ({ record, index, relevance: relevance(record) }))
    .sort((left, right) => {
      const dimensions = Math.max(
        left.relevance.length,
        right.relevance.length,
      );
      for (let index = 0; index < dimensions; index += 1) {
        const difference =
          (right.relevance[index] ?? 0) - (left.relevance[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}

function boundedRelevantRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  relevance: (record: Record<string, unknown>) => readonly number[],
) {
  if (records.length <= limit) return [...records];
  const admitted = new Set(
    rankedRelevantRecords(records, relevance).slice(0, limit),
  );
  return records.filter((record) => admitted.has(record));
}

function boundedRelevantRecordsWithGroupReservations(
  records: readonly Record<string, unknown>[],
  limit: number,
  relevance: (record: Record<string, unknown>) => readonly number[],
  group: (record: Record<string, unknown>) => string | null,
  reservedGroups: ReadonlySet<string>,
  reservationLimit: number,
) {
  if (records.length <= limit) return [...records];
  const ranked = rankedRelevantRecords(records, relevance);
  const admitted = new Set<Record<string, unknown>>();
  const groupCounts = new Map<string, number>();
  for (const record of ranked) {
    const groupId = group(record);
    if (!groupId || !reservedGroups.has(groupId)) continue;
    const count = groupCounts.get(groupId) ?? 0;
    if (count >= reservationLimit) continue;
    admitted.add(record);
    groupCounts.set(groupId, count + 1);
  }
  for (const record of ranked) {
    if (admitted.size >= limit) break;
    admitted.add(record);
  }
  return records.filter((record) => admitted.has(record));
}

function nativeId(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NATIVE_ID_LENGTH
    ? value
    : null;
}

function parsePriorities(value: unknown): WorldSnapshotPriority[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid World snapshot parameters");
  }
  const priorities = (value as Record<string, unknown>).priorities;
  if (priorities === undefined) return [];
  if (!Array.isArray(priorities) || priorities.length > MAX_PRIORITIES) {
    throw new Error("invalid World snapshot priorities");
  }
  const result: WorldSnapshotPriority[] = [];
  const seen = new Set<string>();
  for (const value of priorities) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid World snapshot priority");
    }
    const item = value as Record<string, unknown>;
    const connectionId = nativeId(item.connection_id);
    const workspaceId = nativeId(item.workspace_id);
    const paneId =
      item.pane_id === undefined ? undefined : nativeId(item.pane_id);
    const terminalId =
      item.terminal_id === undefined ? undefined : nativeId(item.terminal_id);
    if (
      !connectionId ||
      !workspaceId ||
      paneId === null ||
      terminalId === null
    ) {
      throw new Error("invalid World snapshot priority");
    }
    const priority = {
      connection_id: connectionId,
      workspace_id: workspaceId,
      ...(paneId ? { pane_id: paneId } : {}),
      ...(terminalId ? { terminal_id: terminalId } : {}),
    };
    const key = JSON.stringify(priority);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(priority);
  }
  return result;
}

function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function agentStatus(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

function isAgentPane(pane: Record<string, unknown>) {
  return typeof pane.agent === "string" && pane.agent.trim().length > 0;
}

function paneStatusPriority(pane: Record<string, unknown>) {
  const status = agentStatus(pane.agent_status);
  return status === "blocked"
    ? 3
    : status === "working"
      ? 2
      : status === "done"
        ? 1
        : 0;
}

type PaneParentRelevance = {
  focused: boolean;
  attention: boolean;
  agentCount: number;
};

function paneParentRelevance(
  panes: readonly Record<string, unknown>[],
  parentKey: "workspace_id" | "tab_id",
) {
  const result = new Map<string, PaneParentRelevance>();
  for (const pane of panes) {
    const parentId = nativeId(pane[parentKey]);
    if (!parentId) continue;
    const current = result.get(parentId) ?? {
      focused: false,
      attention: false,
      agentCount: 0,
    };
    current.focused ||= pane.focused === true;
    current.attention ||= paneStatusPriority(pane) > 0;
    if (isAgentPane(pane)) current.agentCount += 1;
    result.set(parentId, current);
  }
  return result;
}

function topologyCoverage(
  workspaces: readonly Record<string, unknown>[],
  tabs: readonly Record<string, unknown>[],
  panes: readonly Record<string, unknown>[],
  retainedWorkspaces: readonly Record<string, unknown>[],
): WorldSnapshotCoverage {
  const status = emptyStatusCounts();
  let agentPanes = 0;
  const workspaceCounts = new Map<
    string,
    Omit<WorldWorkspaceCoverage, "workspace_id">
  >();
  for (const workspace of retainedWorkspaces) {
    const workspaceId = nativeId(workspace.workspace_id);
    if (workspaceId && !workspaceCounts.has(workspaceId)) {
      workspaceCounts.set(workspaceId, {
        tabs: 0,
        panes: 0,
        agent_panes: 0,
        status: emptyStatusCounts(),
      });
    }
  }
  for (const tab of tabs) {
    const workspaceId = nativeId(tab.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.tabs += 1;
  }
  for (const pane of panes) {
    const workspaceId = nativeId(pane.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.panes += 1;
    if (!isAgentPane(pane)) continue;
    agentPanes += 1;
    const semanticStatus = agentStatus(pane.agent_status);
    status[semanticStatus] += 1;
    if (counts) {
      counts.agent_panes += 1;
      counts.status[semanticStatus] += 1;
    }
  }
  return {
    workspaces: workspaces.length,
    tabs: tabs.length,
    panes: panes.length,
    agent_panes: agentPanes,
    status,
    by_workspace: [...workspaceCounts].map(([workspace_id, counts]) => ({
      workspace_id,
      ...counts,
    })),
  };
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

  async snapshot(params?: unknown): Promise<WorldSnapshotResult> {
    const priorities = parsePriorities(params);
    // The profile store bounds the managed catalogue. Preserve that complete
    // candidate set here so each view can apply its own relevance-aware bound.
    const statuses = this.registry.list();
    const connections = await mapConcurrent(
      statuses,
      MAX_CONCURRENT_CONNECTIONS,
      (status) => this.snapshotConnection(status, priorities),
    );
    return {
      revision: this.revision,
      observed_at: this.now(),
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
    priorities: readonly WorldSnapshotPriority[],
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
      const connectionPriorities = priorities.filter(
        ({ connection_id }) => connection_id === status.id,
      );
      const allWorkspaces = records(workspaceResult, "workspaces");
      const allTabs = records(tabResult, "tabs");
      const allPanes = records(paneResult, "panes");
      const allAgents = records(agentResult, "agents");
      const explicitPanes = allPanes.filter((pane) =>
        connectionPriorities.some(
          (priority) =>
            (priority.pane_id && priority.pane_id === pane.pane_id) ||
            (priority.terminal_id && priority.terminal_id === pane.terminal_id),
        ),
      );
      const priorityWorkspaceIds = new Set([
        ...connectionPriorities.map(({ workspace_id }) => workspace_id),
        ...explicitPanes.flatMap((pane) => {
          const workspaceId = nativeId(pane.workspace_id);
          return workspaceId ? [workspaceId] : [];
        }),
      ]);
      const workspaceRelevance = paneParentRelevance(allPanes, "workspace_id");
      const workspaceRelevanceTuple = (workspace: Record<string, unknown>) => {
        const workspaceId = nativeId(workspace.workspace_id);
        const relevance = workspaceId
          ? workspaceRelevance.get(workspaceId)
          : undefined;
        return [
          Number(Boolean(workspaceId && priorityWorkspaceIds.has(workspaceId))),
          Number(workspace.focused === true || relevance?.focused === true),
          Number(relevance?.attention === true),
          relevance?.agentCount ?? 0,
        ];
      };
      const workspaces = boundedRelevantRecords(
        allWorkspaces,
        MAX_WORKSPACES,
        workspaceRelevanceTuple,
      );
      const retainedWorkspaceIds = new Set(
        workspaces.flatMap((workspace) => {
          const workspaceId = nativeId(workspace.workspace_id);
          return workspaceId ? [workspaceId] : [];
        }),
      );
      const presentedWorkspaceIds = new Set(
        rankedRelevantRecords(workspaces, workspaceRelevanceTuple)
          .slice(0, MAX_PRESENTED_SPACES)
          .flatMap((workspace) => {
            const workspaceId = nativeId(workspace.workspace_id);
            return workspaceId ? [workspaceId] : [];
          }),
      );
      const panesInRetainedWorkspaces = allPanes.filter((pane) =>
        retainedWorkspaceIds.has(String(pane.workspace_id)),
      );
      const paneIsExplicit = (pane: Record<string, unknown>) =>
        connectionPriorities.some(
          (priority) =>
            (priority.pane_id && priority.pane_id === pane.pane_id) ||
            (priority.terminal_id && priority.terminal_id === pane.terminal_id),
        );
      const paneRelevanceTuple = (pane: Record<string, unknown>) => [
        Number(paneIsExplicit(pane)),
        Number(pane.focused === true),
        paneStatusPriority(pane),
        Number(isAgentPane(pane)),
      ];
      const panes = boundedRelevantRecordsWithGroupReservations(
        panesInRetainedWorkspaces,
        MAX_PANES,
        paneRelevanceTuple,
        (pane) => nativeId(pane.workspace_id),
        presentedWorkspaceIds,
        MAX_PRESENTED_LEAVES_PER_SPACE,
      );
      const priorityTabIds = new Set(
        explicitPanes.flatMap((pane) => {
          const tabId = nativeId(pane.tab_id);
          return tabId ? [tabId] : [];
        }),
      );
      for (const workspace of workspaces) {
        const activeTabId = nativeId(workspace.active_tab_id);
        if (activeTabId) priorityTabIds.add(activeTabId);
      }
      const tabRelevance = paneParentRelevance(allPanes, "tab_id");
      const tabs = boundedRelevantRecordsWithGroupReservations(
        allTabs.filter((tab) =>
          retainedWorkspaceIds.has(String(tab.workspace_id)),
        ),
        MAX_TABS,
        (tab) => {
          const tabId = nativeId(tab.tab_id);
          const relevance = tabId ? tabRelevance.get(tabId) : undefined;
          return [
            Number(Boolean(tabId && priorityTabIds.has(tabId))),
            Number(tab.focused === true || relevance?.focused === true),
            Number(relevance?.attention === true),
            relevance?.agentCount ?? 0,
          ];
        },
        (tab) => nativeId(tab.workspace_id),
        presentedWorkspaceIds,
        MAX_PRESENTED_TABS_PER_SPACE,
      );
      const retainedPaneIds = new Set(
        panes.flatMap((pane) => {
          const paneId = nativeId(pane.pane_id);
          return paneId ? [paneId] : [];
        }),
      );
      const snapshot: WorldSnapshot = {
        workspaces,
        tabs,
        panes,
        agents: boundedRecords(
          allAgents,
          MAX_AGENTS,
          (agent) =>
            retainedPaneIds.has(String(agent.pane_id)) ||
            connectionPriorities.some(
              (priority) =>
                (priority.pane_id && priority.pane_id === agent.pane_id) ||
                (priority.terminal_id &&
                  priority.terminal_id === agent.terminal_id),
            ),
        ),
        coverage: topologyCoverage(
          allWorkspaces,
          allTabs,
          allPanes,
          workspaces,
        ),
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
