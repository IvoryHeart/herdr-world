import { isAgentPane } from "../agentDetection";
import { agentIconKind } from "../AgentIcon";
import type { AgentIconKind } from "../AgentIcon";
import type { HostProfile } from "../hostProfile";
import { qualifiedRuntimeKey, qualifyRuntimeTarget } from "../runtimeIdentity";
import type { QualifiedTarget } from "../runtimeIdentity";
import type { HostConnectionState } from "../runtimeClient";
import type { PaneInfo, Snapshot, TabInfo, WorkspaceInfo } from "../types";

export type WorldHostLocation = "local" | "remote";

export type WorldRuntimeSource = {
  profile: HostProfile;
  location: WorldHostLocation;
  connectionState: HostConnectionState;
  generationKey: string | null;
  features: readonly string[];
  snapshot: Snapshot | null;
};

export type WorldModelNodeKind = "host" | "space" | "agent" | "terminal";

type WorldModelNodeBase = {
  id: string;
  kind: WorldModelNodeKind;
  parentId: string | null;
  hostKey: string;
};

export type WorldHostNode = WorldModelNodeBase & {
  kind: "host";
  parentId: null;
  source: WorldRuntimeSource;
  stale: boolean;
  actionable: boolean;
  spaces: WorldSpaceNode[];
};

export type WorldTab = {
  id: string;
  hostKey: string;
  spaceId: string;
  tabRef: QualifiedTarget;
  tab: TabInfo;
};

export type WorldSpaceNode = WorldModelNodeBase & {
  kind: "space";
  parentId: string;
  workspaceRef: QualifiedTarget;
  workspace: WorkspaceInfo;
  tabs: WorldTab[];
  children: WorldLeafNode[];
};

export type WorldLeafNode = WorldModelNodeBase & {
  kind: "agent" | "terminal";
  parentId: string;
  paneRef: QualifiedTarget;
  terminalRef: QualifiedTarget;
  tabRef: QualifiedTarget;
  pane: PaneInfo;
  agentKind: AgentIconKind | null;
};

export type WorldModelNode = WorldHostNode | WorldSpaceNode | WorldLeafNode;

export type WorldModelEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains" | "reports-to";
};

export type WorldModel = {
  version: 1;
  hosts: WorldHostNode[];
  spaces: WorldSpaceNode[];
  leaves: WorldLeafNode[];
  nodes: WorldModelNode[];
  edges: WorldModelEdge[];
  nodeById: ReadonlyMap<string, WorldModelNode>;
};

export function buildWorldModel(sources: readonly WorldRuntimeSource[]): WorldModel {
  const hosts = [...sources].sort(compareSources).map(buildHost);
  const spaces = hosts.flatMap(({ spaces: hostSpaces }) => hostSpaces);
  const leaves = spaces.flatMap(({ children }) => children);
  const nodes: WorldModelNode[] = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space): WorldModelNode[] => [space, ...space.children]),
  ]);
  const edges: WorldModelEdge[] = hosts.flatMap((host) => [
    ...host.spaces.map((space): WorldModelEdge => ({
      sourceId: host.id,
      targetId: space.id,
      kind: "contains",
    })),
    ...host.spaces.flatMap((space) => space.children.map((child): WorldModelEdge => ({
      sourceId: space.id,
      targetId: child.id,
      kind: "contains",
    }))),
  ]);
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    edges,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  };
}

export function worldHostNodeId(profileId: string) {
  return JSON.stringify([profileId, "host"]);
}

export function stableNumber(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildHost(source: WorldRuntimeSource): WorldHostNode {
  const id = worldHostNodeId(source.profile.profileId);
  const featureSet = new Set(source.features);
  const actionable = Boolean(
    source.profile.enabled &&
    source.generationKey &&
    source.connectionState === "compatible" &&
    featureSet.has("snapshot") &&
    featureSet.has("terminal_attach"),
  );
  const spaces = source.profile.enabled && source.snapshot
    ? buildSpaces(source, id)
    : [];
  return {
    id,
    kind: "host",
    parentId: null,
    hostKey: source.profile.profileId,
    source,
    stale: source.snapshot !== null && source.connectionState !== "compatible",
    actionable,
    spaces,
  };
}

function buildSpaces(source: WorldRuntimeSource, hostId: string): WorldSpaceNode[] {
  if (!source.snapshot) return [];
  const tabsByWorkspace = new Map<string, TabInfo[]>();
  const panesByWorkspace = new Map<string, PaneInfo[]>();
  for (const tab of source.snapshot.tabs) {
    const tabs = tabsByWorkspace.get(tab.workspace_id) ?? [];
    tabs.push(tab);
    tabsByWorkspace.set(tab.workspace_id, tabs);
  }
  for (const pane of source.snapshot.panes) {
    const panes = panesByWorkspace.get(pane.workspace_id) ?? [];
    panes.push(pane);
    panesByWorkspace.set(pane.workspace_id, panes);
  }
  return source.snapshot.workspaces.map((workspace) => {
    const workspaceRef = qualifyRuntimeTarget(
      source.profile.profileId,
      "workspace",
      workspace.workspace_id,
    );
    const id = qualifiedRuntimeKey(workspaceRef);
    const tabs = (tabsByWorkspace.get(workspace.workspace_id) ?? []).map((tab): WorldTab => {
      const tabRef = qualifyRuntimeTarget(source.profile.profileId, "tab", tab.tab_id);
      return {
        id: qualifiedRuntimeKey(tabRef),
        hostKey: source.profile.profileId,
        spaceId: id,
        tabRef,
        tab,
      };
    });
    const children = (panesByWorkspace.get(workspace.workspace_id) ?? [])
      .map((pane) => buildLeaf(source.profile.profileId, id, pane));
    return {
      id,
      kind: "space",
      parentId: hostId,
      hostKey: source.profile.profileId,
      workspaceRef,
      workspace,
      tabs,
      children,
    };
  });
}

function buildLeaf(profileId: string, spaceId: string, pane: PaneInfo): WorldLeafNode {
  const paneRef = qualifyRuntimeTarget(profileId, "pane", pane.pane_id);
  const terminalRef = qualifyRuntimeTarget(profileId, "terminal", pane.terminal_id);
  const tabRef = qualifyRuntimeTarget(profileId, "tab", pane.tab_id);
  const agent = isAgentPane(pane);
  return {
    id: qualifiedRuntimeKey(terminalRef),
    kind: agent ? "agent" : "terminal",
    parentId: spaceId,
    hostKey: profileId,
    paneRef,
    terminalRef,
    tabRef,
    pane,
    agentKind: agent ? agentIconKind(pane) : null,
  };
}

function compareSources(left: WorldRuntimeSource, right: WorldRuntimeSource) {
  return (
    left.profile.displayOrder - right.profile.displayOrder ||
    left.profile.profileId.localeCompare(right.profile.profileId)
  );
}
