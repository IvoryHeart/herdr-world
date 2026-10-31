import {
  decodeObservationHost,
  MissingObservationBase,
  observationBase,
  sameObservationHost,
} from "./observationBase";
import { useSyncExternalStore } from "react";
import {
  type BridgeControlMsg,
  type BridgeHello,
  bridge,
  type ConnectionLifecycleState,
  type ConnectionStatus,
} from "../api";
import type { Pane, Tab, Workspace } from "../types";
import { prepareWorldBoard } from "./board/boardModel";
import { prepareWorldOffice } from "./herdrOfficeProjection";
import {
  prepareWorldObject,
  yieldWorldTask,
  type WorldObject,
} from "./worldObject";
import { worldObjectForHosts } from "./worldFilters";
import { DEVTOOLS } from "./devtools/flag";
import { countWorldWork } from "./devtools/renderer";

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
  token?: string | null;
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
  serviceIncarnation?: string;
  status: "idle" | "loading" | "ready" | "error";
  revision: number;
  observedAt: number;
  connections: WorldRuntimeConnection[];
  error: string | null;
};

type WorldRuntimeClient = {
  readonly hello?: BridgeHello | null;
  connection?(
    connectionId: string,
    generation: number,
  ): { isCurrent(): boolean };
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
    ...(typeof item.service_incarnation === "string"
      ? { serviceIncarnation: item.service_incarnation }
      : {}),
    revision: item.revision as number,
    observedAt: item.observed_at,
    connections,
  };
}

/** Decode bounded owners in separate tasks; partial admission is never published. */
async function prepareWorldSnapshotResult(
  value: unknown,
  current: () => boolean,
  yieldTask: () => Promise<void> = yieldWorldTask,
  decode = parseConnection,
): Promise<Omit<WorldRuntimeState, "status" | "error"> | null> {
  const item = record(value);
  if (!item || !Array.isArray(item.connections)) return null;
  const header = parseWorldSnapshotResult({ ...item, connections: [] });
  if (!header) return null;
  const seen = new Set<string>();
  for (const value of item.connections) {
    if (!current()) return null;
    const connection = decode(value);
    if (
      decode !== parseConnection &&
      (!connection || seen.has(connection.connectionId))
    )
      throw new Error("invalid World observation catalogue");
    if (connection && !seen.has(connection.connectionId)) {
      seen.add(connection.connectionId);
      header.connections.push(connection);
    }
    await yieldTask();
  }
  return current() ? header : null;
}

