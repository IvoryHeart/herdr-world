import { useSyncExternalStore } from "react";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionLifecycleState,
  type ConnectionStatus,
} from "../api";
import type { Pane, Tab, Workspace } from "../types";

const MAX_CONNECTIONS = 64;
const INVALIDATION_DEBOUNCE_MS = 80;
const FALLBACK_REFRESH_MS = 15_000;

export type WorldRuntimeSnapshot = {
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  agents: Record<string, unknown>[];
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
  truncatedConnections: boolean;
  connections: WorldRuntimeConnection[];
  error: string | null;
};

type WorldRuntimeClient = {
  call(method: string): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const INITIAL_STATE: WorldRuntimeState = {
  status: "idle",
  revision: 0,
  observedAt: 0,
  truncatedConnections: false,
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
    typeof item.truncated_connections !== "boolean" ||
    !Array.isArray(item.connections)
  ) {
    return null;
  }
  const seen = new Set<string>();
  const connections: WorldRuntimeConnection[] = [];
  for (const value of item.connections.slice(0, MAX_CONNECTIONS)) {
    const connection = parseConnection(value);
    if (!connection || seen.has(connection.connectionId)) continue;
    seen.add(connection.connectionId);
    connections.push(connection);
  }
  return {
    revision: item.revision as number,
    observedAt: item.observed_at,
    truncatedConnections: item.truncated_connections,
    connections,
  };
}

export class WorldRuntimeStore {
  private state: WorldRuntimeState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private requestSequence = 0;
  private invalidationTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private unlistenControl: (() => void) | null = null;
  private unlistenStatus: (() => void) | null = null;

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
    });
    this.fallbackTimer = setInterval(
      () => void this.refresh(),
      FALLBACK_REFRESH_MS,
    );
  }

  stop() {
    this.unlistenControl?.();
    this.unlistenStatus?.();
    this.unlistenControl = null;
    this.unlistenStatus = null;
    if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    this.invalidationTimer = null;
    this.fallbackTimer = null;
  }

  async refresh() {
    const requestSequence = ++this.requestSequence;
    if (this.state.status === "idle") {
      this.set({ ...this.state, status: "loading", error: null });
    }
    try {
      const parsed = parseWorldSnapshotResult(
        await this.client.call("world.snapshot"),
      );
      if (!parsed) throw new Error("invalid World snapshot response");
      if (requestSequence !== this.requestSequence) return;
      this.set({ ...parsed, status: "ready", error: null });
    } catch (error) {
      if (requestSequence !== this.requestSequence) return;
      this.set({
        ...this.state,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
