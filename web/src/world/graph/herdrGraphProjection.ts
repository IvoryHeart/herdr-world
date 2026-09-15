import type { AgentIconKind } from "../../AgentIcon";
import { qualifiedRuntimeKey } from "../../runtimeIdentity";
import type { QualifiedTarget } from "../../runtimeIdentity";
import type { HostConnectionState } from "../../runtimeClient";
import type { AgentStatus, WorkspaceInfo } from "../../types";
import type { OfficeHandoffRequest } from "../herdrOfficeHandoff";
import type {
  WorldHostNode,
  WorldLeafNode,
  WorldModel,
  WorldModelNodeKind,
  WorldSpaceNode,
} from "../worldModel";

export const GRAPH_PRESENTATION_BOUNDS = Object.freeze({
  hosts: 128,
  spaces: 128,
  childrenPerSpace: 16,
});

const MAX_VISIBLE_LABEL = 80;
const MAX_STATE_LABEL = 96;
const MAX_TASK_SUMMARY = 160;

export type WorldGraphNode = {
  id: string;
  kind: WorldModelNodeKind;
  parentId: string | null;
  hostKey: string;
  hostLabel: string;
  label: string;
  subtitle?: string;
  modelLabel?: string;
  taskSummary?: string;
  stateLabel?: string;
  status: AgentStatus;
  focused: boolean;
  stale: boolean;
  disconnected: boolean;
  connectionState: HostConnectionState;
  actionable: boolean;
  selectionKey: string;
  omittedChildCount: number;
  searchText: string;
  handoff: OfficeHandoffRequest | null;
  paneId: string | null;
  observedGeneration: string;
  agentKind: AgentIconKind | null;
};

export type WorldGraphEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains" | "reports-to";
};

export type WorldGraphSpace = {
  node: WorldGraphNode;
  children: WorldGraphNode[];
  observedChildCount: number;
  omittedChildCount: number;
};

export type WorldGraphHost = {
  node: WorldGraphNode;
  spaces: WorldGraphSpace[];
  observedSpaceCount: number;
  omittedSpaceCount: number;
};

export type HerdrGraphProjection = {
  version: 1;
  nodes: WorldGraphNode[];
  edges: WorldGraphEdge[];
  hosts: WorldGraphHost[];
  spaces: WorldGraphSpace[];
  omittedHostCount: number;
  omittedSpaceCount: number;
  coverage: {
    configuredHosts: number;
    observedHosts: number;
    presentedHosts: number;
    omittedHosts: number;
    observedSpaces: number;
    presentedSpaces: number;
    observedAgents: number;
    presentedAgents: number;
    omittedAgents: number;
    omittedAgentsInPresentedSpaces: number;
    omittedAgentsInOmittedSpaces: number;
    observedTerminals: number;
    presentedTerminals: number;
    omittedTerminals: number;
    observedShells: number;
    presentedShells: number;
    status: Record<AgentStatus, number>;
  };
  presentationBounds: typeof GRAPH_PRESENTATION_BOUNDS;
};

type SpaceCandidate = {
  host: WorldHostNode;
  space: WorldSpaceNode;
  sourceIndex: number;
  childCount: number;
  agentCount: number;
  focused: boolean;
  attention: boolean;
  status: Record<AgentStatus, number>;
};

