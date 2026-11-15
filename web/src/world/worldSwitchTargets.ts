import {
  inspectorAdmits,
  type WorldAgentStatus,
  type WorldLeafObject,
  type WorldObjectNode,
} from "./worldObject";

/**
 * Switch to lists the agents waiting on you, then finished ones, then the
 * rest; pinned ones first within each.
 */
function switchToRank(status: WorldAgentStatus) {
  return status === "blocked" ? 0 : status === "done" ? 1 : 2;
}

/**
 * A phone's ⋯ switch list from a window: the live agents and terminals the
 * host filter shows, except `currentId`, those that need you first. The menu
 * scrolls rather than cutting. A live herdr-core leaf is never `actionable`
 * (that admits the TUI's paths); it is a target when its Inspector can open
 * (core Chat, its watched Terminal, Files, Changes). `pinned` says which
 * leaves are pinned (a herdr-core agent's own label, else its desk).
 */
export function worldSwitchTargets(
  nodes: readonly WorldObjectNode[],
  currentId: string,
  select: (node: WorldLeafObject) => void,
  pinned: (node: WorldLeafObject) => boolean = () => false,
) {
  return nodes
    .filter(
      (node): node is WorldLeafObject =>
        (node.kind === "agent" || node.kind === "terminal") &&
        !node.stale &&
        inspectorAdmits(node) &&
        node.id !== currentId,
    )
    .map((node) => ({ node, pinned: pinned(node) }))
    .sort(
      (a, b) =>
        switchToRank(a.node.status) - switchToRank(b.node.status) ||
        Number(b.pinned) - Number(a.pinned),
    )
    .map(({ node }) => node)
    .map((node) => ({
      id: node.id,
      label: node.label,
      detail: `${node.stateLabels[node.status] ?? node.status} · ${node.spaceLabel}`,
      onSelect: () => select(node),
    }));
}
