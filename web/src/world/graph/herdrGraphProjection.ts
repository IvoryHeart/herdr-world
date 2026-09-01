import { isAgentPane } from "../../agentDetection";
import { agentIconKind } from "../../AgentIcon";
import type { AgentIconKind } from "../../AgentIcon";
import { qualifiedRuntimeKey, qualifyRuntimeTarget } from "../../runtimeIdentity";
import type { QualifiedTarget } from "../../runtimeIdentity";
import type { AgentStatus, PaneInfo, WorkspaceInfo } from "../../types";
import type { OfficeHandoffRequest } from "../herdrOfficeHandoff";
import type { HerdrOfficeSourceHost } from "../herdrOfficeProjection";

export const GRAPH_PRESENTATION_BOUNDS = Object.freeze({
  spaces: 128,
  terminalsPerSpace: 16,
});

const MAX_VISIBLE_LABEL = 80;
const MAX_STATE_LABEL = 96;
const MAX_TASK_SUMMARY = 160;

export type WorldGraphNode = {
  id: string;
  kind: "space" | "terminal";
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
  paneId: string | null;
  observedGeneration: string;
  agentRunning: boolean;
  agentKind: AgentIconKind | null;
};

export type WorldGraphEdge = {
  sourceId: string;
  targetId: string;
  kind: "contains" | "reports-to";
};

export type WorldGraphSpace = {
  node: WorldGraphNode;
  terminals: WorldGraphNode[];
  observedTerminalCount: number;
  omittedTerminalCount: number;
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
  source: HerdrOfficeSourceHost;
  workspace: WorkspaceInfo;
  terminals: Array<{ pane: PaneInfo; sourceIndex: number }>;
  sourceIndex: number;
  terminalCount: number;
  agentCount: number;
  focused: boolean;
  attention: boolean;
  status: Record<AgentStatus, number>;
};

export function projectHerdrGraph(
  sources: readonly HerdrOfficeSourceHost[],
): HerdrGraphProjection {
  const candidates: SpaceCandidate[] = [];
  const orderedSources = sortedSources(sources);
  const observedStatus = emptyStatusCounts();
  let observedTerminals = 0;
  let observedAgents = 0;
  for (const source of orderedSources) {
    if (!source.profile.enabled || !source.snapshot) {
      continue;
    }
    const candidatesByWorkspace = new Map<string, SpaceCandidate>();
    for (const [sourceIndex, workspace] of source.snapshot.workspaces.entries()) {
      const candidate: SpaceCandidate = {
        source,
        workspace,
        sourceIndex,
        terminals: [],
        terminalCount: 0,
        agentCount: 0,
        focused: workspace.focused,
        attention: false,
        status: emptyStatusCounts(),
      };
      candidates.push(candidate);
      candidatesByWorkspace.set(workspace.workspace_id, candidate);
    }
    for (const pane of source.snapshot.panes) {
      const candidate = candidatesByWorkspace.get(pane.workspace_id);
      if (!candidate) continue;
      const agent = isAgentPane(pane);
      candidate.terminalCount += 1;
      candidate.agentCount += Number(agent);
      candidate.focused ||= pane.focused;
      candidate.attention ||= isAttentionStatus(pane.agent_status);
      candidate.status[pane.agent_status] += 1;
      if (agent) {
        observedStatus[pane.agent_status] += 1;
      }
      observedTerminals += 1;
      observedAgents += Number(agent);
    }
  }
  candidates.sort(compareSpaces);

  const presentedCandidates = candidates.slice(0, GRAPH_PRESENTATION_BOUNDS.spaces);
  const presentedBySource = new Map<HerdrOfficeSourceHost, Map<string, SpaceCandidate>>();
  for (const candidate of presentedCandidates) {
    const byWorkspace = presentedBySource.get(candidate.source) ?? new Map();
    byWorkspace.set(candidate.workspace.workspace_id, candidate);
    presentedBySource.set(candidate.source, byWorkspace);
  }
  for (const source of orderedSources) {
    const byWorkspace = presentedBySource.get(source);
    if (!byWorkspace || !source.snapshot) continue;
    for (const [sourceIndex, pane] of source.snapshot.panes.entries()) {
      const candidate = byWorkspace.get(pane.workspace_id);
      if (candidate) retainPriorityTerminal(candidate.terminals, { pane, sourceIndex });
    }
  }
  const spaces = presentedCandidates.map(projectSpace);
  const nodes = spaces.flatMap(({ node, terminals }) => [node, ...terminals]);
  const edges = spaces.flatMap(({ node, terminals }) =>
    terminals.map((terminal): WorldGraphEdge => ({
      sourceId: node.id,
      targetId: terminal.id,
      kind: "contains",
    })),
  );
  const presentedTerminals = spaces.flatMap(({ terminals }) => terminals);
  const presentedAgents = presentedTerminals.filter(({ agentRunning }) => agentRunning);
  const omittedAgentsInPresentedSpaces = spaces.reduce((total, space, index) => {
    const candidateAgents = presentedCandidates[index]?.agentCount ?? 0;
    const shownAgents = space.terminals.filter(({ agentRunning }) => agentRunning).length;
    return total + Math.max(0, candidateAgents - shownAgents);
  }, 0);
  const omittedAgentsInOmittedSpaces = candidates
    .slice(GRAPH_PRESENTATION_BOUNDS.spaces)
    .reduce((total, candidate) => total + candidate.agentCount, 0);

  return {
    version: 1,
    nodes,
    edges,
    spaces,
    omittedSpaceCount: Math.max(0, candidates.length - GRAPH_PRESENTATION_BOUNDS.spaces),
    coverage: {
      observedSpaces: candidates.length,
      presentedSpaces: spaces.length,
      observedAgents,
      presentedAgents: presentedAgents.length,
      omittedAgents: Math.max(0, observedAgents - presentedAgents.length),
      omittedAgentsInPresentedSpaces,
      omittedAgentsInOmittedSpaces,
      observedTerminals,
      presentedTerminals: presentedTerminals.length,
      omittedTerminals: Math.max(0, observedTerminals - presentedTerminals.length),
      observedShells: observedTerminals - observedAgents,
      presentedShells: presentedTerminals.length - presentedAgents.length,
      status: observedStatus,
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
  const presentedTerminals = candidate.terminals;
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
    status: aggregateSpaceStatus(workspace, candidate.status),
    focused: candidate.focused,
    stale,
    disconnected: stale,
    actionable,
    selectionKey: id,
    omittedChildCount: Math.max(
      0,
      candidate.terminalCount - presentedTerminals.length,
    ),
    searchText: searchable([label, subtitle, hostLabel]),
    handoff: actionable
      ? roomHandoff(id, source.profile.profileId, source.generationKey ?? "", workspaceRef)
      : null,
    paneId: null,
    observedGeneration: source.generationKey ?? "",
    agentRunning: false,
    agentKind: null,
  };
  const terminals = presentedTerminals.map(({ pane }) => projectTerminal(source, node, pane));
  return {
    node,
    terminals,
    observedTerminalCount: candidate.terminalCount,
    omittedTerminalCount: node.omittedChildCount,
  };
}

function projectTerminal(
  source: HerdrOfficeSourceHost,
  parent: WorldGraphNode,
  pane: PaneInfo,
): WorldGraphNode {
  const paneRef = qualifyRuntimeTarget(source.profile.profileId, "pane", pane.pane_id);
  const terminalRef = qualifyRuntimeTarget(source.profile.profileId, "terminal", pane.terminal_id);
  const id = qualifiedRuntimeKey(paneRef);
  const selectionKey = qualifiedRuntimeKey(terminalRef);
  const agentRunning = isAgentPane(pane);
  const label = boundedLabel(
    agentRunning
      ? pane.display_agent || pane.agent || pane.label || pane.title
      : pane.label || pane.title || pane.terminal_title_stripped || pane.terminal_title,
    agentRunning ? "Agent" : "Shell",
  );
  const modelLabel = agentRunning
    ? boundedOptionalLabel(pane.agent, MAX_VISIBLE_LABEL)
    : undefined;
  const taskSummary = boundedOptionalLabel(pane.task_summary, MAX_TASK_SUMMARY);
  const stateLabel = boundedOptionalLabel(pane.state_labels?.[pane.agent_status], MAX_STATE_LABEL);
  const actionable = canOpenInSpaces(source);
  const stale = source.connectionState !== "compatible";
  return {
    id,
    kind: "terminal",
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
      agentRunning ? "agent running" : "empty shell",
    ]),
    handoff: null,
    paneId: pane.pane_id,
    observedGeneration: source.generationKey ?? "",
    agentRunning,
    agentKind: agentRunning ? agentIconKind(pane) : null,
  };
}