export function projectHerdrGraph(model: WorldModel): HerdrGraphProjection {
  const observedStatus = emptyStatusCounts();
  let observedAgents = 0;
  for (const leaf of model.leaves) {
    if (leaf.kind !== "agent") continue;
    observedAgents += 1;
    observedStatus[leaf.pane.agent_status] += 1;
  }

  const presentedModelHosts = model.hosts.slice(0, GRAPH_PRESENTATION_BOUNDS.hosts);
  const hostById = new Map(presentedModelHosts.map((host) => [host.id, host]));
  const candidates = model.spaces
    .flatMap((space, sourceIndex) => {
      const host = hostById.get(space.parentId);
      return host ? [spaceCandidate(host, space, sourceIndex)] : [];
    })
    .sort(compareSpaces);
  const presentedCandidates = candidates.slice(0, GRAPH_PRESENTATION_BOUNDS.spaces);
  const graphSpaceById = new Map(
    presentedCandidates.map((candidate) => {
      const projected = projectSpace(candidate);
      return [projected.node.id, projected] as const;
    }),
  );
  const hosts = presentedModelHosts.map((host) => projectHost(
    host,
    host.spaces.flatMap((space) => {
      const projected = graphSpaceById.get(space.id);
      return projected ? [projected] : [];
    }),
  ));
  const spaces = hosts.flatMap(({ spaces: hostSpaces }) => hostSpaces);
  const nodes = hosts.flatMap(({ node, spaces: hostSpaces }) => [
    node,
    ...hostSpaces.flatMap(({ node: space, children }) => [space, ...children]),
  ]);
  const edges = hosts.flatMap(({ node: host, spaces: hostSpaces }) => [
    ...hostSpaces.map(({ node: space }): WorldGraphEdge => ({
      sourceId: host.id,
      targetId: space.id,
      kind: "contains",
    })),
    ...hostSpaces.flatMap(({ node: space, children }) => children.map((child): WorldGraphEdge => ({
      sourceId: space.id,
      targetId: child.id,
      kind: "contains",
    }))),
  ]);
  const presentedChildren = spaces.flatMap(({ children }) => children);
  const presentedAgents = presentedChildren.filter(({ kind }) => kind === "agent");
  const omittedAgentsInPresentedSpaces = spaces.reduce((total, space) => {
    const modelSpace = model.nodeById.get(space.node.id);
    const observed = modelSpace?.kind === "space"
      ? modelSpace.children.filter(({ kind }) => kind === "agent").length
      : 0;
    const shown = space.children.filter(({ kind }) => kind === "agent").length;
    return total + Math.max(0, observed - shown);
  }, 0);
  const presentedSpaceIds = new Set(spaces.map(({ node }) => node.id));
  const omittedAgentsInOmittedSpaces = model.spaces
    .filter(({ id }) => !presentedSpaceIds.has(id))
    .reduce(
      (total, space) => total + space.children.filter(({ kind }) => kind === "agent").length,
      0,
    );
  const observedTerminals = model.leaves.length;

  return {
    version: 1,
    nodes,
    edges,
    hosts,
    spaces,
    omittedHostCount: Math.max(0, model.hosts.length - hosts.length),
    omittedSpaceCount: Math.max(0, model.spaces.length - spaces.length),
    coverage: {
      configuredHosts: model.hosts.length,
      observedHosts: model.hosts.filter(({ source }) => source.snapshot !== null).length,
      presentedHosts: hosts.length,
      omittedHosts: Math.max(0, model.hosts.length - hosts.length),
      observedSpaces: model.spaces.length,
      presentedSpaces: spaces.length,
      observedAgents,
      presentedAgents: presentedAgents.length,
      omittedAgents: Math.max(0, observedAgents - presentedAgents.length),
      omittedAgentsInPresentedSpaces,
      omittedAgentsInOmittedSpaces,
      observedTerminals,
      presentedTerminals: presentedChildren.length,
      omittedTerminals: Math.max(0, observedTerminals - presentedChildren.length),
      observedShells: observedTerminals - observedAgents,
      presentedShells: presentedChildren.length - presentedAgents.length,
      status: observedStatus,
    },
    presentationBounds: GRAPH_PRESENTATION_BOUNDS,
  };
}

function spaceCandidate(
  host: WorldHostNode,
  space: WorldSpaceNode,
  sourceIndex: number,
): SpaceCandidate {
  const status = emptyStatusCounts();
  let attention = false;
  let agentCount = 0;
  let focused = space.workspace.focused;
  for (const child of space.children) {
    status[child.pane.agent_status] += 1;
    attention ||= isAttentionStatus(child.pane.agent_status);
    agentCount += Number(child.kind === "agent");
    focused ||= child.pane.focused;
  }
  return {
    host,
    space,
    sourceIndex,
    childCount: space.children.length,
    agentCount,
    focused,
    attention,
    status,
  };
}

