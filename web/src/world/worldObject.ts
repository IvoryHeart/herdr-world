import type { Pane, Tab, Workspace } from "../types";
import type { WorldRuntimeConnection } from "./runtimeStore";

export type WorldObjectKind = "host" | "space" | "agent" | "terminal";
export type WorldAgentStatus =
  | "working"
  | "idle"
  | "blocked"
  | "done"
  | "unknown";

type WorldObjectBase = {
  id: string;
  kind: WorldObjectKind;
  nativeId: string;
  parentId: string | null;
  connectionId: string;
  generation: number;
  label: string;
  stale: boolean;
  actionable: boolean;
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

function status(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

function buildHost(connection: WorldRuntimeConnection): WorldHostObject {
  const id = worldObjectId(
    connection.connectionId,
    "host",
    connection.connectionId,
  );
  const tabsByWorkspace = new Map<string, Tab[]>();
  const panesByWorkspace = new Map<string, Pane[]>();
  for (const tab of connection.snapshot?.tabs ?? []) {
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(tab);
    tabsByWorkspace.set(tab.workspace_id, tabs);
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
          return {
            id: worldObjectId(connection.connectionId, "pane", pane.pane_id),
            kind,
            nativeId: pane.pane_id,
            parentId: spaceId,
            connectionId: connection.connectionId,
            generation: connection.generation,
            label: boundedLabel(
              pane.agent,
              isAgent ? "Agent" : `Terminal ${pane.pane_id.slice(0, 8)}`,
            ),
            stale: connection.stale,
            actionable: connection.actionable,
            pane,
            workspaceId: pane.workspace_id,
            tabId: pane.tab_id,
            terminalId: pane.terminal_id,
            status: status(pane.agent_status),
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
        stale: connection.stale,
        actionable: connection.actionable,
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
    stale: connection.stale,
    actionable: connection.actionable,
    connection,
    spaces,
  };
}

export function buildWorldObject(
  connections: readonly WorldRuntimeConnection[],
): WorldObject {
  const hosts = [...connections]
    .sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) ||
        left.label.localeCompare(right.label) ||
        left.connectionId.localeCompare(right.connectionId),
    )
    .map(buildHost);
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
