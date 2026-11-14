import type {
  WorldAgentStatus,
  WorldLeafObject,
  WorldObjectNode,
} from "./worldObject";

/** Switch to lists the agents waiting on you, then finished ones, then the rest. */
function switchToRank(status: WorldAgentStatus) {
  return status === "blocked" ? 0 : status === "done" ? 1 : 2;
}

/**
 * A phone's ⋯ switch list from a window: the live agents and terminals the
 * host filter shows, except `currentId`, those that need you first. The menu
 * scrolls rather than cutting.
 */
export function worldSwitchTargets(
  nodes: readonly WorldObjectNode[],
  currentId: string,
  select: (node: WorldLeafObject) => void,
) {
  return nodes
    .filter(
      (node): node is WorldLeafObject =>
        (node.kind === "agent" || node.kind === "terminal") &&
        node.actionable &&
        !node.stale &&
        node.id !== currentId,
    )
    .sort((a, b) => switchToRank(a.status) - switchToRank(b.status))
    .map((node) => ({
      id: node.id,
      label: node.label,
      detail: `${node.stateLabels[node.status] ?? node.status} · ${node.spaceLabel}`,
      onSelect: () => select(node),
    }));
}
