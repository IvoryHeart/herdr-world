import type {
  InspectorDock,
  InspectorView,
  WorkspaceInspectorContext,
} from "../workspaceResource";
import type { WorldObjectNode } from "./worldObject";

/** One independently navigable Inspector backed by the shared app runtime. */
export type WorldInspectorConversation = {
  nodeId: string;
  connectionId: string;
  runtimeGeneration: number;
  resourceIdentity: string;
  workspaceId: string;
  paneId?: string;
  terminalId?: string;
  agentSessionFingerprint?: string;
  label: string;
  hostLabel: string;
  spaceLabel: string;
  context: WorkspaceInspectorContext;
  availableViews: InspectorView[];
  view: InspectorView;
  dock: InspectorDock;
  expanded: boolean;
  size: number;
};

export type WorldFloatingTerminal = {
  nodeId: string;
  connectionId: string;
  runtimeGeneration: number;
  paneId: string;
  terminalId: string;
  label: string;
  hostLabel: string;
  spaceLabel: string;
};

export type WorldTerminalPresentation = Pick<
  WorldInspectorConversation,
  | "nodeId"
  | "connectionId"
  | "runtimeGeneration"
  | "paneId"
  | "terminalId"
  | "label"
  | "hostLabel"
  | "spaceLabel"
> & {
  paneId: string;
  terminalId: string;
  portal: Element | null;
};

export const MAX_WORLD_FLOATING_INSPECTORS = 5;

export function upsertWorldInspectorConversation(
  current: readonly WorldInspectorConversation[],
  next: WorldInspectorConversation,
  limit = MAX_WORLD_FLOATING_INSPECTORS,
) {
  const retained = current.filter(
    (conversation) => !sameWorldInspector(conversation, next),
  );
  if (retained.length === current.length && retained.length >= limit) {
    return { conversations: current, admitted: false } as const;
  }
  return {
    conversations: [...retained, next],
    admitted: true,
  } as const;
}

export function retainWorldInspectorConversations(
  current: readonly WorldInspectorConversation[],
  lease: { connectionId: string; runtimeGeneration: number } | null,
) {
  if (!lease) return [];
  return current.filter(
    (conversation) =>
      conversation.connectionId === lease.connectionId &&
      conversation.runtimeGeneration === lease.runtimeGeneration,
  );
}

export function sameWorldInspector(
  left: Pick<
    WorldInspectorConversation,
    "connectionId" | "runtimeGeneration" | "nodeId"
  >,
  right: Pick<
    WorldInspectorConversation,
    "connectionId" | "runtimeGeneration" | "nodeId"
  >,
) {
  return (
    left.connectionId === right.connectionId &&
    left.runtimeGeneration === right.runtimeGeneration &&
    left.nodeId === right.nodeId
  );
}

export function reconcileWorldInspectorConversation(
  current: WorldInspectorConversation,
  observed: WorldInspectorConversation,
): WorldInspectorConversation {
  const sameResource = current.resourceIdentity === observed.resourceIdentity;
  const next: WorldInspectorConversation = {
    ...observed,
    view:
      sameResource && observed.availableViews.includes(current.view)
        ? current.view
        : observed.view,
    dock: current.dock,
    expanded: current.expanded,
    size: current.size,
  };
  return inspectorConversationEqual(current, next) ? current : next;
}

function inspectorConversationEqual(
  left: WorldInspectorConversation,
  right: WorldInspectorConversation,
) {
  return (
    left.nodeId === right.nodeId &&
    left.connectionId === right.connectionId &&
    left.runtimeGeneration === right.runtimeGeneration &&
    left.resourceIdentity === right.resourceIdentity &&
    left.workspaceId === right.workspaceId &&
    left.paneId === right.paneId &&
    left.terminalId === right.terminalId &&
    left.agentSessionFingerprint === right.agentSessionFingerprint &&
    left.label === right.label &&
    left.hostLabel === right.hostLabel &&
    left.spaceLabel === right.spaceLabel &&
    left.view === right.view &&
    left.dock === right.dock &&
    left.expanded === right.expanded &&
    left.size === right.size &&
    left.availableViews.length === right.availableViews.length &&
    left.availableViews.every(
      (view, index) => view === right.availableViews[index],
    ) &&
    left.context.kind === right.context.kind &&
    left.context.label === right.context.label &&
    left.context.stateLabel === right.context.stateLabel &&
    left.context.locationLabel === right.context.locationLabel &&
    left.context.agent === right.context.agent &&
    left.context.taskSummary === right.context.taskSummary
  );
}

