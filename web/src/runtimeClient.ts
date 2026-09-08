import type { BridgeRuntime, CapabilityState } from "./bridge";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type {
  AgentStatus,
  LayoutPane,
  LayoutRect,
  LayoutSnapshot,
  PaneInfo,
  Snapshot,
  TabInfo,
  WorkspaceInfo,
} from "./types";

export type RuntimeLoadState = "loading" | "ready" | "error";

export type HostConnectionState =
  | "disabled"
  | "connecting"
  | "compatible"
  | "degraded"
  | "incompatible"
  | "offline";

export type RuntimeCacheEntry<Snapshot> = {
  profileId: string;
  connectionKey: string;
  generationKey: string;
  snapshot: Snapshot | null;
  stale: boolean;
  admittedAt: number | null;
};

/**
 * Browser-owned cache metadata only. Snapshots are replaced by admitted Herdr
 * state and mutations are never written here as authoritative topology.
 */
export class RuntimeCache<Snapshot> {
  readonly #entries = new Map<string, RuntimeCacheEntry<Snapshot>>();

  configure(profileId: string, connectionKey: string, generationKey = connectionKey) {
    const current = this.#entries.get(profileId);
    if (current?.connectionKey === connectionKey && current.generationKey === generationKey) {
      return current;
    }
    const next: RuntimeCacheEntry<Snapshot> = {
      profileId,
      connectionKey,
      generationKey,
      snapshot: current?.connectionKey === connectionKey ? current.snapshot : null,
      stale: current?.connectionKey === connectionKey && current.snapshot !== null,
      admittedAt: current?.connectionKey === connectionKey ? current.admittedAt : null,
    };
    this.#entries.set(profileId, next);
    return next;
  }

  admitSnapshot(
    profileId: string,
    generationKey: string,
    snapshot: Snapshot,
    admittedAt = Date.now(),
  ) {
    const current = this.#entries.get(profileId);
    if (!current || current.generationKey !== generationKey) {
      return false;
    }
    this.#entries.set(profileId, {
      ...current,
      snapshot,
      stale: false,
      admittedAt,
    });
    return true;
  }

  markUnavailable(profileId: string, generationKey: string) {
    const current = this.#entries.get(profileId);
    if (!current || current.generationKey !== generationKey) {
      return false;
    }
    this.#entries.set(profileId, { ...current, stale: current.snapshot !== null });
    return true;
  }

  get(profileId: string) {
    return this.#entries.get(profileId) ?? null;
  }

  remove(profileId: string) {
    this.#entries.delete(profileId);
  }
}

export function hostConnectionState(
  capabilityState: CapabilityState,
  loadState: RuntimeLoadState,
  hasSnapshot: boolean,
  surfaceSupported = true,
): HostConnectionState {
  if (capabilityState === "incompatible") {
    return "incompatible";
  }
  if (capabilityState === "ready" && !surfaceSupported) {
    return "incompatible";
  }
  if (capabilityState === "offline") {
    return "offline";
  }
  if (capabilityState === "error") {
    return hasSnapshot ? "degraded" : "offline";
  }
  if (capabilityState !== "ready" || loadState === "loading") {
    return "connecting";
  }
  if (loadState === "error") {
    return "offline";
  }
  return "compatible";
}

export function runtimeControlsEnabled(runtime: BridgeRuntime | null, loadState: RuntimeLoadState) {
  return Boolean(
    runtime &&
      runtime.canConnect &&
      runtime.capabilityState === "ready" &&
      loadState === "ready",
  );
}

export type RuntimeAdmissionState = {
  connectionKey: string;
  snapshot: unknown | null;
  loadState: RuntimeLoadState;
};

export function runtimeAdmissionReady(
  runtime: BridgeRuntime | null,
  state: RuntimeAdmissionState | null | undefined,
  requiredCapabilities: readonly string[] = [],
) {
  if (
    !runtime ||
    !state ||
    state.connectionKey !== runtime.generationKey ||
    state.snapshot === null ||
    !runtimeControlsEnabled(runtime, state.loadState)
  ) {
    return false;
  }
  const features = new Set(runtime.capabilities?.features ?? []);
  return requiredCapabilities.every((capability) => features.has(capability));
}

export function runtimeFeatureReady(
  runtime: BridgeRuntime | null,
  state: RuntimeAdmissionState | null | undefined,
  feature: string,
  requiredCapabilities: readonly string[] = [],
) {
  return (
    runtimeAdmissionReady(runtime, state, requiredCapabilities) &&
    runtime?.capabilities?.features?.includes(feature) === true
  );
}

