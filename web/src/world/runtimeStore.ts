import { useSyncExternalStore } from "react";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionLifecycleState,
  type ConnectionStatus,
} from "../api";
import type { Pane, Tab, Workspace } from "../types";

const INVALIDATION_DEBOUNCE_MS = 80;
const FALLBACK_REFRESH_MS = 15_000;
const MAX_PRIORITIES = 8;
const MAX_WORKSPACE_COVERAGE = 512;

export type WorldRuntimeStatusCounts = {
  working: number;
  idle: number;
  blocked: number;
  done: number;
  unknown: number;
};

export type WorldRuntimeWorkspaceCoverage = {
  workspaceId: string;
  tabs: number;
  panes: number;
  agentPanes: number;
  status: WorldRuntimeStatusCounts;
};

export type WorldRuntimeCoverage = {
  workspaces: number;
  tabs: number;
  panes: number;
  agentPanes: number;
  status: WorldRuntimeStatusCounts;
  byWorkspace: WorldRuntimeWorkspaceCoverage[];
};

export type WorldRuntimePriority = {
  connectionId: string;
  workspaceId: string;
  paneId?: string;
  terminalId?: string;
};

export type WorldRuntimeSnapshot = {
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  agents: Record<string, unknown>[];
  coverage?: WorldRuntimeCoverage;
  watchAdmission?: WorldRuntimeWatchAdmission;
};

export type WorldRuntimeWatchAdmission = {
  revision: number;
  registered: number;
  missing: number;
  unresolved: number;
  matched: number;
  admitted: number;
  admissionFailed: number;
};

export type WorldRuntimeConnection = {
  connectionId: string;
  label: string;
  source: string;
  isDefault: boolean;
  state: ConnectionLifecycleState;
  generation: number;
  snapshotGeneration: number | null;
  stale: boolean;
  actionable: boolean;
  error?: string;
  snapshotError?: string;
  snapshot: WorldRuntimeSnapshot | null;
};

export type WorldRuntimeState = {
  status: "idle" | "loading" | "ready" | "error";
  revision: number;
  observedAt: number;
  connections: WorldRuntimeConnection[];
  error: string | null;
};

type WorldRuntimeClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const INITIAL_STATE: WorldRuntimeState = {
  status: "idle",
  revision: 0,
  observedAt: 0,
  connections: [],
  error: null,
};

