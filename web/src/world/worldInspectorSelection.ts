import { type WorkspaceSurfaceSelection } from "../App";
import { type ConnectionSummary } from "../api";
import { store } from "../store";
import {
  type InspectorView,
  type WorkspaceInspectorContext,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type WorkspaceInspectorRequest,
} from "../workspaceResource";
import { type WorldRuntimePriority } from "./runtimeStore";
import {
  type WorldHostObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";
import {
  worldInspectorWindowId,
  worldInspectorWindowIdForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

export function worldSelectionIsCurrent(
  selected: WorldObjectNode | null,
  current: WorldObjectNode | null | undefined,
) {
  return selected !== null && current?.generation === selected.generation;
}

export function worldNodeForWorkspaceSurfaceSelection(
  world: WorldObject,
  selection: WorkspaceSurfaceSelection,
): WorldObjectNode | null {
  return (
    world.nodes.find((candidate) => {
      if (
        !candidate.actionable ||
        candidate.connectionId !== selection.connectionId ||
        candidate.generation !== selection.runtimeGeneration
      ) {
        return false;
      }
      if (selection.paneId) {
        return (
          (candidate.kind === "agent" || candidate.kind === "terminal") &&
          candidate.nativeId === selection.paneId &&
          candidate.workspaceId === selection.workspaceId
        );
      }
      return (
        candidate.kind === "space" &&
        candidate.nativeId === selection.workspaceId
      );
    }) ?? null
  );
}

export function worldNodeForInspectorConversation(
  world: WorldObject,
  conversation: WorldInspectorConversation,
): WorldObjectNode | null {
  const valid = (node: WorldObjectNode) =>
    node.actionable &&
    node.connectionId === conversation.connectionId &&
    node.generation === conversation.runtimeGeneration &&
    worldInspectorWindowIdForNode(node) ===
      worldInspectorWindowId(conversation);
  const selected = world.nodeById.get(conversation.nodeId);
  if (selected && valid(selected)) return selected;
  if (!conversation.tabId) return null;
  const siblings = world.leaves.filter(valid);
  return siblings.find((node) => node.focused) ?? siblings[0] ?? null;
}

export function worldNodeForInspectorPaneFocus(
  world: WorldObject,
  conversation: WorldInspectorConversation,
  paneId: string,
) {
  if (!conversation.tabId) return null;
  const windowId = worldInspectorWindowId(conversation);
  return (
    world.leaves.find(
      (node) =>
        node.nativeId === paneId &&
        node.actionable &&
        worldInspectorWindowIdForNode(node) === windowId,
    ) ?? null
  );
}

export function worldIntentViews(node: WorldObjectNode): InspectorView[] {
  if (node.kind === "host") return [];
  return [
    ...(node.capabilities.openTerminal ? (["terminal"] as const) : []),
    ...(node.capabilities.files ? (["files"] as const) : []),
    ...(node.capabilities.changes ? (["changes"] as const) : []),
    ...(node.kind === "agent" && node.capabilities.agentHistory
      ? (["history"] as const)
      : []),
  ];
}

export function worldInspectorContext(
  node: WorldObjectNode,
): WorkspaceInspectorContext | null {
  if (node.kind === "host") return null;
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  const statusLabel = leaf
    ? (leaf.stateLabels[leaf.status] ?? leaf.status)
    : hostStateLabel(node.hostState);
  return {
    kind: node.kind,
    label: node.label,
    stateLabel: statusLabel,
    locationLabel: leaf
      ? `${leaf.spaceLabel} · ${node.hostLabel}`
      : node.hostLabel,
    ...(leaf?.kind === "agent" ? { agent: leaf.pane.agent } : {}),
    ...(leaf?.taskSummary ? { taskSummary: leaf.taskSummary } : {}),
  };
}

export function worldIntentInitialView(
  node: WorldObjectNode,
  preferred: InspectorView | null,
): InspectorView | null {
  const views = worldIntentViews(node);
  if (preferred && views.includes(preferred)) return preferred;
  if (views.includes("terminal")) return "terminal";
  return views[0] ?? null;
}

export function worldSnapshotPriorityForNode(
  node: WorldObjectNode,
): WorldRuntimePriority | null {
  if (node.kind === "host") return null;
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return {
    connectionId: node.connectionId,
    workspaceId: leaf?.workspaceId ?? node.nativeId,
    ...(leaf ? { paneId: leaf.nativeId, terminalId: leaf.terminalId } : {}),
  };
}

export function snapshotPriorityForConversation(
  conversation: WorldInspectorConversation,
): WorldRuntimePriority {
  return {
    connectionId: conversation.connectionId,
    workspaceId: conversation.workspaceId,
    ...(conversation.paneId ? { paneId: conversation.paneId } : {}),
    ...(conversation.terminalId ? { terminalId: conversation.terminalId } : {}),
  };
}

export function snapshotPriorityForSurface(
  selection: WorkspaceSurfaceSelection,
): WorldRuntimePriority {
  return {
    connectionId: selection.connectionId,
    workspaceId: selection.workspaceId,
    ...(selection.paneId ? { paneId: selection.paneId } : {}),
  };
}

export function hasValidSelectedConnection(
  activeConnectionId: string,
  connections: readonly Pick<ConnectionSummary, "id">[],
) {
  return connections.some(({ id }) => id === activeConnectionId);
}

export function chooseWorldSelectedConnection({
  activeConnectionId,
  defaultConnectionId,
  storedConnectionId,
  connections,
}: {
  activeConnectionId: string;
  defaultConnectionId: string;
  storedConnectionId: string | null;
  connections: readonly Pick<ConnectionSummary, "id">[];
}): string | null {
  const ids = new Set(connections.map(({ id }) => id));
  if (storedConnectionId && ids.has(storedConnectionId)) {
    return storedConnectionId;
  }
  if (ids.has(defaultConnectionId)) return defaultConnectionId;
  if (ids.has(activeConnectionId)) return activeConnectionId;
  return null;
}

export function selectedHostStatusLabel(
  host: Pick<WorldHostObject, "label" | "hostState"> | null,
) {
  return host
    ? `${host.label} · ${hostStateLabel(host.hostState)}`
    : "No host selected";
}

export function shouldCloseWorldInspector(node: WorldObjectNode | null) {
  return node !== null && !node.actionable;
}

function hostStateLabel(state: WorldObjectNode["hostState"]) {
  switch (state) {
    case "active":
      return "Active";
    case "ready-inactive":
      return "Ready · inactive";
    case "reconnecting":
      return "Reconnecting";
    case "offline-stale":
      return "Offline · stale";
  }
}

function workspaceTarget(node: WorldObjectNode) {
  if (node.kind === "space")
    return { workspaceId: node.nativeId, paneId: null };
  if (node.kind === "agent" || node.kind === "terminal") {
    return { workspaceId: node.workspaceId, paneId: node.nativeId };
  }
  return null;
}

type WorldFocusStore = {
  get(): {
    activeConnectionId: string;
    connectionGeneration?: number;
    serverRuntimeGeneration: number | null;
    connections: Array<{
      id: string;
      state: string;
      generation: number;
    }>;
  };
  selectConnection(connectionId: string): boolean;
  refresh(): Promise<unknown>;
  focusQualifiedTarget(target: {
    connectionId: string;
    runtimeGeneration: number;
    workspaceId: string;
    paneId: string | null;
  }): Promise<boolean>;
};

type WorldEventTarget = Pick<EventTarget, "dispatchEvent">;

export async function dispatchWorldInspectorRequest(
  node: WorldObjectNode,
  view: InspectorView,
  focusStore: WorldFocusStore = store,
  eventTarget: WorldEventTarget = window,
  onAdmitted: () => void = () => {},
) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
  const availableViews = worldIntentViews(node);
  if (!availableViews.includes(view)) {
    throw new Error(`${view} is not available for this selection`);
  }
  await focusWorldNode(node, focusStore);
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
  const connectionGeneration = focusStore.get().connectionGeneration;
  if (
    typeof connectionGeneration !== "number" ||
    !Number.isSafeInteger(connectionGeneration)
  ) {
    throw new Error("The browser connection changed while it was opening");
  }
  onAdmitted();
  eventTarget.dispatchEvent(
    new CustomEvent<WorkspaceInspectorRequest>(
      WORKSPACE_INSPECTOR_REQUEST_EVENT,
      {
        detail: {
          connectionId: node.connectionId,
          generation: connectionGeneration,
          workspaceId: target.workspaceId,
          view,
          ...(target.paneId ? { originPaneId: target.paneId } : {}),
          availableViews,
        },
      },
    ),
  );
}

function worldNodeLeaseIsCurrent(
  node: WorldObjectNode,
  focusStore: WorldFocusStore,
) {
  const snapshot = focusStore.get();
  const connection = snapshot.connections.find(
    (candidate) => candidate.id === node.connectionId,
  );
  return (
    connection?.state === "ready" &&
    connection.generation === node.generation &&
    node.actionable
  );
}

export async function focusWorldNode(
  node: WorldObjectNode,
  focusStore: WorldFocusStore = store,
  agentSessionId?: string,
) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
  const connection = focusStore
    .get()
    .connections.find((candidate) => candidate.id === node.connectionId);
  if (
    !connection ||
    connection.state !== "ready" ||
    connection.generation !== node.generation ||
    !node.actionable
  ) {
    throw new Error("The selected host generation is no longer available");
  }
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
  const focused = await focusStore.focusQualifiedTarget({
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    workspaceId: target.workspaceId,
    paneId: target.paneId,
    ...(agentSessionId ? { agentSessionId } : {}),
  });
  if (!focused) {
    throw new Error("The selected item could not be focused");
  }
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
}

