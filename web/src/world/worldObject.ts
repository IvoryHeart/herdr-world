export { worldObjectWithWatches } from "./worldWatches";
import { sha256 } from "./worldDigest";
import { roomInputCache } from "./worldRoomCache";
import {
  boundedLabel,
  boundedOptionalText,
  agentThreadTitle,
} from "./worldText";
export { boundedOptionalText, agentThreadTitle } from "./worldText";
import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { agentListRecord, agentTitle } from "../agentName";
import { DEVTOOLS } from "./devtools/flag";
import { countWorldWork } from "./devtools/renderer";

export type WorldObjectKind = "host" | "space" | "agent" | "terminal";
export type WorldAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";
export type WorldAgentStatusCounts = Record<WorldAgentStatus, number>;
export type WorldObservedCoverage = {
  spaces: number;
  tabs: number;
  leaves: number;
  agents: number;
  shells: number;
  status: WorldAgentStatusCounts;
};
export type WorldHostState =
  | "active"
  | "ready-inactive"
  | "reconnecting"
  | "offline-stale";

export type WorldActionCapabilities = {
  activateHost: boolean;
  openTerminal: boolean;
  openSpaces: boolean;
  files: boolean;
  changes: boolean;
  agentHistory: boolean;
  roomMutation: boolean;
  launcher: boolean;
};

type WorldObjectBase = {
  id: string;
  kind: WorldObjectKind;
  nativeId: string;
  parentId: string | null;
  connectionId: string;
  generation: number;
  label: string;
  hostLabel: string;
  hostState: WorldHostState;
  selectedHost: boolean;
  stale: boolean;
  actionable: boolean;
  capabilities: WorldActionCapabilities;
};

export type WorldHostObject = WorldObjectBase & {
  kind: "host";
  parentId: null;
  connection: WorldRuntimeConnection;
  spaces: WorldSpaceObject[];
  coverage: WorldObservedCoverage;
};

export type WorldSpaceObject = WorldObjectBase & {
  kind: "space";
  parentId: string;
  workspace: Workspace;
  tabs: Tab[];
  children: WorldLeafObject[];
  coverage: WorldObservedCoverage;
};

export type WorldLeafObject = WorldObjectBase & {
  appearance?: { status?: string; avatar?: string };
  kind: "agent" | "terminal";
  parentId: string;
  pane: Pane;
  workspaceId: string;
  tabId: string;
  terminalId: string;
  status: WorldAgentStatus;
  focused: boolean;
  tabLabel?: string;
  tabNumber?: number;
  agentLabel?: string;
  /** The live name supplied to Herdr when the agent was started. */
  agentName?: string;
  /** The harness title for its thread, from the terminal title. */
  terminalTitle?: string;
  modelLabel?: string;
  taskSummary?: string;
  agentSessionIdentity?: string;
  agentSessionFingerprint?: string;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  watched?: boolean;
  lastActivityAt?: number;
  spaceLabel: string;
};

export type WorldObjectNode =
  | WorldHostObject
  | WorldSpaceObject
  | WorldLeafObject;

export type WorldObject = {
  version: 1;
  hosts: WorldHostObject[];
  spaces: WorldSpaceObject[];
  leaves: WorldLeafObject[];
  nodes: WorldObjectNode[];
  nodeById: ReadonlyMap<string, WorldObjectNode>;
  coverage: WorldObservedCoverage;
};

export function worldObjectId(
  connectionId: string,
  identity: WorldObjectKind | "pane",
  nativeId: string,
) {
  return JSON.stringify([connectionId, identity, nativeId]);
}

type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};

const TASK_SUMMARY_TOKEN = "task_summary";
const TASK_SUMMARY_SESSION_TOKEN = "task_summary_session";

function agentSession(value: unknown): AgentSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const session = value as Record<string, unknown>;
  if (
    typeof session.source !== "string" ||
    typeof session.agent !== "string" ||
    typeof session.kind !== "string" ||
    typeof session.value !== "string" ||
    !session.source ||
    !session.agent ||
    !session.kind ||
    !session.value
  ) {
    return null;
  }
  return {
    source: session.source,
    agent: session.agent,
    kind: session.kind,
    value: session.value,
  };
}

function sameAgentSession(left: AgentSession, right: AgentSession) {
  return (
    left.source === right.source &&
    left.agent === right.agent &&
    left.kind === right.kind &&
    left.value === right.value
  );
}