const CONNECTION_STATES = new Set<ConnectionLifecycleState>([
  "disconnected",
  "connecting",
  "ready",
  "reconnecting",
  "stopping",
  "error",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((entry) => record(entry) !== null) as T[])
    : [];
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function parseStatusCounts(value: unknown): WorldRuntimeStatusCounts | null {
  const item = record(value);
  if (!item) return null;
  const working = count(item.working);
  const idle = count(item.idle);
  const blocked = count(item.blocked);
  const done = count(item.done);
  const unknown = count(item.unknown);
  return working === null ||
    idle === null ||
    blocked === null ||
    done === null ||
    unknown === null
    ? null
    : { working, idle, blocked, done, unknown };
}

function parseCoverage(value: unknown): WorldRuntimeCoverage | null {
  const item = record(value);
  if (!item || !Array.isArray(item.by_workspace)) return null;
  const workspaces = count(item.workspaces);
  const tabs = count(item.tabs);
  const panes = count(item.panes);
  const agentPanes = count(item.agent_panes);
  const status = parseStatusCounts(item.status);
  if (
    workspaces === null ||
    tabs === null ||
    panes === null ||
    agentPanes === null ||
    agentPanes > panes ||
    !status ||
    Object.values(status).reduce((total, value) => total + value, 0) !==
      agentPanes ||
    item.by_workspace.length > MAX_WORKSPACE_COVERAGE
  ) {
    return null;
  }
  const seen = new Set<string>();
  const byWorkspace: WorldRuntimeWorkspaceCoverage[] = [];
  for (const value of item.by_workspace) {
    const workspace = record(value);
    if (!workspace || typeof workspace.workspace_id !== "string") return null;
    const workspaceTabs = count(workspace.tabs);
    const workspacePanes = count(workspace.panes);
    const workspaceAgentPanes = count(workspace.agent_panes);
    const workspaceStatus = parseStatusCounts(workspace.status);
    if (
      !workspace.workspace_id ||
      seen.has(workspace.workspace_id) ||
      workspaceTabs === null ||
      workspacePanes === null ||
      workspaceAgentPanes === null ||
      workspaceAgentPanes > workspacePanes ||
      !workspaceStatus ||
      Object.values(workspaceStatus).reduce(
        (total, statusCount) => total + statusCount,
        0,
      ) !== workspaceAgentPanes
    ) {
      return null;
    }
    seen.add(workspace.workspace_id);
    byWorkspace.push({
      workspaceId: workspace.workspace_id,
      tabs: workspaceTabs,
      panes: workspacePanes,
      agentPanes: workspaceAgentPanes,
      status: workspaceStatus,
    });
  }
  return { workspaces, tabs, panes, agentPanes, status, byWorkspace };
}

function parseWatchAdmission(
  value: unknown,
): WorldRuntimeWatchAdmission | null {
  const item = record(value);
  if (!item) return null;
  const revision = count(item.revision);
  const registered = count(item.registered);
  const missing = count(item.missing);
  const unresolved = count(item.unresolved);
  const matched = count(item.matched);
  const admitted = count(item.admitted);
  const admissionFailed = count(item.admission_failed);
  if (
    revision === null ||
    registered === null ||
    missing === null ||
    unresolved === null ||
    matched === null ||
    admitted === null ||
    admissionFailed === null ||
    registered !== missing + unresolved + matched ||
    matched !== admitted + admissionFailed
  )
    return null;
  return {
    revision,
    registered,
    missing,
    unresolved,
    matched,
    admitted,
    admissionFailed,
  };
}

function parseConnection(value: unknown): WorldRuntimeConnection | null {
  const item = record(value);
  if (
    !item ||
    typeof item.connection_id !== "string" ||
    item.connection_id.length === 0 ||
    typeof item.label !== "string" ||
    typeof item.source !== "string" ||
    typeof item.is_default !== "boolean" ||
    typeof item.state !== "string" ||
    !CONNECTION_STATES.has(item.state as ConnectionLifecycleState) ||
    !Number.isSafeInteger(item.generation) ||
    (item.generation as number) < 0 ||
    (item.snapshot_generation !== null &&
      (!Number.isSafeInteger(item.snapshot_generation) ||
        (item.snapshot_generation as number) < 0)) ||
    typeof item.stale !== "boolean" ||
    typeof item.actionable !== "boolean"
  ) {
    return null;
  }
  const rawSnapshot = item.snapshot === null ? null : record(item.snapshot);
  if (item.snapshot !== null && !rawSnapshot) return null;
  const coverage = rawSnapshot ? parseCoverage(rawSnapshot.coverage) : null;
  const watchAdmission =
    rawSnapshot?.watch_admission === undefined
      ? undefined
      : parseWatchAdmission(rawSnapshot.watch_admission);
  if (rawSnapshot && !coverage) return null;
  if (rawSnapshot?.watch_admission !== undefined && !watchAdmission)
    return null;
  const error = record(item.error)?.message;
  return {
    connectionId: item.connection_id,
    label: item.label,
    source: item.source,
    isDefault: item.is_default,
    state: item.state as ConnectionLifecycleState,
    generation: item.generation as number,
    snapshotGeneration: item.snapshot_generation as number | null,
    stale: item.stale,
    actionable: item.actionable,
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof item.snapshot_error === "string"
      ? { snapshotError: item.snapshot_error }
      : {}),
    snapshot: rawSnapshot
      ? {
          workspaces: records<Workspace>(rawSnapshot.workspaces),
          tabs: records<Tab>(rawSnapshot.tabs),
          panes: records<Pane>(rawSnapshot.panes),
          agents: records<Record<string, unknown>>(rawSnapshot.agents),
          coverage: coverage!,
          ...(watchAdmission ? { watchAdmission } : {}),
        }
      : null,
  };
}

export function parseWorldSnapshotResult(
  value: unknown,
): Omit<WorldRuntimeState, "status" | "error"> | null {
  const item = record(value);
  if (
    !item ||
    !Number.isSafeInteger(item.revision) ||
    (item.revision as number) < 0 ||
    typeof item.observed_at !== "number" ||
    !Number.isFinite(item.observed_at) ||
    !Array.isArray(item.connections)
  ) {
    return null;
  }
  const seen = new Set<string>();
  const connections: WorldRuntimeConnection[] = [];
  // The same-origin service has already bounded the managed catalogue. A
  // renderer cap here would discard selection and descendant information.
  for (const value of item.connections) {
    const connection = parseConnection(value);
    if (!connection || seen.has(connection.connectionId)) continue;
    seen.add(connection.connectionId);
    connections.push(connection);
  }
  return {
    revision: item.revision as number,
    observedAt: item.observed_at,
    connections,
  };
}

export class WorldRuntimeStore {
  private state: WorldRuntimeState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private observationEpoch = 0;
  private refreshInFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenControl: (() => void) | null = null;
  private unlistenStatus: (() => void) | null = null;
  private priorities: WorldRuntimePriority[] = [];
  private priorityVersion = 0;
  private appliedPriorityVersion = 0;
  private selectedConnectionId: string | null = null;

  constructor(private readonly client: WorldRuntimeClient) {}