function projectHost(modelHost: WorldHostNode, spaces: WorldGraphSpace[]): WorldGraphHost {
  const { source } = modelHost;
  const label = boundedLabel(source.profile.label, "Host");
  const node: WorldGraphNode = {
    id: modelHost.id,
    kind: "host",
    parentId: null,
    hostKey: modelHost.hostKey,
    hostLabel: label,
    label,
    subtitle: source.location === "local" ? "Local host" : "Remote host",
    status: aggregateNodeStatus(modelHost.spaces.flatMap(({ children }) => children)),
    focused: modelHost.spaces.some(({ workspace, children }) =>
      workspace.focused || children.some(({ pane }) => pane.focused)),
    stale: modelHost.stale,
    disconnected: source.connectionState === "offline",
    connectionState: source.connectionState,
    actionable: false,
    selectionKey: source.profile.profileId,
    omittedChildCount: Math.max(0, modelHost.spaces.length - spaces.length),
    searchText: searchable([
      label,
      source.location,
      source.connectionState,
      modelHost.stale ? "stale" : undefined,
      source.connectionState === "offline" ? "disconnected" : undefined,
    ]),
    handoff: null,
    paneId: null,
    observedGeneration: source.generationKey ?? "",
    agentKind: null,
  };
  return {
    node,
    spaces,
    observedSpaceCount: modelHost.spaces.length,
    omittedSpaceCount: node.omittedChildCount,
  };
}

function projectSpace(candidate: SpaceCandidate): WorldGraphSpace {
  const { host, space } = candidate;
  const { source } = host;
  const hostLabel = boundedLabel(source.profile.label, "Host");
  const label = boundedLabel(space.workspace.label, "Workspace");
  const subtitle = boundedOptionalLabel(space.workspace.worktree?.repo_name, MAX_VISIBLE_LABEL);
  const retained = [...space.children]
    .map((leaf, sourceIndex) => ({ leaf, sourceIndex }))
    .sort(compareChildren)
    .slice(0, GRAPH_PRESENTATION_BOUNDS.childrenPerSpace);
  const node: WorldGraphNode = {
    id: space.id,
    kind: "space",
    parentId: host.id,
    hostKey: host.hostKey,
    hostLabel,
    label,
    ...(subtitle ? { subtitle } : {}),
    status: aggregateSpaceStatus(space.workspace, candidate.status),
    focused: candidate.focused,
    stale: host.stale,
    disconnected: source.connectionState === "offline",
    connectionState: source.connectionState,
    actionable: host.actionable,
    selectionKey: space.id,
    omittedChildCount: Math.max(0, candidate.childCount - retained.length),
    searchText: searchable([
      label,
      subtitle,
      hostLabel,
      source.connectionState,
      host.stale ? "stale" : undefined,
      source.connectionState === "offline" ? "disconnected" : undefined,
    ]),
    handoff: host.actionable
      ? roomHandoff(space.id, host.hostKey, source.generationKey ?? "", space.workspaceRef)
      : null,
    paneId: null,
    observedGeneration: source.generationKey ?? "",
    agentKind: null,
  };
  const children = retained.map(({ leaf }) => projectChild(host, node, leaf));
  return {
    node,
    children,
    observedChildCount: candidate.childCount,
    omittedChildCount: node.omittedChildCount,
  };
}