function sortedSources(sources: readonly HerdrOfficeSourceHost[]) {
  return [...sources].sort((left, right) =>
    left.profile.displayOrder - right.profile.displayOrder ||
    left.profile.profileId.localeCompare(right.profile.profileId),
  );
}

function compareSpaces(left: SpaceCandidate, right: SpaceCandidate) {
  return (
    Number(right.focused) - Number(left.focused) ||
    Number(right.attention) - Number(left.attention) ||
    left.source.profile.displayOrder - right.source.profile.displayOrder ||
    left.source.profile.profileId.localeCompare(right.source.profile.profileId) ||
    left.workspace.number - right.workspace.number ||
    left.sourceIndex - right.sourceIndex ||
    left.workspace.workspace_id.localeCompare(right.workspace.workspace_id)
  );
}

function retainPriorityTerminal(
  terminals: Array<{ pane: PaneInfo; sourceIndex: number }>,
  candidate: { pane: PaneInfo; sourceIndex: number },
) {
  const index = terminals.findIndex((current) => compareTerminals(candidate, current) < 0);
  terminals.splice(index < 0 ? terminals.length : index, 0, candidate);
  if (terminals.length > GRAPH_PRESENTATION_BOUNDS.terminalsPerSpace) terminals.pop();
}

function compareTerminals(
  left: { pane: PaneInfo; sourceIndex: number },
  right: { pane: PaneInfo; sourceIndex: number },
) {
  return (
    Number(right.pane.focused) - Number(left.pane.focused) ||
    Number(isAttentionStatus(right.pane.agent_status)) -
      Number(isAttentionStatus(left.pane.agent_status)) ||
    Number(isAgentPane(right.pane)) - Number(isAgentPane(left.pane)) ||
    left.sourceIndex - right.sourceIndex ||
    left.pane.pane_id.localeCompare(right.pane.pane_id)
  );
}

function aggregateSpaceStatus(
  workspace: WorkspaceInfo,
  counts: Readonly<Record<AgentStatus, number>>,
): AgentStatus {
  for (const candidate of ["blocked", "working", "done", "idle"] as const) {
    if (counts[candidate] > 0) {
      return candidate;
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

function emptyStatusCounts(): Record<AgentStatus, number> {
  return {
    idle: 0,
    working: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };
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