export function runtimeCommandReady(
  runtime: BridgeRuntime | null,
  state: RuntimeAdmissionState | null | undefined,
  command: string,
  requiredCapabilities: readonly string[] = [],
) {
  return (
    runtimeAdmissionReady(runtime, state, requiredCapabilities) &&
    runtime?.capabilities?.commands?.includes(command) === true
  );
}

export async function fetchRuntimeSnapshot(
  httpUrl: (path: string, query?: URLSearchParams) => string,
): Promise<Snapshot> {
  const response = await fetchWithTimeout(httpUrl("/api/snapshot"));
  if (!response.ok) {
    throw new Error(`snapshot failed: ${response.status}`);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new SnapshotContractError();
  }
  return parseSnapshot(value);
}

const MAX_SNAPSHOT_COLLECTION = 20_000;
const MAX_SNAPSHOT_STRING = 4_096;
const MAX_SNAPSHOT_ID = 256;
const MAX_STATE_LABELS = 128;
const AGENT_STATUSES = new Set<AgentStatus>(["idle", "working", "blocked", "done", "unknown"]);

export class SnapshotContractError extends Error {
  constructor() {
    super("Herdr snapshot response is malformed");
    this.name = "SnapshotContractError";
  }
}

export function parseSnapshot(value: unknown): Snapshot {
  const record = requiredRecord(value);
  const workspaces = parseCollection(record.workspaces, parseWorkspace);
  const tabs = parseCollection(record.tabs, parseTab);
  const panes = parseCollection(record.panes, parsePane);
  const layouts = parseCollection(record.layouts, parseLayout);
  const selectedPaneId = optionalId(record.selected_pane_id);

  requireUnique(workspaces.map((workspace) => workspace.workspace_id));
  requireUnique(tabs.map((tab) => tab.tab_id));
  requireUnique(panes.map((pane) => pane.pane_id));
  requireUnique(panes.map((pane) => pane.terminal_id));

  const workspaceIds = new Set(workspaces.map((workspace) => workspace.workspace_id));
  const tabsById = new Map(tabs.map((tab) => [tab.tab_id, tab]));
  const panesById = new Map(panes.map((pane) => [pane.pane_id, pane]));
  if (
    tabs.some((tab) => !workspaceIds.has(tab.workspace_id)) ||
    panes.some((pane) => {
      const tab = tabsById.get(pane.tab_id);
      return !workspaceIds.has(pane.workspace_id) || !tab || tab.workspace_id !== pane.workspace_id;
    }) ||
    layouts.some((layout) => {
      const tab = tabsById.get(layout.tab_id);
      return (
        !workspaceIds.has(layout.workspace_id) ||
        !tab ||
        tab.workspace_id !== layout.workspace_id ||
        layout.panes.some((layoutPane) => {
          const pane = panesById.get(layoutPane.pane_id);
          return !pane || pane.tab_id !== layout.tab_id;
        })
      );
    }) ||
    (selectedPaneId !== undefined && selectedPaneId !== null && !panesById.has(selectedPaneId))
  ) {
    throw new SnapshotContractError();
  }

  return {
    workspaces,
    tabs,
    panes,
    layouts,
    ...(selectedPaneId === undefined ? {} : { selected_pane_id: selectedPaneId }),
  };
}

function parseWorkspace(value: unknown): WorkspaceInfo {
  const record = requiredRecord(value);
  const worktree = parseOptionalWorktree(record.worktree);
  return {
    workspace_id: requiredId(record.workspace_id),
    number: requiredNonNegativeInteger(record.number),
    label: requiredString(record.label),
    focused: requiredBoolean(record.focused),
    pane_count: requiredNonNegativeInteger(record.pane_count),
    tab_count: requiredNonNegativeInteger(record.tab_count),
    active_tab_id: requiredId(record.active_tab_id),
    agent_status: requiredAgentStatus(record.agent_status),
    ...optionalBooleanField("can_clear_name", record.can_clear_name),
    ...(worktree ? { worktree } : {}),
  };
}

function parseOptionalWorktree(value: unknown): WorkspaceInfo["worktree"] {
  if (value === undefined || value === null) return undefined;
  const record = requiredRecord(value);
  return {
    repo_key: requiredString(record.repo_key),
    repo_name: requiredString(record.repo_name),
    repo_root: requiredString(record.repo_root),
    checkout_path: requiredString(record.checkout_path),
    is_linked_worktree: requiredBoolean(record.is_linked_worktree),
  };
}

function parseTab(value: unknown): TabInfo {
  const record = requiredRecord(value);
  return {
    tab_id: requiredId(record.tab_id),
    workspace_id: requiredId(record.workspace_id),
    number: requiredNonNegativeInteger(record.number),
    label: requiredString(record.label),
    focused: requiredBoolean(record.focused),
    pane_count: requiredNonNegativeInteger(record.pane_count),
    agent_status: requiredAgentStatus(record.agent_status),
    ...optionalBooleanField("can_clear_name", record.can_clear_name),
  };
}