export function taskSummarySessionFingerprint(session: AgentSession) {
  return sha256(
    JSON.stringify([
      session.source,
      session.agent,
      session.kind,
      session.value,
    ]),
  );
}

function admittedAgentSessionIdentity(
  metadata: Record<string, unknown> | null,
) {
  const value = metadata?.agent_session;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const session = value as Record<string, unknown>;
  const agent = boundedOptionalText(session.agent, 100);
  const kind = boundedOptionalText(session.kind, 100);
  const identity = boundedOptionalText(session.value, 512);
  if (!agent && !kind && !identity) return undefined;
  return JSON.stringify([agent ?? null, kind ?? null, identity ?? null]);
}

function admittedAgentSessionFingerprint(
  pane: Pane,
  metadata: Record<string, unknown> | null,
) {
  const current = agentSession(
    (pane as Pane & { agent_session?: unknown }).agent_session,
  );
  if (!current) return undefined;
  const observed = metadata?.agent_session;
  const observedSession = agentSession(observed);
  if (
    observed !== undefined &&
    (!observedSession || !sameAgentSession(current, observedSession))
  )
    return undefined;
  return taskSummarySessionFingerprint(current);
}

function taskSummaryFromTokens(
  pane: Pane,
  agentMetadata: Record<string, unknown> | null,
) {
  const tokens = (pane as Pane & { tokens?: unknown }).tokens;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    return undefined;
  }
  const summary = (tokens as Record<string, unknown>)[TASK_SUMMARY_TOKEN];
  const fingerprint = (tokens as Record<string, unknown>)[
    TASK_SUMMARY_SESSION_TOKEN
  ];
  if (typeof summary !== "string" || typeof fingerprint !== "string")
    return undefined;
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) return undefined;
  const paneSession = agentSession(
    (pane as Pane & { agent_session?: unknown }).agent_session,
  );
  if (!paneSession) return undefined;
  const agentValue = agentMetadata?.agent_session;
  const agentSessionValue = agentSession(agentValue);
  if (
    agentValue !== undefined &&
    (!agentSessionValue || !sameAgentSession(paneSession, agentSessionValue))
  ) {
    return undefined;
  }
  if (fingerprint !== taskSummarySessionFingerprint(paneSession))
    return undefined;
  return boundedOptionalText(summary, 160);
}

function status(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

export function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function* observedCoverage(
  connection: WorldRuntimeConnection,
): Generator<number, WorldObservedCoverage> {
  const snapshot = connection.snapshot;
  if (!snapshot) {
    return {
      spaces: 0,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: emptyStatusCounts(),
    };
  }
  if (snapshot.coverage) {
    return {
      spaces: snapshot.coverage.workspaces,
      tabs: snapshot.coverage.tabs,
      leaves: snapshot.coverage.panes,
      agents: snapshot.coverage.agentPanes,
      shells: Math.max(
        0,
        snapshot.coverage.panes - snapshot.coverage.agentPanes,
      ),
      status: { ...snapshot.coverage.status },
    };
  }
  const statusCounts = emptyStatusCounts();
  let agents = 0;
  for (const pane of snapshot.panes) {
    if (typeof pane.agent === "string" && pane.agent.trim()) {
      agents += 1;
      statusCounts[status(pane.agent_status)] += 1;
    }
    yield 1;
  }
  return {
    spaces: snapshot.workspaces.length,
    tabs: snapshot.tabs.length,
    leaves: snapshot.panes.length,
    agents,
    shells: snapshot.panes.length - agents,
    status: statusCounts,
  };
}

function addCoverage(
  left: WorldObservedCoverage,
  right: WorldObservedCoverage,
): WorldObservedCoverage {
  return {
    spaces: left.spaces + right.spaces,
    tabs: left.tabs + right.tabs,
    leaves: left.leaves + right.leaves,
    agents: left.agents + right.agents,
    shells: left.shells + right.shells,
    status: {
      working: left.status.working + right.status.working,
      idle: left.status.idle + right.status.idle,
      blocked: left.status.blocked + right.status.blocked,
      done: left.status.done + right.status.done,
      unknown: left.status.unknown + right.status.unknown,
    },
  };
}

function hostState(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): WorldHostState {
  const ready =
    connection.state === "ready" &&
    connection.actionable &&
    !connection.stale &&
    connection.snapshotGeneration === connection.generation;
  if (ready) {
    return connection.connectionId === selectedConnectionId
      ? "active"
      : "ready-inactive";
  }
  if (
    connection.state === "connecting" ||
    connection.state === "reconnecting" ||
    connection.state === "stopping"
  ) {
    return "reconnecting";
  }
  return "offline-stale";
}

function actionCapabilities(
  kind: WorldObjectKind,
  state: WorldHostState,
): WorldActionCapabilities {
  const operational = state === "active" || state === "ready-inactive";
  const leaf = kind === "agent" || kind === "terminal";
  const space = kind === "space";
  return {
    activateHost: state === "ready-inactive",
    openTerminal: operational && leaf,
    openSpaces: operational && (leaf || space),
    files: operational && (leaf || space),
    changes: operational && (leaf || space),
    agentHistory: operational && kind === "agent",
    roomMutation: operational && space,
    launcher: operational && space,
  };
}

function admittedStateLabels(
  value: unknown,
): Partial<Record<WorldAgentStatus, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Partial<Record<WorldAgentStatus, string>> = {};
  for (const key of [
    "working",
    "idle",
    "blocked",
    "done",
    "unknown",
  ] as const) {
    const label = boundedOptionalText(source[key], 96);
    if (label) result[key] = label;
  }
  return result;
}

