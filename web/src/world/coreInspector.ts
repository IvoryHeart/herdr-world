import type { State } from "../store/types";
import { connectionSnapshot } from "../store/sessions";
import type { WorldObject } from "./worldObject";
import { inspectorAdmits } from "./worldObject";
import {
  worldNodeForInspectorConversation,
  worldIntentInitialView,
  worldInspectorContext,
  worldIntentViews,
} from "./worldInspectorSelection";
import {
  worldInspectorForNode,
  reconcileWorldInspectorConversation,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

export function coreInspectorConversation(
  world: WorldObject,
  conversation: WorldInspectorConversation,
): WorldInspectorConversation[] | null {
  // A herdr-core window (Files and Changes only) lives as long as World
  // observes its node in the same core generation.
  const current = worldNodeForInspectorConversation(world, conversation);
  const coreHost = world.hosts.find(
    (host) =>
      host.connectionId === conversation.connectionId &&
      host.connection.runtime === "herdr-core",
  );
  if (coreHost) {
    if (
      !current ||
      current.generation !== conversation.runtimeGeneration ||
      !inspectorAdmits(current)
    ) {
      return [];
    }
    const view = worldIntentInitialView(current, conversation.view);
    const context = worldInspectorContext(current);
    const observed =
      view && context
        ? worldInspectorForNode(
            current,
            view,
            worldIntentViews(current),
            context,
            {
              dock: conversation.dock,
              expanded: conversation.expanded,
              size: conversation.size,
            },
          )
        : null;
    if (!observed) {
      return [];
    }
    const next = reconcileWorldInspectorConversation(conversation, observed);
    return [next];
  }
  return null;
}

/** Provider-specific removal proof; a bounded TUI projection cannot prove absence. */
export function observedInspectorConversation(
  world: WorldObject,
  snapshot: State,
  conversation: WorldInspectorConversation,
): WorldInspectorConversation[] {
  const current = worldNodeForInspectorConversation(world, conversation);
  const core = coreInspectorConversation(world, conversation);
  if (core !== null) return core;
  const focusedTopology = connectionSnapshot(
    snapshot,
    conversation.connectionId,
  );
  const owner = snapshot.connections.find(
    (connection) => connection.id === conversation.connectionId,
  );
  // Only the focused list can prove removal from the bounded projection.
  const focusedListIsCurrent =
    owner?.state === "ready" &&
    focusedTopology.status === "connected" &&
    focusedTopology.lastTopologyObservationStartedAt >
      (conversation.focusedListAdmissionAt ?? 0) &&
    focusedTopology.serverRuntimeGeneration === conversation.runtimeGeneration;
  const stillOpen = conversation.tabId
    ? focusedTopology.tabs.some(
        (tab) =>
          tab.tab_id === conversation.tabId &&
          tab.workspace_id === conversation.workspaceId,
      )
    : focusedTopology.workspaces.some(
        (workspace) => workspace.workspace_id === conversation.workspaceId,
      );
  if (
    owner?.generation !== conversation.runtimeGeneration ||
    (focusedListIsCurrent && !stillOpen)
  ) {
    return [];
  }
  if (
    !current ||
    current.generation !== conversation.runtimeGeneration ||
    !current.actionable
  ) {
    return [conversation];
  }
  const view = worldIntentInitialView(current, null);
  const context = worldInspectorContext(current);
  const observed =
    view && context
      ? worldInspectorForNode(
          current,
          view,
          worldIntentViews(current),
          context,
          {
            dock: conversation.dock,
            expanded: conversation.expanded,
            size: conversation.size,
          },
        )
      : null;
  if (!observed) {
    return [];
  }
  const next = reconcileWorldInspectorConversation(conversation, observed);
  return [next];
}
