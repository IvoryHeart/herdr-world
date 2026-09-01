import { isAgentPane } from "../../agentDetection";
import { qualifiedRuntimeKey, qualifyRuntimeTarget } from "../../runtimeIdentity";
import type { QualifiedTarget } from "../../runtimeIdentity";
import type { AgentStatus, PaneInfo, WorkspaceInfo } from "../../types";
import type { OfficeHandoffRequest } from "../herdrOfficeHandoff";
import type { HerdrOfficeSourceHost } from "../herdrOfficeProjection";

export const GRAPH_PRESENTATION_BOUNDS = Object.freeze({
  spaces: 128,
  agentsPerSpace: 16,
});

const MAX_VISIBLE_LABEL = 80;
const MAX_STATE_LABEL = 96;
const MAX_TASK_SUMMARY = 160;

export type WorldGraphNode = {
  id: string;
  kind: "space" | "agent";
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
  actionable: boolean;
  selectionKey: string;
  omittedChildCount: number;
  searchText: string;
  handoff: OfficeHandoffRequest | null;
};

export type WorldGraphEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains" | "reports-to";
};

export type WorldGraphSpace = {
  node: WorldGraphNode;
  agents: WorldGraphNode[];
  observedAgentCount: number;
  omittedAgentCount: number;
};

export type HerdrGraphProjection = {
  version: 1;
  nodes: WorldGraphNode[];
  edges: WorldGraphEdge[];
  spaces: WorldGraphSpace[];
  omittedSpaceCount: number;
  coverage: {
    observedSpaces: number;
    presentedSpaces: number;
    observedAgents: number;
    presentedAgents: number;
    omittedAgents: number;
    omittedAgentsInPresentedSpaces: number;
    omittedAgentsInOmittedSpaces: number;
    status: Record<AgentStatus, number>;
  };
  presentationBounds: typeof GRAPH_PRESENTATION_BOUNDS;
};

type SpaceCandidate = {
  source: HerdrOfficeSourceHost;
  workspace: WorkspaceInfo;
  agents: Array<{ pane: PaneInfo; sourceIndex: number }>;
  sourceIndex: number;
};

export function projectHerdrGraph(
  sources: readonly HerdrOfficeSourceHost[],
): HerdrGraphProjection {
  const candidates = sortedSources(sources).flatMap((source) => {
    if (!source.profile.enabled || !source.snapshot) {
      return [];
    }
    return source.snapshot.workspaces.map((workspace, sourceIndex): SpaceCandidate => ({
      source,
      workspace,
      sourceIndex,
      agents: source.snapshot?.panes
        .map((pane, paneIndex) => ({ pane, sourceIndex: paneIndex }))
        .filter(({ pane }) => pane.workspace_id === workspace.workspace_id && isAgentPane(pane)) ?? [],
    }));
  });
  candidates.sort(compareSpaces);

  const presentedCandidates = candidates.slice(0, GRAPH_PRESENTATION_BOUNDS.spaces);
  const spaces = presentedCandidates.map(projectSpace);
  const nodes = spaces.flatMap(({ node, agents }) => [node, ...agents]);
  const edges = spaces.flatMap(({ node, agents }) =>
    agents.map((agent): WorldGraphEdge => ({
      sourceId: node.id,
      targetId: agent.id,
      kind: "contains",
    })),
  );
  const allAgents = candidates.flatMap(({ agents }) => agents.map(({ pane }) => pane));
  const presentedAgents = spaces.flatMap(({ agents }) => agents);
  const omittedAgentsInPresentedSpaces = spaces.reduce(
    (total, space) => total + space.omittedAgentCount,
    0,
  );
  const presentedSpaceIds = new Set(
    presentedCandidates.map(({ source, workspace }) =>
      qualifiedRuntimeKey(qualifyRuntimeTarget(
        source.profile.profileId,
        "workspace",
        workspace.workspace_id,
      )),
    ),
  );
  const omittedAgentsInOmittedSpaces = candidates.reduce((total, candidate) => {
    const id = qualifiedRuntimeKey(qualifyRuntimeTarget(
      candidate.source.profile.profileId,
      "workspace",
      candidate.workspace.workspace_id,
    ));
    return presentedSpaceIds.has(id) ? total : total + candidate.agents.length;
  }, 0);

  return {
    version: 1,
    nodes,
    edges,
    spaces,
    omittedSpaceCount: Math.max(0, candidates.length - GRAPH_PRESENTATION_BOUNDS.spaces),
    coverage: {
      observedSpaces: candidates.length,
      presentedSpaces: spaces.length,
      observedAgents: allAgents.length,
      presentedAgents: presentedAgents.length,
      omittedAgents: Math.max(0, allAgents.length - presentedAgents.length),
      omittedAgentsInPresentedSpaces,
      omittedAgentsInOmittedSpaces,
      status: countStatuses(allAgents),
    },
    presentationBounds: GRAPH_PRESENTATION_BOUNDS,
  };
}