// Each connection's host object, unselected [0] and selected [1].
const preparedHosts = new WeakMap<
  WorldRuntimeConnection,
  readonly [WorldHostObject | undefined, WorldHostObject | undefined]
>();
const preparedWorlds = new WeakMap<
  readonly WorldRuntimeConnection[],
  Map<string | null, WorldObject>
>();

/** Yield a task so terminal and keyboard callbacks can run between hosts. */
export function yieldWorldTask(): Promise<void> {
  return scheduleWorldTask("background");
}

/** Bounded transport admission must progress alongside continuously painted scenes. */
export function yieldWorldAdmissionTask(): Promise<void> {
  return scheduleWorldTask("user-visible");
}

function scheduleWorldTask(
  priority: "background" | "user-visible",
): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & {
      scheduler?: {
        postTask(
          task: () => void,
          options: { priority: "background" | "user-visible" },
        ): Promise<void>;
      };
    }
  ).scheduler;
  // Model preparation stays in the background. Bounded transport admission
  // needs ordinary turns so a continuously painted scene cannot starve it.
  if (scheduler?.postTask) return scheduler.postTask(() => {}, { priority });
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function prepareWorldObject(
  connections: readonly WorldRuntimeConnection[],
  isCurrent: () => boolean = () => true,
  options: {
    yieldTask?: (
      checkpoint: "host" | "host-batch" | "node-batch" | "complete",
      count: number,
    ) => Promise<void>;
    onWorkSlice?: (
      checkpoint: "host" | "host-batch" | "node-batch",
      count: number,
      durationMs: number,
      connectionId?: string,
    ) => void;
    /**
     * The focused host views present (buildWorldObject's
     * selectedConnectionId). Preparing that variant lets render find it.
     */
    selectedConnectionId?: string | null;
  } = {},
): Promise<WorldObject | null> {
  const selectedConnectionId = options.selectedConnectionId ?? null;
  const yieldTask = options.yieldTask ?? yieldWorldTask;
  // Admit already queued lifecycle and transport tasks before model allocation.
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const connection of connections) {
    if (!isCurrent()) return null;
    const variant = connection.connectionId === selectedConnectionId ? 1 : 0;
    let prepared = preparedHosts.get(connection)?.[variant];
    if (!prepared) {
      const construction = constructHost(connection, selectedConnectionId);
      let result: IteratorResult<number, WorldHostObject>;
      do {
        const sliceStart = performance.now();
        let count = 0;
        do {
          result = construction.next();
          if (result.done) break;
          count += result.value;
        } while (count < 256 && performance.now() - sliceStart < 8);
        options.onWorkSlice?.(
          "host-batch",
          count,
          performance.now() - sliceStart,
          connection.connectionId,
        );
        if (!result.done) {
          await yieldTask("host-batch", count);
          if (!isCurrent()) return null;
        }
      } while (!result.done);
      prepared = result.value;
    }
    // Aggregate focus is independent of runtime authority. Prepare only the
    // variant views present: the focused host selected, every peer not.
    const variants = [...(preparedHosts.get(connection) ?? [])];
    variants[variant] = prepared;
    preparedHosts.set(connection, [variants[0], variants[1]]);
    await yieldTask("host", 1);
  }
  if (!isCurrent()) return null;
  const hosts = [...connections]
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.label.localeCompare(right.label) ||
        left.connectionId.localeCompare(right.connectionId),
    )
    .map((connection) => buildHost(connection, selectedConnectionId));
  const spaces: WorldSpaceObject[] = [];
  const leaves: WorldLeafObject[] = [];
  const nodes: WorldObjectNode[] = [];
  const nodeById = new Map<string, WorldObjectNode>();
  let coverage: WorldObservedCoverage = {
    spaces: 0,
    tabs: 0,
    leaves: 0,
    agents: 0,
    shells: 0,
    status: emptyStatusCounts(),
  };
  let batch = 0;
  let sliceCount = 0;
  const indexNode = (node: WorldObjectNode) => {
    nodes.push(node);
    nodeById.set(node.id, node);
    batch += 1;
    sliceCount += 1;
    return sliceCount === 256;
  };
  let indexSliceStart = performance.now();
  for (const host of hosts) {
    coverage = addCoverage(coverage, host.coverage);
    if (indexNode(host)) {
      const durationMs = performance.now() - indexSliceStart;
      options.onWorkSlice?.("node-batch", sliceCount, durationMs);
      await yieldTask("node-batch", sliceCount);
      if (!isCurrent()) return null;
      indexSliceStart = performance.now();
      sliceCount = 0;
    }
    for (const space of host.spaces) {
      spaces.push(space);
      if (indexNode(space)) {
        const durationMs = performance.now() - indexSliceStart;
        options.onWorkSlice?.("node-batch", sliceCount, durationMs);
        await yieldTask("node-batch", sliceCount);
        if (!isCurrent()) return null;
        indexSliceStart = performance.now();
        sliceCount = 0;
      }
      for (const leaf of space.children) {
        leaves.push(leaf);
        if (indexNode(leaf)) {
          const durationMs = performance.now() - indexSliceStart;
          options.onWorkSlice?.("node-batch", sliceCount, durationMs);
          await yieldTask("node-batch", sliceCount);
          if (!isCurrent()) return null;
          indexSliceStart = performance.now();
          sliceCount = 0;
        }
      }
    }
  }
  const world: WorldObject = {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById,
    coverage,
  };
  if (sliceCount > 0) {
    options.onWorkSlice?.(
      "node-batch",
      sliceCount,
      performance.now() - indexSliceStart,
    );
  }
  await yieldTask("complete", batch);
  if (!isCurrent()) return null;
  const variants = preparedWorlds.get(connections) ?? new Map();
  variants.set(selectedConnectionId, world);
  preparedWorlds.set(connections, variants);
  return world;
}