export type WorldRuntimeTimers = {
  after(callback: () => void, ms: number): () => void;
  every(callback: () => void, ms: number): () => void;
};
const runtimeTimers: WorldRuntimeTimers = {
  after(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
  every(callback, ms) {
    const timer = setInterval(callback, ms);
    return () => clearInterval(timer);
  },
};

export class WorldRuntimeStore {
  private state: WorldRuntimeState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private connectionHealth = new Map<
    string,
    { generation: number; state: ConnectionLifecycleState }
  >();
  private observationEpoch = 0;
  private refreshInFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private invalidationTimer: (() => void) | null = null;
  private fallbackTimer: (() => void) | null = null;
  private unlistenControl: (() => void) | null = null;
  private unlistenStatus: (() => void) | null = null;
  private priorities: WorldRuntimePriority[] = [];
  private priorityVersion = 0;
  private appliedPriorityVersion = 0;
  private selectedConnectionId: string | null = null;
  private presentedSelection: () => string | null = () => null;
  private observationHello: BridgeHello | null | undefined;
  private baseRefused = false;
  private readonly viewConsumers = new Map<"town" | "board", number>();
  private viewProjection: ((world: WorldObject) => WorldObject) | null = null;
  private viewScopeVersion = 0;
  private visibleViewScope: readonly string[] | null = null;

  /** The same Hosts/watch/appearance projection passed to mounted views. */
  presentViewsFrom(project: (world: WorldObject) => WorldObject) {
    this.viewProjection = project;
    this.viewScopeVersion++;
    return () => {
      if (this.viewProjection !== project) return;
      this.viewProjection = null;
      this.viewScopeVersion++;
    };
  }

  retainView(view: "town" | "board") {
    this.viewConsumers.set(view, (this.viewConsumers.get(view) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.viewConsumers.set(view, (this.viewConsumers.get(view) ?? 1) - 1);
    };
  }

  private visibleConnectionIds: string[] = [];
  private openConnectionIds: string[] = [];

  setVisibleConnectionIds(ids: readonly string[]) {
    const next = [...new Set(ids)].slice(0, 128);
    if (
      this.visibleViewScope !== null &&
      JSON.stringify(next) === JSON.stringify(this.visibleConnectionIds)
    )
      return;
    this.visibleConnectionIds = next;
    this.visibleViewScope = next;
    this.viewScopeVersion++;
    if (this.refreshInFlight) this.refreshQueued = true;
    else if (this.unlistenControl) this.scheduleRefresh();
  }

  constructor(
    private readonly client: WorldRuntimeClient,
    private readonly preparationYield: (
      stage: "decode" | "object" | "office" | "board",
    ) => Promise<void> = yieldWorldTask,
    private readonly timers: WorldRuntimeTimers = runtimeTimers,
  ) {}

  get = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    if (this.unlistenControl) return;
    this.unlistenControl = this.client.onControl((control) => {
      if (control.type === "world_invalidated") {
        this.observeConnectionHealth(control);
        this.scheduleRefresh();
      }
    });
    this.unlistenStatus = this.client.onStatus((status) => {
      if (status === "connected") void this.refresh();
      else if (status === "disconnected") {
        this.invalidateObservation("World service disconnected");
      }
    });
    this.fallbackTimer = this.timers.every(
      () => void this.refresh(),
      FALLBACK_REFRESH_MS,
    );
  }

  stop() {
    this.connectionHealth.clear();
    this.observationEpoch += 1;
    this.refreshQueued = false;
    this.unlistenControl?.();
    this.unlistenStatus?.();
    this.unlistenControl = null;
    this.unlistenStatus = null;
    this.invalidationTimer?.();
    this.fallbackTimer?.();
    this.invalidationTimer = null;
    this.fallbackTimer = null;
  }

  setPriorities(values: readonly WorldRuntimePriority[]): number {
    const seen = new Set<string>();
    const normalized = values.flatMap((value) => {
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
    });
    const next = normalized.slice(0, MAX_PRIORITIES);
    const openConnectionIds = [
      ...new Set(normalized.map((priority) => priority.connectionId)),
    ].slice(0, 128);
    if (
      JSON.stringify(next) === JSON.stringify(this.priorities) &&
      JSON.stringify(openConnectionIds) ===
        JSON.stringify(this.openConnectionIds)
    ) {
      return this.priorityVersion;
    }
    this.openConnectionIds = openConnectionIds;
    this.priorities = next;
    this.priorityVersion += 1;
    if (this.unlistenControl) this.scheduleRefresh();
    return this.priorityVersion;
  }

  /**
   * The focused host as views present it (buildWorldObject's
   * selectedConnectionId). Preparation builds that variant of the World
   * object in the background, so render finds it ready instead of building
   * it synchronously.
   */
  presentSelectionFrom(read: () => string | null) {
    this.presentedSelection = read;
  }

  setSelectedConnectionId(connectionId: string | null) {
    if (this.selectedConnectionId === connectionId) return;
    this.selectedConnectionId = connectionId;
    // Scheduling preferences do not retire otherwise valid catalogue responses.
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
      const params = {
        priority_connection_ids: [
          ...new Set([
            // Open owners outrank the overview. With All hosts, promoting
            // every visible peer would erase that scheduling preference.
            ...(this.openConnectionIds.length
              ? this.openConnectionIds
              : this.visibleConnectionIds),
          ]),
        ].slice(0, 128),
        ...(this.selectedConnectionId
          ? { selected_connection_id: this.selectedConnectionId }
          : {}),
        priorities: priorities.map((priority) => ({
          connection_id: priority.connectionId,
          workspace_id: priority.workspaceId,
          ...(priority.paneId ? { pane_id: priority.paneId } : {}),
          ...(priority.terminalId ? { terminal_id: priority.terminalId } : {}),
        })),
      };
      const parsed = await this.readObservation(params, observationEpoch);
      if (observationEpoch !== this.observationEpoch) return;
      if (!parsed) throw new Error("invalid World snapshot response");
      const current = () => observationEpoch === this.observationEpoch;
      if (
        this.state.status === "ready" &&
        parsed.serviceIncarnation &&
        parsed.serviceIncarnation === this.state.serviceIncarnation &&
        parsed.connections.length === this.state.connections.length &&
        parsed.connections.every(
          (host, i) =>
            host === this.state.connections[i] &&
            this.withConnectionHealth(host) === host &&
            (!host.actionable ||
              !this.client.connection ||
              this.client
                .connection(host.connectionId, host.generation)
                .isCurrent()),
        )
      ) {
        this.appliedPriorityVersion = Math.max(
          this.appliedPriorityVersion,
          priorityVersion,
        );
        return;
      }
      // Preparation yields to input and lifecycle events. Revalidate each
      // captured owner after those boundaries without retiring healthy siblings.
      for (;;) {
        parsed.connections = parsed.connections.map((c) =>
          this.withConnectionHealth(c),
        );
        if (DEVTOOLS) countWorldWork("world.prepare");
        const selected = this.presentedSelection();
        const viewScopeVersion = this.viewScopeVersion;
        const world = await prepareWorldObject(parsed.connections, current, {
          selectedConnectionId: selected,
          yieldTask: () => this.preparationYield("object"),
          // Units, not slices: a construction slice also ends after 8 ms.
          onWorkSlice: DEVTOOLS
            ? (_checkpoint, units) => countWorldWork("world.build-units", units)
            : undefined,
        });
        if (!world) return;
        const viewWorld =
          this.viewConsumers.get("town") || this.viewConsumers.get("board")
            ? this.viewProjection
              ? this.viewProjection(world)
              : worldObjectForHosts(world, this.visibleViewScope)
            : world;
        if (this.viewConsumers.get("town"))
          await prepareWorldOffice(
            viewWorld,
            () =>
              current() &&
              viewScopeVersion === this.viewScopeVersion &&
              !!this.viewConsumers.get("town"),
            () => this.preparationYield("office"),
          );
        else await this.preparationYield("office");
        if (this.viewConsumers.get("board"))
          await prepareWorldBoard(
            viewWorld,
            () =>
              current() &&
              viewScopeVersion === this.viewScopeVersion &&
              !!this.viewConsumers.get("board"),
            () => this.preparationYield("board"),
          );
        else await this.preparationYield("board");
        if (!current()) return;
        let changed = false;
        const connections = parsed.connections.map((connection) => {
          const observed = this.withConnectionHealth(connection);
          if (observed !== connection) {
            changed = true;
            return observed;
          }
          if (
            !connection.actionable ||
            !this.client.connection ||
            this.client
              .connection(connection.connectionId, connection.generation)
              .isCurrent()
          )
            return connection;
          changed = true;
          return {
            ...connection,
            stale: connection.snapshot !== null,
            actionable: false,
          };
        });
        // A host focused during preparation is prepared too (only its
        // host and the index are built again).
        if (
          !changed &&
          this.presentedSelection() === selected &&
          viewScopeVersion === this.viewScopeVersion
        )
          break;
        parsed.connections = connections;
      }
      this.appliedPriorityVersion = Math.max(
        this.appliedPriorityVersion,
        priorityVersion,
      );
      const retained = new Set(parsed.connections.map((c) => c.connectionId));
      for (const id of this.connectionHealth.keys())
        if (!retained.has(id)) this.connectionHealth.delete(id);
      this.set({ ...parsed, status: "ready", error: null });
    } catch (error) {
      if (observationEpoch !== this.observationEpoch) return;
      this.markUnavailable(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async readObservation(
    params: Record<string, unknown>,
    epoch: number,
  ) {
    const hello = this.client.hello;
    if (hello !== this.observationHello) {
      if (
        hello?.service_incarnation &&
        this.state.serviceIncarnation &&
        hello.service_incarnation !== this.state.serviceIncarnation
      )
        this.connectionHealth.clear();
      this.observationHello = hello;
      this.baseRefused = false;
    }
    const incarnation =
      hello?.capabilities.world_observation_v1 === true
        ? hello.service_incarnation
        : undefined;
    let base =
      incarnation && !this.baseRefused
        ? observationBase(this.state, incarnation)
        : undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: unknown;
      try {
        response = await this.client.call("world.snapshot", {
          ...params,
          ...(base ? { base } : {}),
        });
      } catch (error) {
        if (epoch !== this.observationEpoch) return null;
        if (
          !base ||
          attempt !== 0 ||
          !(error instanceof Error) ||
          !/^((invalid|unsupported) World (observation|snapshot) base|invalid World snapshot parameters)$/i.test(
            error.message,
          )
        )
          throw error;
        this.baseRefused = true;
        base = undefined;
        continue;
      }
      if (epoch !== this.observationEpoch) return null;
      if (incarnation && this.client.hello?.service_incarnation !== incarnation)
        throw new Error("World observation service incarnation mismatch");
      if (
        incarnation &&
        Array.isArray(record(response)?.connections) &&
        (record(response)!.connections as unknown[]).length > 64
      )
        throw new Error("invalid World observation catalogue");
      if (incarnation && record(response)?.service_incarnation !== incarnation)
        throw new Error("World observation service incarnation mismatch");
      try {
        return await prepareWorldSnapshotResult(
          response,
          () => epoch === this.observationEpoch,
          () => this.preparationYield("decode"),
          incarnation
            ? (row) =>
                decodeObservationHost(
                  row,
                  this.state,
                  incarnation,
                  base,
                  parseConnection,
                )
            : parseConnection,
        );
      } catch (error) {
        if (!(error instanceof MissingObservationBase) || attempt !== 0)
          throw error;
        base = undefined;
      }
    }
    return null;
  }

  private observeConnectionHealth(control: BridgeControlMsg) {
    const id = control.connection_id;
    const generation = control.connection_generation;
    const state = control.connection_state;
    if (
      typeof id !== "string" ||
      !id ||
      !Number.isSafeInteger(generation) ||
      generation! < 0 ||
      !state ||
      !CONNECTION_STATES.has(state)
    )
      return;
    const previous = this.connectionHealth.get(id);
    const retained = this.state.connections.find((c) => c.connectionId === id);
    if (
      generation! <
      Math.max(previous?.generation ?? -1, retained?.generation ?? -1)
    )
      return;
    this.connectionHealth.set(id, { generation: generation!, state });
    const connections = this.state.connections.map((c) =>
      this.withConnectionHealth(c),
    );
    if (connections.some((c, index) => c !== this.state.connections[index]))
      this.set({ ...this.state, connections });
  }

  private withConnectionHealth(
    connection: WorldRuntimeConnection,
  ): WorldRuntimeConnection {
    const health = this.connectionHealth.get(connection.connectionId);
    if (
      !health ||
      health.generation < connection.generation ||
      (health.generation === connection.generation &&
        health.state === connection.state &&
        (!connection.actionable || health.state === "ready"))
    )
      return connection;
    const next = {
      ...connection,
      generation: health.generation,
      state: health.state,
      stale: connection.snapshot !== null,
      actionable: false,
    };
    const held = this.state.connections.find(
      (c) => c.connectionId === connection.connectionId,
    );
    return held && sameObservationHost(held, next) ? held : next;
  }

  private invalidateObservation(message: string) {
    this.connectionHealth.clear();
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
    this.invalidationTimer = this.timers.after(() => {
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