function projectSpace(candidate: SpaceCandidate): WorldGraphSpace {
  const { source, workspace } = candidate;
  const workspaceRef = qualifyRuntimeTarget(
    source.profile.profileId,
    "workspace",
    workspace.workspace_id,
  );
  const id = qualifiedRuntimeKey(workspaceRef);
  const stale = source.connectionState !== "compatible";
  const actionable = canOpenInSpaces(source);
  const sortedAgents = [...candidate.agents].sort(compareAgents);
  const presentedAgents = sortedAgents.slice(0, GRAPH_PRESENTATION_BOUNDS.agentsPerSpace);
  const hostLabel = boundedLabel(source.profile.label, "Host");
  const label = boundedLabel(workspace.label, "Workspace");
  const subtitle = boundedOptionalLabel(workspace.worktree?.repo_name, MAX_VISIBLE_LABEL);
  const node: WorldGraphNode = {
    id,
    kind: "space",
    parentId: null,
    hostKey: source.profile.profileId,
    hostLabel,
    label,
    ...(subtitle ? { subtitle } : {}),
    status: aggregateSpaceStatus(workspace, candidate.agents.map(({ pane }) => pane)),
    focused: workspace.focused || candidate.agents.some(({ pane }) => pane.focused),
    stale,
    disconnected: stale,
    actionable,
    selectionKey: id,
    omittedChildCount: Math.max(
      0,
      sortedAgents.length - GRAPH_PRESENTATION_BOUNDS.agentsPerSpace,
    ),
    searchText: searchable([label, subtitle, hostLabel]),
    handoff: actionable
      ? roomHandoff(id, source.profile.profileId, source.generationKey ?? "", workspaceRef)
      : null,
  };
  const agents = presentedAgents.map(({ pane }) => projectAgent(source, node, pane));
  return {
    node,
    agents,
    observedAgentCount: sortedAgents.length,
    omittedAgentCount: node.omittedChildCount,
  };
}

function projectAgent(
  source: HerdrOfficeSourceHost,
  parent: WorldGraphNode,
  pane: PaneInfo,
): WorldGraphNode {
  const paneRef = qualifyRuntimeTarget(source.profile.profileId, "pane", pane.pane_id);
  const terminalRef = qualifyRuntimeTarget(source.profile.profileId, "terminal", pane.terminal_id);
  const id = qualifiedRuntimeKey(paneRef);
  const selectionKey = qualifiedRuntimeKey(terminalRef);
  const label = boundedLabel(pane.display_agent || pane.agent, "Agent");
  const modelLabel = boundedOptionalLabel(pane.agent, MAX_VISIBLE_LABEL);
  const taskSummary = boundedOptionalLabel(pane.task_summary, MAX_TASK_SUMMARY);
  const stateLabel = boundedOptionalLabel(pane.state_labels?.[pane.agent_status], MAX_STATE_LABEL);
  const actionable = canOpenInSpaces(source);
  const stale = source.connectionState !== "compatible";
  return {
    id,
    kind: "agent",
    parentId: parent.id,
    hostKey: parent.hostKey,
    hostLabel: parent.hostLabel,
    label,
    ...(modelLabel ? { modelLabel } : {}),
    ...(taskSummary ? { taskSummary } : {}),
    ...(stateLabel ? { stateLabel } : {}),
    status: pane.agent_status,
    focused: pane.focused,
    stale,
    disconnected: stale,
    actionable,
    selectionKey,
    omittedChildCount: 0,
    searchText: searchable([
      label,
      modelLabel,
      taskSummary,
      stateLabel,
      parent.label,
      parent.subtitle,
      parent.hostLabel,
    ]),
    handoff: actionable
      ? agentHandoff(
          selectionKey,
          source.profile.profileId,
          source.generationKey ?? "",
          terminalRef,
          paneRef,
        )
      : null,
  };
}