function buildHost(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): WorldHostObject {
  const prepared =
    preparedHosts.get(connection)?.[
      connection.connectionId === selectedConnectionId ? 1 : 0
    ];
  if (prepared) return prepared;
  const construction = constructHost(connection, selectedConnectionId);
  let result = construction.next();
  while (!result.done) result = construction.next();
  return result.value;
}

// Both entry points consume this semantic constructor. Async preparation can
// suspend grouping, leaf allocation and coverage work without publishing a
// partial host; the legacy synchronous path retains exactly the same contract.
function* constructHost(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): Generator<number, WorldHostObject> {
  const connectionHostState = hostState(connection, selectedConnectionId);
  const selectedHost = connection.connectionId === selectedConnectionId;
  const hostCapabilities = actionCapabilities("host", connectionHostState);
  const operational =
    connectionHostState === "active" ||
    connectionHostState === "ready-inactive";
  const observedGeneration =
    connection.snapshotGeneration ?? connection.generation;
  const id = worldObjectId(
    connection.connectionId,
    "host",
    connection.connectionId,
  );
  const tabsByWorkspace = new Map<string, Tab[]>();
  const panesByWorkspace = new Map<string, Pane[]>();
  const tabsById = new Map<string, Tab>();
  const workspaceCoverage = new Map<
    string,
    NonNullable<
      NonNullable<WorldRuntimeConnection["snapshot"]>["coverage"]
    >["byWorkspace"][number]
  >();
  for (const coverage of connection.snapshot?.coverage?.byWorkspace ?? []) {
    workspaceCoverage.set(coverage.workspaceId, coverage);
    yield 1;
  }
  const hostLabel = boundedLabel(connection.label, "Host");
  for (const tab of connection.snapshot?.tabs ?? []) {
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(tab);
    tabsByWorkspace.set(tab.workspace_id, tabs);
    tabsById.set(tab.tab_id, tab);
    yield 1;
  }
  for (const pane of connection.snapshot?.panes ?? []) {
    const panes = panesByWorkspace.get(pane.workspace_id) ?? [];
    panes.push(pane);
    panesByWorkspace.set(pane.workspace_id, panes);
    yield 1;
  }
  const spaces: WorldSpaceObject[] = [];
  for (const workspace of connection.snapshot?.workspaces ?? []) {
    const spaceId = worldObjectId(
      connection.connectionId,
      "space",
      workspace.workspace_id,
    );
    const spaceLabel = boundedLabel(
      workspace.label,
      `Space ${workspace.number ?? ""}`,
    );
    const roomPanes = panesByWorkspace.get(workspace.workspace_id) ?? [];
    const metadata = new Map<Pane, Record<string, unknown> | null>();
    const paneInputs: string[] = [];
    for (const pane of roomPanes) {
      const agent =
        typeof pane.agent === "string" && pane.agent.trim()
          ? agentListRecord(connection.snapshot?.agents ?? [], pane)
          : null;
      metadata.set(pane, agent);
      paneInputs.push(JSON.stringify([pane, agent]));
      yield 1;
    }
    const roomCache = roomInputCache(workspace, [
      connection.connectionId,
      observedGeneration,
      hostLabel,
      connectionHostState,
      selectedHost,
      connection.stale,
      workspace,
      tabsByWorkspace.get(workspace.workspace_id),
      paneInputs,
      workspaceCoverage.get(workspace.workspace_id),
    ]);
    if (roomCache.value) {
      spaces.push(roomCache.value);
      yield 1;
      continue;
    }
    if (DEVTOOLS) countWorldWork("world.room-prepare");
    const children: WorldLeafObject[] = [];
    const spaceStatus = emptyStatusCounts();
    let spaceAgents = 0;
    for (const pane of roomPanes) {
      const isAgent =
        typeof pane.agent === "string" && pane.agent.trim().length > 0;
      const kind = isAgent ? "agent" : "terminal";
      const capabilities = actionCapabilities(kind, connectionHostState);
      const tab = tabsById.get(pane.tab_id);
      const tabLabel = boundedOptionalText(tab?.label, 100);
      const agentMetadata = isAgent ? (metadata.get(pane) ?? null) : null;
      const agentLabel = isAgent
        ? boundedOptionalText(
            pane.display_agent ?? agentMetadata?.display_agent ?? pane.agent,
            100,
          )
        : undefined;
      const agentName = isAgent
        ? boundedOptionalText(agentMetadata?.name, 100)
        : undefined;
      const terminalTitle = isAgent
        ? agentThreadTitle(
            agentMetadata?.terminal_title_stripped ??
              agentMetadata?.terminal_title,
            pane.agent,
          )
        : undefined;
      const modelLabel = isAgent
        ? boundedOptionalText(
            pane.model_name ??
              pane.model ??
              agentMetadata?.model_name ??
              agentMetadata?.model,
            100,
          )
        : undefined;
      const taskSummary = isAgent
        ? (taskSummaryFromTokens(pane, agentMetadata) ??
          boundedOptionalText(
            pane.task_summary ?? agentMetadata?.task_summary,
            160,
          ))
        : undefined;
      const agentSessionIdentity = isAgent
        ? admittedAgentSessionIdentity(agentMetadata)
        : undefined;
      const agentSessionFingerprint = isAgent
        ? admittedAgentSessionFingerprint(pane, agentMetadata)
        : undefined;
      const lastActivityAt = isAgent
        ? (pane.last_activity_at ?? agentMetadata?.last_activity_at)
        : undefined;
      const child: WorldLeafObject = {
        id: worldObjectId(
          connection.connectionId,
          "terminal",
          pane.terminal_id,
        ),
        kind,
        nativeId: pane.pane_id,
        parentId: spaceId,
        connectionId: connection.connectionId,
        generation: observedGeneration,
        label: boundedLabel(
          agentTitle(agentName, agentLabel),
          isAgent ? "Agent" : `Terminal ${pane.pane_id.slice(0, 8)}`,
        ),
        hostLabel,
        hostState: connectionHostState,
        selectedHost,
        stale: connection.stale || !operational,
        actionable: operational,
        capabilities,
        pane,
        workspaceId: pane.workspace_id,
        tabId: pane.tab_id,
        terminalId: pane.terminal_id,
        status: status(pane.agent_status),
        focused: pane.focused === true,
        spaceLabel,
        ...(tabLabel ? { tabLabel } : {}),
        ...(Number.isSafeInteger(tab?.number)
          ? { tabNumber: tab?.number }
          : {}),
        ...(agentLabel ? { agentLabel } : {}),
        ...(agentName ? { agentName } : {}),
        ...(terminalTitle ? { terminalTitle } : {}),
        ...(modelLabel ? { modelLabel } : {}),
        ...(taskSummary ? { taskSummary } : {}),
        ...(agentSessionIdentity ? { agentSessionIdentity } : {}),
        ...(agentSessionFingerprint ? { agentSessionFingerprint } : {}),
        stateLabels: isAgent
          ? admittedStateLabels(
              pane.state_labels ?? agentMetadata?.state_labels,
            )
          : {},
        ...(typeof lastActivityAt === "number" &&
        Number.isFinite(lastActivityAt) &&
        lastActivityAt > 0
          ? { lastActivityAt }
          : {}),
      };
      children.push(child);
      if (child.kind === "agent") {
        spaceAgents += 1;
        spaceStatus[child.status] += 1;
      }
      yield 1;
    }
    const exactCoverage = workspaceCoverage.get(workspace.workspace_id);
    const room: WorldSpaceObject = {
      id: spaceId,
      kind: "space",
      nativeId: workspace.workspace_id,
      parentId: id,
      connectionId: connection.connectionId,
      generation: observedGeneration,
      label: boundedLabel(workspace.label, `Space ${workspace.number ?? ""}`),
      hostLabel,
      hostState: connectionHostState,
      selectedHost,
      stale: connection.stale || !operational,
      actionable: operational,
      capabilities: actionCapabilities("space", connectionHostState),
      workspace,
      tabs: tabsByWorkspace.get(workspace.workspace_id) ?? [],
      children,
      coverage: exactCoverage
        ? {
            spaces: 1,
            tabs: exactCoverage.tabs,
            leaves: exactCoverage.panes,
            agents: exactCoverage.agentPanes,
            shells: Math.max(0, exactCoverage.panes - exactCoverage.agentPanes),
            status: { ...exactCoverage.status },
          }
        : {
            spaces: 1,
            tabs: (tabsByWorkspace.get(workspace.workspace_id) ?? []).length,
            leaves: children.length,
            agents: spaceAgents,
            shells: children.length - spaceAgents,
            status: spaceStatus,
          },
    };
    roomCache.save(room);
    spaces.push(room);
    yield 1;
  }
  return {
    id,
    kind: "host",
    nativeId: connection.connectionId,
    parentId: null,
    connectionId: connection.connectionId,
    generation: connection.generation,
    label: boundedLabel(connection.label, "Host"),
    hostLabel,
    hostState: connectionHostState,
    selectedHost,
    stale: connection.stale || !operational,
    actionable: operational,
    capabilities: hostCapabilities,
    connection,
    spaces,
    coverage: yield* observedCoverage(connection),
  };
}

