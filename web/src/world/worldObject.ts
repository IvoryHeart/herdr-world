import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";

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
  modelLabel?: string;
  taskSummary?: string;
  agentSessionIdentity?: string;
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

function boundedLabel(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? boundedCodePointPrefix(normalized, 100) : fallback;
}

function boundedCodePointPrefix(value: string, limit: number) {
  let result = "";
  let length = 0;
  for (const character of value) {
    if (length >= limit) break;
    result += character;
    length += 1;
  }
  return result;
}

export function boundedOptionalText(
  value: unknown,
  limit: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized
    ? boundedCodePointPrefix(normalized, limit).trimEnd()
    : undefined;
}

function admittedAgentSessionIdentity(
  metadata: Record<string, unknown> | null,
): string | undefined {
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

function status(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function observedCoverage(
  connection: WorldRuntimeConnection,
): WorldObservedCoverage {
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
    if (typeof pane.agent !== "string" || !pane.agent.trim()) continue;
    agents += 1;
    statusCounts[status(pane.agent_status)] += 1;
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
  const operational = state === "active";
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

function matchingAgentMetadata(
  agents: readonly Record<string, unknown>[],
  pane: Pane,
): Record<string, unknown> | null {
  return (
    agents.find((candidate) => {
      if (candidate.pane_id !== pane.pane_id) return false;
      if (
        typeof candidate.terminal_id === "string" &&
        candidate.terminal_id !== pane.terminal_id
      ) {
        return false;
      }
      if (
        typeof candidate.agent === "string" &&
        candidate.agent !== pane.agent
      ) {
        return false;
      }
      return true;
    }) ?? null
  );
}

function buildHost(
  connection: WorldRuntimeConnection,
  selectedConnectionId: string | null,
): WorldHostObject {
  const connectionHostState = hostState(connection, selectedConnectionId);
  const selectedHost = connection.connectionId === selectedConnectionId;
  const hostCapabilities = actionCapabilities("host", connectionHostState);
  const operational = connectionHostState === "active";
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
  const workspaceCoverage = new Map(
    (connection.snapshot?.coverage?.byWorkspace ?? []).map((coverage) => [
      coverage.workspaceId,
      coverage,
    ]),
  );
  for (const tab of connection.snapshot?.tabs ?? []) {
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(tab);
    tabsByWorkspace.set(tab.workspace_id, tabs);
    tabsById.set(tab.tab_id, tab);
  }
  for (const pane of connection.snapshot?.panes ?? []) {
    const panes = panesByWorkspace.get(pane.workspace_id) ?? [];
    panes.push(pane);
    panesByWorkspace.set(pane.workspace_id, panes);
  }
  const spaces = (connection.snapshot?.workspaces ?? []).map(
    (workspace): WorldSpaceObject => {
      const spaceId = worldObjectId(
        connection.connectionId,
        "space",
        workspace.workspace_id,
      );
      const children = (panesByWorkspace.get(workspace.workspace_id) ?? []).map(
        (pane): WorldLeafObject => {
          const isAgent =
            typeof pane.agent === "string" && pane.agent.trim().length > 0;
          const kind = isAgent ? "agent" : "terminal";
          const capabilities = actionCapabilities(kind, connectionHostState);
          const tab = tabsById.get(pane.tab_id);
          const tabLabel = boundedOptionalText(tab?.label, 100);
          const agentMetadata = isAgent
            ? matchingAgentMetadata(connection.snapshot?.agents ?? [], pane)
            : null;
          const agentLabel = isAgent
            ? boundedOptionalText(
                pane.display_agent ??
                  agentMetadata?.display_agent ??
                  pane.agent,
                100,
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
            ? boundedOptionalText(
                pane.task_summary ?? agentMetadata?.task_summary,
                160,
              )
            : undefined;
          const agentSessionIdentity = isAgent
            ? admittedAgentSessionIdentity(agentMetadata)
            : undefined;
          const lastActivityAt = isAgent
            ? (pane.last_activity_at ?? agentMetadata?.last_activity_at)
            : undefined;
          return {
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
              agentLabel,
              isAgent ? "Agent" : `Terminal ${pane.pane_id.slice(0, 8)}`,
            ),
            hostLabel: boundedLabel(connection.label, "Host"),
            hostState: connectionHostState,
            selectedHost,
            stale: connection.stale,
            actionable: operational,
            capabilities,
            pane,
            workspaceId: pane.workspace_id,
            tabId: pane.tab_id,
            terminalId: pane.terminal_id,
            status: status(pane.agent_status),
            focused: pane.focused === true,
            spaceLabel: boundedLabel(
              workspace.label,
              `Space ${workspace.number ?? ""}`,
            ),
            ...(tabLabel ? { tabLabel } : {}),
            ...(Number.isSafeInteger(tab?.number)
              ? { tabNumber: tab?.number }
              : {}),
            ...(agentLabel ? { agentLabel } : {}),
            ...(modelLabel ? { modelLabel } : {}),
            ...(taskSummary ? { taskSummary } : {}),
            ...(agentSessionIdentity ? { agentSessionIdentity } : {}),
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
        },
      );
      const exactCoverage = workspaceCoverage.get(workspace.workspace_id);
      const spaceStatus = emptyStatusCounts();
      let spaceAgents = 0;
      if (!exactCoverage) {
        for (const child of children) {
          if (child.kind !== "agent") continue;
          spaceAgents += 1;
          spaceStatus[child.status] += 1;
        }
      }
      return {
        id: spaceId,
        kind: "space",
        nativeId: workspace.workspace_id,
        parentId: id,
        connectionId: connection.connectionId,
        generation: observedGeneration,
        label: boundedLabel(workspace.label, `Space ${workspace.number ?? ""}`),
        hostLabel: boundedLabel(connection.label, "Host"),
        hostState: connectionHostState,
        selectedHost,
        stale: connection.stale,
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
              shells: Math.max(
                0,
                exactCoverage.panes - exactCoverage.agentPanes,
              ),
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
    },
  );
  return {
    id,
    kind: "host",
    nativeId: connection.connectionId,
    parentId: null,
    connectionId: connection.connectionId,
    generation: connection.generation,
    label: boundedLabel(connection.label, "Host"),
    hostLabel: boundedLabel(connection.label, "Host"),
    hostState: connectionHostState,
    selectedHost,
    stale: connection.stale,
    actionable: operational,
    capabilities: hostCapabilities,
    connection,
    spaces,
    coverage: observedCoverage(connection),
  };
}

export function buildWorldObject(
  connections: readonly WorldRuntimeConnection[],
  selectedConnectionId: string | null = null,
): WorldObject {
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
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage,
  };
}

/**
 * Keeps aggregate observation intact while giving a focused client one coherent
 * host presentation. The returned nodes are the original qualified objects, so
 * identities and runtime generations cannot be rebound by the projection.
 */
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

/** Keeps ancestry for a browser-local watched-only presentation. */
export function worldObjectForWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map(({ connectionId, generation, terminalId }) =>
      JSON.stringify([connectionId, generation, terminalId]),
    ),
  );
  const hosts = world.hosts.flatMap((host) => {
    const spaces = host.spaces.flatMap((space) => {
      const children = space.children.filter((leaf) =>
        keys.has(
          JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
        ),
      );
      return children.length ? [{ ...space, children }] : [];
    });
    return spaces.length ? [{ ...host, spaces }] : [];
  });
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  return {
    ...world,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

export function worldObjectWithWatches(
  world: WorldObject,
  watches: readonly {
    connectionId: string;
    generation: number;
    terminalId: string;
  }[],
): WorldObject {
  const keys = new Set(
    watches.map(({ connectionId, generation, terminalId }) =>
      JSON.stringify([connectionId, generation, terminalId]),
    ),
  );
  const hosts = world.hosts.map((host) => ({
    ...host,
    spaces: host.spaces.map((space) => ({
      ...space,
      children: space.children.map((leaf) =>
        keys.has(
          JSON.stringify([leaf.connectionId, leaf.generation, leaf.terminalId]),
        )
          ? { ...leaf, watched: true }
          : leaf,
      ),
    })),
  }));
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes: WorldObjectNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldObjectNode[] => [
      space,
      ...space.children,
    ]),
  ]);
  return {
    ...world,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}