export function worldInspectorForNode(
  node: WorldObjectNode,
  view: InspectorView,
  availableViews: InspectorView[],
  context: WorkspaceInspectorContext,
  preferences: { dock: InspectorDock; expanded: boolean; size: number },
): WorldInspectorConversation | null {
  if (
    node.kind === "host" ||
    !node.actionable ||
    !node.selectedHost ||
    !availableViews.includes(view)
  ) {
    return null;
  }
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  const resourceIdentity = leaf
    ? JSON.stringify([
        node.connectionId,
        node.generation,
        leaf.workspaceId,
        leaf.nativeId,
        leaf.terminalId,
        leaf.kind,
        leaf.kind === "agent" ? leaf.pane.agent : null,
        leaf.agentSessionIdentity ?? null,
      ])
    : JSON.stringify([node.connectionId, node.generation, node.nativeId]);
  return {
    nodeId: node.id,
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    resourceIdentity,
    workspaceId: leaf?.workspaceId ?? node.nativeId,
    ...(leaf ? { paneId: leaf.nativeId, terminalId: leaf.terminalId } : {}),
    ...(leaf?.kind === "agent" && leaf.agentSessionFingerprint
      ? { agentSessionFingerprint: leaf.agentSessionFingerprint }
      : {}),
    label: node.label,
    hostLabel: node.hostLabel,
    spaceLabel: leaf?.spaceLabel ?? node.label,
    context,
    availableViews,
    view,
    ...preferences,
  };
}

// Temporary compatibility exports for focused tests and terminal portal code.
export const MAX_WORLD_FLOATING_TERMINALS = MAX_WORLD_FLOATING_INSPECTORS;

export function upsertWorldFloatingTerminal(
  current: readonly WorldFloatingTerminal[],
  next: WorldFloatingTerminal,
  limit = MAX_WORLD_FLOATING_INSPECTORS,
) {
  const retained = current.filter(
    (terminal) =>
      terminal.connectionId !== next.connectionId ||
      terminal.runtimeGeneration !== next.runtimeGeneration ||
      terminal.terminalId !== next.terminalId,
  );
  if (retained.length === current.length && retained.length >= limit) {
    return { terminals: current, admitted: false } as const;
  }
  return { terminals: [...retained, next], admitted: true } as const;
}

export function retainWorldFloatingTerminals<
  T extends {
    connectionId: string;
    runtimeGeneration: number;
  },
>(
  current: readonly T[],
  lease: { connectionId: string; runtimeGeneration: number } | null,
) {
  if (!lease) return [];
  return current.filter(
    (conversation) =>
      conversation.connectionId === lease.connectionId &&
      conversation.runtimeGeneration === lease.runtimeGeneration,
  );
}

export function floatingTerminalForNode(
  node: WorldObjectNode,
): WorldInspectorConversation | null {
  if (
    (node.kind !== "agent" && node.kind !== "terminal") ||
    !node.capabilities.openTerminal
  ) {
    return null;
  }
  return worldInspectorForNode(
    node,
    "terminal",
    ["terminal"],
    {
      kind: node.kind,
      label: node.label,
      stateLabel: node.stateLabels[node.status] ?? node.status,
      locationLabel: `${node.spaceLabel} · ${node.hostLabel}`,
      ...(node.kind === "agent" ? { agent: node.pane.agent } : {}),
      ...(node.taskSummary ? { taskSummary: node.taskSummary } : {}),
    },
    { dock: "right", expanded: false, size: 520 },
  );
}