export function buildWorldObject(
  connections: readonly WorldRuntimeConnection[],
  selectedConnectionId: string | null = null,
): WorldObject {
  const prepared = preparedWorlds.get(connections);
  const cached = prepared?.get(selectedConnectionId);
  if (cached) return cached;
  // Synchronous: a render that reaches here blocks on the whole World.
  if (DEVTOOLS) countWorldWork("world.sync-build");
  const hosts = [...connections]
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.label.localeCompare(right.label) ||
        left.connectionId.localeCompare(right.connectionId),
    )
    .map((connection) => buildHost(connection, selectedConnectionId));
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  const coverage = hosts.reduce<WorldObservedCoverage>(
    (total, host) => addCoverage(total, host.coverage),
    {
      spaces: 0,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: emptyStatusCounts(),
    },
  );
  const world: WorldObject = {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage,
  };
  prepared?.set(selectedConnectionId, world);
  return world;
}

export function worldObjectForConnection(
  world: WorldObject,
  connectionId: string | null,
): WorldObject {
  const host = connectionId
    ? world.hosts.find((candidate) => candidate.connectionId === connectionId)
    : undefined;
  const hosts = host ? [host] : [];
  const spaces = host?.spaces ?? [];
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = host
    ? [
        host,
        ...spaces.flatMap((space): WorldObjectNode[] => [
          space,
          ...space.children,
        ]),
      ]
    : [];
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage: host
      ? host.coverage
      : {
          spaces: 0,
          tabs: 0,
          leaves: 0,
          agents: 0,
          shells: 0,
          status: emptyStatusCounts(),
        },
  };
}
