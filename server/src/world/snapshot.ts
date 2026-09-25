import { createHash } from "node:crypto";
import { sanitizeConnectionError } from "../connections/manager";
import type { ConnectionId, ConnectionStatus } from "../connections/types";

const MAX_WORKSPACES = 512;
const MAX_TABS = 2_048;
const MAX_PANES = 4_096;
const MAX_AGENTS = 4_096;
const MAX_CONCURRENT_CONNECTIONS = 4;
const SNAPSHOT_RESPONSE_DEADLINE_MS = 20_000;
const SNAPSHOT_FRESH_MS = 15_000;
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
  rawDigest: string;
  priorityKey: string;
  freshUntil: number;
  dirty: boolean;
};

type RawHostSnapshot = readonly [unknown, unknown, unknown, unknown];
type HostOutcome = { raw: RawHostSnapshot } | { error: string };
type HostWork<Runtime> = {
  status: ConnectionStatus;
  lease: RuntimeLease<Runtime>;
  priorities: readonly WorldSnapshotPriority[];
  invalidationVersion: number;
  selected: boolean;
  state: "queued" | "running";
  late: boolean;
  promise: Promise<HostOutcome>;
  resolve(outcome: HostOutcome): void;
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

function parseSnapshotParameters(value: unknown) {
  const priorities = parsePriorities(value);
  const params = value as Record<string, unknown> | undefined;
  const selected = params?.selected_connection_id;
  if (
    params &&
    Object.hasOwn(params, "selected_connection_id") &&
    !nativeId(selected)
  ) {
    throw new Error("invalid selected World connection");
  }
  return {
    priorities,
    selectedConnectionId: selected as string | undefined,
  };
}

function priorityKey(
  connectionId: string,
  priorities: readonly WorldSnapshotPriority[],
) {
  return JSON.stringify(
    priorities.filter(({ connection_id }) => connection_id === connectionId),
  );
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

export class WorldSnapshotService<Runtime extends RuntimeWithHerdr> {
  private revision = 0;
  private readonly cache = new Map<string, CachedSnapshot>();
  private readonly invalidationVersions = new Map<string, number>();
  private readonly workByConnection = new Map<string, HostWork<Runtime>>();
  private readonly queue: HostWork<Runtime>[] = [];
  private readonly lateInvalidations = new Map<string, number>();
  private active = 0;
  private activeInactive = 0;
  private reserveSelectedSlot = false;
  private lateInvalidationScheduled = false;

  constructor(
    private readonly registry: Registry<Runtime>,
    private readonly now: () => number = Date.now,
    private readonly onLateObservation?: (
      connectionId: string,
      generation: number,
    ) => void,
    private readonly responseDeadlineMs = SNAPSHOT_RESPONSE_DEADLINE_MS,
  ) {}

  invalidate(connectionId?: string): number {
    this.revision += 1;
    if (connectionId) {
      this.invalidationVersions.set(
        connectionId,
        (this.invalidationVersions.get(connectionId) ?? 0) + 1,
      );
      const cached = this.cache.get(connectionId);
      if (cached) cached.dirty = true;
    }
    return this.revision;
  }

  async snapshot(params?: unknown): Promise<WorldSnapshotResult> {
    const { priorities, selectedConnectionId } =
      parseSnapshotParameters(params);
    // The profile store bounds the managed catalogue. Preserve that complete
    // candidate set here so each view can apply its own relevance-aware bound.
    const statuses = this.registry.list();
    if (
      selectedConnectionId &&
      !statuses.some(({ id }) => id === selectedConnectionId)
    ) {
      throw new Error("unknown selected World connection");
    }
    const managedIds = new Set(statuses.map(({ id }) => id));
    for (const cachedId of this.cache.keys()) {
      if (!managedIds.has(cachedId)) this.cache.delete(cachedId);
    }
    for (const invalidatedId of this.invalidationVersions.keys()) {
      if (!managedIds.has(invalidatedId)) {
        this.invalidationVersions.delete(invalidatedId);
      }
    }
    const ordered = selectedConnectionId
      ? [
          ...statuses.filter(({ id }) => id === selectedConnectionId),
          ...statuses.filter(({ id }) => id !== selectedConnectionId),
        ]
      : statuses;
    const work = new Map<string, HostWork<Runtime> | null>();
    const completed = new Map<string, WorldConnectionSnapshot>();
    for (const status of ordered) {
      const fresh = this.freshCachedConnection(status, priorities);
      if (fresh) {
        completed.set(status.id, fresh);
        work.set(status.id, null);
        continue;
      }
      work.set(
        status.id,
        this.workFor(status, priorities, status.id === selectedConnectionId),
      );
    }

    let accepting = true;
    const observations = statuses.map(async (status) => {
      if (completed.has(status.id)) return;
      const hostWork = work.get(status.id);
      const connection = hostWork
        ? await this.observe(status, hostWork, priorities)
        : this.fallback(status);
      if (accepting) completed.set(status.id, connection);
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(observations),
      new Promise<void>((resolve) => {
        deadline = setTimeout(resolve, this.responseDeadlineMs);
      }),
    ]);
    accepting = false;
    if (deadline) clearTimeout(deadline);
    const connections = statuses.map((status) => {
      const connection = completed.get(status.id);
      if (connection) return connection;
      const hostWork = work.get(status.id);
      if (hostWork) hostWork.late = true;
      return this.fallback(status, "observation deadline exceeded");
    });
    return {
      revision: this.revision,
      observed_at: this.now(),
      connections,
    };
  }

  private freshCachedConnection(
    status: ConnectionStatus,
    priorities: readonly WorldSnapshotPriority[],
  ): WorldConnectionSnapshot | null {
    const cached = this.cache.get(status.id);
    if (
      status.state !== "ready" ||
      !cached ||
      cached.generation !== status.generation ||
      cached.dirty ||
      this.now() >= cached.freshUntil ||
      cached.priorityKey !== priorityKey(status.id, priorities)
    ) {
      return null;
    }
    try {
      const lease = this.registry.readyRuntimeLease(status.id);
      if (
        !lease ||
        lease.generation !== status.generation ||
        !lease.isCurrent()
      ) {
        return null;
      }
    } catch {
      return null;
    }
    return {
      connection_id: status.id,
      label: status.label,
      source: status.source,
      is_default: status.is_default,
      state: status.state,
      generation: status.generation,
      snapshot_generation: status.generation,
      stale: false,
      actionable: true,
      snapshot: cached.snapshot,
    };
  }

  private workFor(
    status: ConnectionStatus,
    priorities: readonly WorldSnapshotPriority[],
    selected: boolean,
  ): HostWork<Runtime> | null {
    let lease: RuntimeLease<Runtime> | null;
    try {
      lease = this.registry.readyRuntimeLease(status.id);
    } catch {
      return null;
    }
    if (!lease || lease.generation !== status.generation) return null;
    if (selected) this.reserveSelectedSlot = true;
    const existing = this.workByConnection.get(status.id);
    if (
      existing &&
      existing.lease.generation === lease.generation &&
      existing.lease.runtime === lease.runtime &&
      existing.lease.isCurrent()
    ) {
      if (selected && existing.state === "queued") {
        existing.selected = true;
        this.drain();
      }
      return existing;
    }
    if (existing?.state === "queued") {
      const queuedIndex = this.queue.indexOf(existing);
      if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
      existing.resolve({ error: "connection changed during snapshot" });
    }
    let resolve!: (outcome: HostOutcome) => void;
    const promise = new Promise<HostOutcome>((done) => {
      resolve = done;
    });
    const work: HostWork<Runtime> = {
      status,
      lease,
      priorities,
      invalidationVersion: this.invalidationVersions.get(status.id) ?? 0,
      selected,
      state: "queued",
      late: false,
      promise,
      resolve,
    };
    this.workByConnection.set(status.id, work);
    this.queue.push(work);
    this.drain();
    return work;
  }

  private drain() {
    while (this.active < MAX_CONCURRENT_CONNECTIONS) {
      const selectedIndex = this.queue.findIndex((work) => work.selected);
      const index =
        selectedIndex >= 0
          ? selectedIndex
          : this.activeInactive <
              (this.reserveSelectedSlot
                ? MAX_CONCURRENT_CONNECTIONS - 1
                : MAX_CONCURRENT_CONNECTIONS)
            ? 0
            : -1;
      if (index < 0 || this.queue.length === 0) {
        if (this.active === 0 && this.queue.length === 0) {
          this.reserveSelectedSlot = false;
        }
        return;
      }
      const [work] = this.queue.splice(index, 1);
      if (
        this.workByConnection.get(work.status.id) !== work ||
        !work.lease.isCurrent()
      ) {
        if (this.workByConnection.get(work.status.id) === work) {
          this.workByConnection.delete(work.status.id);
        }
        work.resolve({ error: "connection changed during snapshot" });
        continue;
      }
      work.state = "running";
      this.active += 1;
      if (!work.selected) this.activeInactive += 1;
      void this.runWork(work);
    }
  }

  private async runWork(work: HostWork<Runtime>) {
    let outcome: HostOutcome;
    try {
      const [workspace, tabs, panes, agents] = await Promise.allSettled([
        work.lease.runtime.herdr.call("workspace.list", {}, 5_000),
        work.lease.runtime.herdr.call("tab.list", {}, 5_000),
        work.lease.runtime.herdr.call("pane.list", {}, 5_000),
        work.lease.runtime.herdr.call("agent.list", {}, 5_000),
      ]);
      if (workspace.status === "rejected") throw workspace.reason;
      if (tabs.status === "rejected") throw tabs.reason;
      if (panes.status === "rejected") throw panes.reason;
      const raw: RawHostSnapshot = [
        workspace.value,
        tabs.value,
        panes.value,
        agents.status === "fulfilled" ? agents.value : null,
      ];
      if (!this.current(work)) {
        outcome = { error: "connection changed during snapshot" };
      } else {
        const snapshot = this.projectSnapshot(
          work.status,
          raw,
          work.priorities,
        );
        const rawDigest = createHash("sha256")
          .update(JSON.stringify(raw))
          .digest("hex");
        const previous = this.cache.get(work.status.id);
        const changed =
          previous?.generation !== work.lease.generation ||
          previous.rawDigest !== rawDigest;
        this.cache.set(work.status.id, {
          generation: work.lease.generation,
          snapshot,
          rawDigest,
          priorityKey: priorityKey(work.status.id, work.priorities),
          freshUntil: this.now() + SNAPSHOT_FRESH_MS,
          dirty: this.wasInvalidatedSinceStart(work),
        });
        if (work.late && (changed || this.wasInvalidatedSinceStart(work))) {
          this.queueLateInvalidation(work.status.id, work.lease.generation);
        }
        outcome = { raw };
      }
    } catch (error) {
      outcome = { error: sanitizeConnectionError(error) };
    }
    work.resolve(outcome);
    this.active -= 1;
    if (!work.selected) this.activeInactive -= 1;
    if (this.workByConnection.get(work.status.id) === work) {
      this.workByConnection.delete(work.status.id);
    }
    this.drain();
  }

  private current(work: HostWork<Runtime>) {
    return (
      work.lease.isCurrent() &&
      this.registry
        .list()
        .some(
          ({ id, generation, state }) =>
            id === work.status.id &&
            generation === work.lease.generation &&
            state === "ready",
        )
    );
  }

  private wasInvalidatedSinceStart(work: HostWork<Runtime>) {
    return (
      (this.invalidationVersions.get(work.status.id) ?? 0) !==
      work.invalidationVersion
    );
  }

  private queueLateInvalidation(connectionId: string, generation: number) {
    if (!this.onLateObservation) return;
    this.lateInvalidations.set(connectionId, generation);
    if (this.lateInvalidationScheduled) return;
    this.lateInvalidationScheduled = true;
    queueMicrotask(() => {
      this.lateInvalidationScheduled = false;
      for (const [id, observedGeneration] of this.lateInvalidations) {
        if (
          this.registry
            .list()
            .some(
              ({ id: currentId, generation: currentGeneration, state }) =>
                currentId === id &&
                currentGeneration === observedGeneration &&
                state === "ready",
            )
        ) {
          this.onLateObservation?.(id, observedGeneration);
        }
      }
      this.lateInvalidations.clear();
    });
  }

  private async observe(
    status: ConnectionStatus,
    work: HostWork<Runtime>,
    priorities: readonly WorldSnapshotPriority[],
  ): Promise<WorldConnectionSnapshot> {
    const outcome = await work.promise;
    if ("error" in outcome) return this.fallback(status, outcome.error);
    if (!this.current(work)) {
      return this.fallback(status, "connection changed during snapshot");
    }
    if (this.wasInvalidatedSinceStart(work)) {
      return this.fallback(status, "observation changed during snapshot");
    }
    return {
      connection_id: status.id,
      label: status.label,
      source: status.source,
      is_default: status.is_default,
      state: status.state,
      generation: work.lease.generation,
      snapshot_generation: work.lease.generation,
      stale: false,
      actionable: true,
      snapshot: this.projectSnapshot(status, outcome.raw, priorities),
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

  private projectSnapshot(
    status: ConnectionStatus,
    [workspaceResult, tabResult, paneResult, agentResult]: RawHostSnapshot,
    priorities: readonly WorldSnapshotPriority[],
  ): WorldSnapshot {
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
      coverage: topologyCoverage(allWorkspaces, allTabs, allPanes, workspaces),
    };
    return snapshot;
  }
}