function parsePane(value: unknown): PaneInfo {
  const record = requiredRecord(value);
  const stateLabels = optionalStringRecord(record.state_labels);
  return {
    pane_id: requiredId(record.pane_id),
    terminal_id: requiredId(record.terminal_id),
    workspace_id: requiredId(record.workspace_id),
    tab_id: requiredId(record.tab_id),
    focused: requiredBoolean(record.focused),
    ...optionalStringField("cwd", record.cwd),
    ...optionalStringField("foreground_cwd", record.foreground_cwd),
    ...optionalStringField("label", record.label),
    ...optionalStringField("agent", record.agent),
    ...optionalStringField("title", record.title),
    ...optionalStringField("terminal_title", record.terminal_title),
    ...optionalStringField("terminal_title_stripped", record.terminal_title_stripped),
    ...optionalStringField("display_agent", record.display_agent),
    ...optionalStringField("task_summary", record.task_summary),
    agent_status: requiredAgentStatus(record.agent_status),
    ...(stateLabels === undefined ? {} : { state_labels: stateLabels }),
    revision: requiredNonNegativeInteger(record.revision),
  };
}

function parseLayout(value: unknown): LayoutSnapshot {
  const record = requiredRecord(value);
  return {
    workspace_id: requiredId(record.workspace_id),
    tab_id: requiredId(record.tab_id),
    zoomed: requiredBoolean(record.zoomed),
    area: parseRect(record.area),
    focused_pane_id: requiredId(record.focused_pane_id),
    panes: parseCollection(record.panes, parseLayoutPane),
    splits: parseCollection(record.splits, (split) => {
      const splitRecord = requiredRecord(split);
      const ratio = splitRecord.ratio;
      if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        throw new SnapshotContractError();
      }
      if (splitRecord.direction !== "right" && splitRecord.direction !== "down") {
        throw new SnapshotContractError();
      }
      return {
        id: requiredId(splitRecord.id),
        direction: splitRecord.direction,
        ratio,
        rect: parseRect(splitRecord.rect),
      };
    }),
  };
}

function parseLayoutPane(value: unknown): LayoutPane {
  const record = requiredRecord(value);
  return {
    pane_id: requiredId(record.pane_id),
    focused: requiredBoolean(record.focused),
    rect: parseRect(record.rect),
  };
}

function parseRect(value: unknown): LayoutRect {
  const record = requiredRecord(value);
  return {
    x: requiredNonNegativeInteger(record.x),
    y: requiredNonNegativeInteger(record.y),
    width: requiredNonNegativeInteger(record.width),
    height: requiredNonNegativeInteger(record.height),
  };
}

function parseCollection<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > MAX_SNAPSHOT_COLLECTION) {
    throw new SnapshotContractError();
  }
  return value.map(parse);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SnapshotContractError();
  }
  return value as Record<string, unknown>;
}

function requiredId(value: unknown) {
  if (typeof value !== "string" || !value || value.length > MAX_SNAPSHOT_ID || hasControl(value)) {
    throw new SnapshotContractError();
  }
  return value;
}

function optionalId(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return requiredId(value);
}

function requiredString(value: unknown) {
  if (typeof value !== "string" || value.length > MAX_SNAPSHOT_STRING || hasControl(value)) {
    throw new SnapshotContractError();
  }
  return value;
}

function optionalStringField<Key extends string>(key: Key, value: unknown) {
  if (value === undefined || value === null) {
    return {};
  }
  return { [key]: requiredString(value) } as Record<Key, string>;
}

function optionalBooleanField<Key extends string>(key: Key, value: unknown) {
  if (value === undefined || value === null) {
    return {};
  }
  return { [key]: requiredBoolean(value) } as Record<Key, boolean>;
}

function requiredBoolean(value: unknown) {
  if (typeof value !== "boolean") {
    throw new SnapshotContractError();
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new SnapshotContractError();
  }
  return Number(value);
}

function requiredAgentStatus(value: unknown): AgentStatus {
  if (typeof value !== "string" || !AGENT_STATUSES.has(value as AgentStatus)) {
    throw new SnapshotContractError();
  }
  return value as AgentStatus;
}

function optionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const record = requiredRecord(value);
  const entries = Object.entries(record);
  if (entries.length > MAX_STATE_LABELS) {
    throw new SnapshotContractError();
  }
  return Object.fromEntries(entries.map(([key, entry]) => [requiredId(key), requiredString(entry)]));
}

function requireUnique(values: readonly string[]) {
  if (new Set(values).size !== values.length) {
    throw new SnapshotContractError();
  }
}

function hasControl(value: string) {
  return [...value].some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return point <= 0x1f || point === 0x7f;
  });
}