function projectChild(
  host: WorldHostNode,
  parent: WorldGraphNode,
  leaf: WorldLeafNode,
): WorldGraphNode {
  const { pane } = leaf;
  const agent = leaf.kind === "agent";
  const label = boundedLabel(
    agent
      ? pane.display_agent || pane.agent || pane.label || pane.title
      : pane.label || pane.title || pane.terminal_title_stripped || pane.terminal_title,
    agent ? "Agent" : "Shell",
  );
  const modelLabel = agent ? boundedOptionalLabel(pane.agent, MAX_VISIBLE_LABEL) : undefined;
  const taskSummary = boundedOptionalLabel(pane.task_summary, MAX_TASK_SUMMARY);
  const stateLabel = boundedOptionalLabel(pane.state_labels?.[pane.agent_status], MAX_STATE_LABEL);
  const { source } = host;
  return {
    id: leaf.id,
    kind: leaf.kind,
    parentId: parent.id,
    hostKey: parent.hostKey,
    hostLabel: parent.hostLabel,
    label,
    ...(modelLabel ? { modelLabel } : {}),
    ...(taskSummary ? { taskSummary } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    status: pane.agent_status,
    focused: pane.focused,
    stale: host.stale,
    disconnected: source.connectionState === "offline",
    connectionState: source.connectionState,
    actionable: host.actionable,
    selectionKey: qualifiedRuntimeKey(leaf.terminalRef),
    omittedChildCount: 0,
    searchText: searchable([
      label,
      modelLabel,
      taskSummary,
      stateLabel,
      parent.label,
      parent.subtitle,
      parent.hostLabel,
      source.connectionState,
      host.stale ? "stale" : undefined,
      source.connectionState === "offline" ? "disconnected" : undefined,
      agent ? "agent running" : "empty shell",
    ]),
    handoff: null,
    paneId: pane.pane_id,
    observedGeneration: source.generationKey ?? "",
    agentKind: leaf.agentKind,
  };
}

function compareSpaces(left: SpaceCandidate, right: SpaceCandidate) {
  return (
    Number(right.focused) - Number(left.focused) ||
    Number(right.attention) - Number(left.attention) ||
    Number(right.agentCount > 0) - Number(left.agentCount > 0) ||
    right.agentCount - left.agentCount ||
    left.host.source.profile.displayOrder - right.host.source.profile.displayOrder ||
    left.host.hostKey.localeCompare(right.host.hostKey) ||
    left.space.workspace.number - right.space.workspace.number ||
    left.sourceIndex - right.sourceIndex ||
    left.space.workspace.workspace_id.localeCompare(right.space.workspace.workspace_id)
  );
}

function compareChildren(
  left: { leaf: WorldLeafNode; sourceIndex: number },
  right: { leaf: WorldLeafNode; sourceIndex: number },
) {
  return (
    Number(right.leaf.pane.focused) - Number(left.leaf.pane.focused) ||
    Number(isAttentionStatus(right.leaf.pane.agent_status)) -
      Number(isAttentionStatus(left.leaf.pane.agent_status)) ||
    Number(right.leaf.kind === "agent") - Number(left.leaf.kind === "agent") ||
    left.sourceIndex - right.sourceIndex ||
    left.leaf.pane.pane_id.localeCompare(right.leaf.pane.pane_id)
  );
}

function aggregateNodeStatus(leaves: readonly WorldLeafNode[]): AgentStatus {
  const counts = emptyStatusCounts();
  for (const leaf of leaves) counts[leaf.pane.agent_status] += 1;
  for (const candidate of ["blocked", "working", "done", "idle"] as const) {
    if (counts[candidate] > 0) return candidate;
  }
  return "unknown";
}

function aggregateSpaceStatus(
  workspace: WorkspaceInfo,
  counts: Readonly<Record<AgentStatus, number>>,
): AgentStatus {
  for (const candidate of ["blocked", "working", "done", "idle"] as const) {
    if (counts[candidate] > 0) return candidate;
  }
  return workspace.agent_status;
}

function isAttentionStatus(status: AgentStatus) {
  return status === "working" || status === "blocked";
}

function roomHandoff(
  key: string,
  profileId: string,
  observedGeneration: string,
  workspaceRef: QualifiedTarget,
): OfficeHandoffRequest {
  return { kind: "room", key, profileId, observedGeneration, workspaceRef };
}

function emptyStatusCounts(): Record<AgentStatus, number> {
  return { idle: 0, working: 0, blocked: 0, done: 0, unknown: 0 };
}

function searchable(values: Array<string | undefined>) {
  return values.filter(Boolean).join("\n").toLocaleLowerCase();
}

function boundedOptionalLabel(value: string | null | undefined, limit: number) {
  const normalized = value?.trim();
  return normalized ? boundedLabel(normalized, "", limit) : undefined;
}

function boundedLabel(value: string | null | undefined, fallback: string, limit = MAX_VISIBLE_LABEL) {
  const normalized = value?.trim() || fallback;
  const points = [...normalized];
  return points.length <= limit
    ? normalized
    : `${points.slice(0, Math.max(1, limit - 1)).join("")}…`;
}