function sortedSources(sources: readonly HerdrOfficeSourceHost[]) {
  return [...sources].sort((left, right) =>
    left.profile.displayOrder - right.profile.displayOrder ||
    left.profile.profileId.localeCompare(right.profile.profileId),
  );
}

function compareSpaces(left: SpaceCandidate, right: SpaceCandidate) {
  const leftFocused = left.workspace.focused || left.agents.some(({ pane }) => pane.focused);
  const rightFocused = right.workspace.focused || right.agents.some(({ pane }) => pane.focused);
  const leftAttention = left.agents.some(({ pane }) => isAttentionStatus(pane.agent_status));
  const rightAttention = right.agents.some(({ pane }) => isAttentionStatus(pane.agent_status));
  return (
    Number(rightFocused) - Number(leftFocused) ||
    Number(rightAttention) - Number(leftAttention) ||
    left.source.profile.displayOrder - right.source.profile.displayOrder ||
    left.source.profile.profileId.localeCompare(right.source.profile.profileId) ||
    left.workspace.number - right.workspace.number ||
    left.sourceIndex - right.sourceIndex ||
    left.workspace.workspace_id.localeCompare(right.workspace.workspace_id)
  );
}

function compareAgents(
  left: { pane: PaneInfo; sourceIndex: number },
  right: { pane: PaneInfo; sourceIndex: number },
) {
  return (
    Number(right.pane.focused) - Number(left.pane.focused) ||
    Number(isAttentionStatus(right.pane.agent_status)) -
      Number(isAttentionStatus(left.pane.agent_status)) ||
    left.sourceIndex - right.sourceIndex ||
    left.pane.pane_id.localeCompare(right.pane.pane_id)
  );
}

function aggregateSpaceStatus(workspace: WorkspaceInfo, panes: readonly PaneInfo[]): AgentStatus {
  for (const status of ["blocked", "working", "done", "idle"] as const) {
    if (panes.some((pane) => pane.agent_status === status)) {
      return status;
    }
  }
  return workspace.agent_status;
}

function isAttentionStatus(status: AgentStatus) {
  return status === "working" || status === "blocked";
}

function canOpenInSpaces(source: HerdrOfficeSourceHost) {
  return Boolean(
    source.generationKey &&
    source.connectionState === "compatible" &&
    source.features.includes("snapshot") &&
    source.features.includes("terminal_attach"),
  );
}

function roomHandoff(
  key: string,
  profileId: string,
  observedGeneration: string,
  workspaceRef: QualifiedTarget,
): OfficeHandoffRequest {
  return { kind: "room", key, profileId, observedGeneration, workspaceRef };
}

function agentHandoff(
  key: string,
  profileId: string,
  observedGeneration: string,
  terminalRef: QualifiedTarget,
  currentPaneRef: QualifiedTarget,
): OfficeHandoffRequest {
  return {
    kind: "agent",
    key,
    profileId,
    observedGeneration,
    terminalRef,
    currentPaneRef,
  };
}

function countStatuses(panes: readonly PaneInfo[]): Record<AgentStatus, number> {
  const statuses: Record<AgentStatus, number> = {
    idle: 0,
    working: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };
  for (const pane of panes) {
    statuses[pane.agent_status] += 1;
  }
  return statuses;
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