export async function activateWorldNodeHost(
  node: WorldObjectNode,
  focusStore: WorldFocusStore = store,
) {
  if (!node.capabilities.activateHost) {
    throw new Error(`${node.hostLabel} is not ready for activation`);
  }
  const connection = focusStore
    .get()
    .connections.find((candidate) => candidate.id === node.connectionId);
  if (
    !connection ||
    connection.state !== "ready" ||
    connection.generation !== node.generation
  ) {
    throw new Error("The observed host generation is no longer ready");
  }
  if (!focusStore.selectConnection(node.connectionId)) {
    throw new Error("The selected host could not be activated");
  }
  await focusStore.refresh();
  const snapshot = focusStore.get();
  const current = snapshot.connections.find(
    (candidate) => candidate.id === node.connectionId,
  );
  if (
    snapshot.activeConnectionId !== node.connectionId ||
    snapshot.serverRuntimeGeneration !== node.generation ||
    current?.state !== "ready" ||
    current.generation !== node.generation
  ) {
    throw new Error("The host changed while it was being activated");
  }
}

/** Apply observed metadata only to the conversations present when it was read. */
export function reconcileObservedInspectors(
  current: readonly WorldInspectorConversation[],
  observed: readonly WorldInspectorConversation[],
  retained: readonly WorldInspectorConversation[],
) {
  const before = new Map(
    observed.map((conversation) => [
      worldInspectorWindowId(conversation),
      conversation,
    ]),
  );
  const after = new Map(
    retained.map((conversation) => [
      worldInspectorWindowId(conversation),
      conversation,
    ]),
  );
  return current.flatMap((conversation) => {
    const id = worldInspectorWindowId(conversation);
    if (before.get(id) !== conversation) return [conversation];
    const replacement = after.get(id);
    return replacement ? [replacement] : [];
  });
}