  get = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    if (this.unlistenControl) return;
    this.unlistenControl = this.client.onControl((control) => {
      if (control.type === "world_invalidated") this.scheduleRefresh();
    });
    this.unlistenStatus = this.client.onStatus((status) => {
      if (status === "connected") void this.refresh();
      else if (status === "disconnected") {
        this.invalidateObservation("World service disconnected");
      }
    });
    this.fallbackTimer = setInterval(
      () => void this.refresh(),
      FALLBACK_REFRESH_MS,
    );
  }

  stop() {
    this.observationEpoch += 1;
    this.refreshQueued = false;
    this.unlistenControl?.();
    this.unlistenStatus?.();
    this.unlistenControl = null;
    this.unlistenStatus = null;
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.invalidationTimer = null;
    this.fallbackTimer = null;
  }

  setPriorities(values: readonly WorldRuntimePriority[]): number {
    const seen = new Set<string>();
    const next = values
      .flatMap((value) => {
        if (
          !value.connectionId ||
          !value.workspaceId ||
          (value.paneId !== undefined && !value.paneId) ||
          (value.terminalId !== undefined && !value.terminalId)
        ) {
          return [];
        }
        const normalized: WorldRuntimePriority = {
          connectionId: value.connectionId,
          workspaceId: value.workspaceId,
          ...(value.paneId ? { paneId: value.paneId } : {}),
          ...(value.terminalId ? { terminalId: value.terminalId } : {}),
        };
        const key = JSON.stringify(normalized);
        if (seen.has(key)) return [];
        seen.add(key);
        return [normalized];
      })
      .slice(0, MAX_PRIORITIES);
    if (JSON.stringify(next) === JSON.stringify(this.priorities)) {
      return this.priorityVersion;
    }
    this.priorities = next;
    this.priorityVersion += 1;
    if (this.unlistenControl) this.scheduleRefresh();
    return this.priorityVersion;
  }

  setSelectedConnectionId(connectionId: string | null) {
    if (this.selectedConnectionId === connectionId) return;
    this.selectedConnectionId = connectionId;
    // The previous response was prioritized for another operational host.
    this.observationEpoch += 1;
    if (this.refreshInFlight) this.refreshQueued = true;
    else if (this.unlistenControl) this.scheduleRefresh();
  }

  async ensurePriorities(values: readonly WorldRuntimePriority[]) {
    const requiredVersion = this.setPriorities(values);
    while (this.appliedPriorityVersion < requiredVersion) {
      await this.refresh();
      if (
        this.appliedPriorityVersion < requiredVersion &&
        this.state.status === "error" &&
        !this.refreshInFlight
      ) {
        throw new Error(this.state.error ?? "World snapshot refresh failed");
      }
    }
  }

  async refresh() {
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return this.refreshInFlight;
    }
    const observationEpoch = this.observationEpoch;
    if (this.state.status === "idle") {
      this.set({ ...this.state, status: "loading", error: null });
    }
    const request = this.performRefresh(observationEpoch);
    this.refreshInFlight = request;
    await request;
    if (this.refreshInFlight !== request) return;
    this.refreshInFlight = null;
    if (this.refreshQueued) {
      this.refreshQueued = false;
      void this.refresh();
    }
  }

  private async performRefresh(observationEpoch: number) {
    const priorityVersion = this.priorityVersion;
    const priorities = this.priorities;
    try {
      const parsed = parseWorldSnapshotResult(
        await this.client.call("world.snapshot", {
          ...(this.selectedConnectionId
            ? { selected_connection_id: this.selectedConnectionId }
            : {}),
          priorities: priorities.map((priority) => ({
            connection_id: priority.connectionId,
            workspace_id: priority.workspaceId,
            ...(priority.paneId ? { pane_id: priority.paneId } : {}),
            ...(priority.terminalId
              ? { terminal_id: priority.terminalId }
              : {}),
          })),
        }),
      );
      if (!parsed) throw new Error("invalid World snapshot response");
      if (observationEpoch !== this.observationEpoch) return;
      this.appliedPriorityVersion = Math.max(
        this.appliedPriorityVersion,
        priorityVersion,
      );
      this.set({ ...parsed, status: "ready", error: null });
    } catch (error) {
      if (observationEpoch !== this.observationEpoch) return;
      this.markUnavailable(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private invalidateObservation(message: string) {
    this.observationEpoch += 1;
    this.refreshQueued = false;
    this.markUnavailable(message);
  }

  private markUnavailable(message: string) {
    this.set({
      ...this.state,
      status: "error",
      error: message,
      connections: this.state.connections.map((connection) => ({
        ...connection,
        stale: connection.stale || connection.snapshot !== null,
        actionable: false,
      })),
    });
  }

  private scheduleRefresh() {
    if (this.invalidationTimer) return;
    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = null;
      void this.refresh();
    }, INVALIDATION_DEBOUNCE_MS);
  }

  private set(next: WorldRuntimeState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const worldRuntimeStore = new WorldRuntimeStore(bridge);

export function useWorldRuntime(): WorldRuntimeState {
  return useSyncExternalStore(
    worldRuntimeStore.subscribe,
    worldRuntimeStore.get,
    worldRuntimeStore.get,
  );
}
