import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";

export type WorldObjectKind = "host" | "space" | "agent" | "terminal";
export type WorldAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";
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
};

export type WorldSpaceObject = WorldObjectBase & {
  kind: "space";
  parentId: string;
  workspace: Workspace;
  tabs: Tab[];
  children: WorldLeafObject[];
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
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
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
  return normalized ? normalized.slice(0, 100) : fallback;
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
  return normalized ? normalized.slice(0, limit).trimEnd() : undefined;
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
  const id = worldObjectId(
    connection.connectionId,
    "host",
    connection.connectionId,
  );
  const tabsByWorkspace = new Map<string, Tab[]>();
  const panesByWorkspace = new Map<string, Pane[]>();
  const tabsById = new Map<string, Tab>();
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
                240,
              )
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
            generation: connection.generation,
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
      return {
        id: spaceId,
        kind: "space",
        nativeId: workspace.workspace_id,
        parentId: id,
        connectionId: connection.connectionId,
        generation: connection.generation,
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
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}
