import type { InspectorView } from "../workspaceResource";
import type { WorldObject, WorldObjectNode } from "./worldObject";

export type VisualRouteAction = InspectorView | "spaces";

export type VisualRouteActionTarget = {
  id: string;
  connectionId: string;
  runtimeGeneration: number;
  kind: Exclude<WorldObjectNode["kind"], "host">;
  workspaceId: string;
  paneId: string | null;
  terminalId: string | null;
};

export type VisualRouteActionResolution =
  | { node: WorldObjectNode; reason: null }
  | { node: null; reason: string };

export function visualRouteActionTarget(
  node: WorldObjectNode | null,
): VisualRouteActionTarget | null {
  if (!node || node.kind === "host") return null;
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return {
    id: node.id,
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    kind: node.kind,
    workspaceId: leaf?.workspaceId ?? node.nativeId,
    paneId: leaf?.nativeId ?? null,
    terminalId: leaf?.terminalId ?? null,
  };
}

export function visualRouteActionsForNode(
  node: WorldObjectNode,
): VisualRouteAction[] {
  if (node.kind === "host") return [];
  return [
    ...(node.capabilities.openTerminal ? (["terminal"] as const) : []),
    ...(node.capabilities.files ? (["files"] as const) : []),
    ...(node.capabilities.changes ? (["changes"] as const) : []),
    ...(node.capabilities.agentHistory ? (["history"] as const) : []),
    ...(node.capabilities.openSpaces ? (["spaces"] as const) : []),
  ];
}

export function visualRouteTargetLabel(node: WorldObjectNode) {
  if (node.kind === "host") return node.hostLabel;
  if (node.kind === "space") return `${node.label} · ${node.hostLabel}`;
  return `${node.label} · ${node.spaceLabel} · ${node.hostLabel}`;
}

export function resolveVisualRouteActionTarget(
  target: VisualRouteActionTarget | null,
  world: WorldObject,
  lease: {
    activeConnectionId: string;
    runtimeGeneration: number | null;
    selectedId: string | null;
  },
): VisualRouteActionResolution {
  if (!target) {
    return { node: null, reason: "Select a space, agent, or terminal first." };
  }
  if (lease.selectedId !== target.id) {
    return { node: null, reason: "The selected item changed." };
  }
  if (lease.activeConnectionId !== target.connectionId) {
    return { node: null, reason: "The selected host changed." };
  }
  if (lease.runtimeGeneration !== target.runtimeGeneration) {
    return {
      node: null,
      reason: "The selected host generation is no longer available.",
    };
  }
  const node = world.nodeById.get(target.id);
  if (
    !node ||
    node.kind === "host" ||
    node.connectionId !== target.connectionId ||
    node.generation !== target.runtimeGeneration ||
    node.kind !== target.kind ||
    (node.kind === "space"
      ? node.nativeId !== target.workspaceId ||
        target.paneId !== null ||
        target.terminalId !== null
      : node.workspaceId !== target.workspaceId ||
        node.nativeId !== target.paneId ||
        node.terminalId !== target.terminalId)
  ) {
    return { node: null, reason: "The selected item is no longer available." };
  }
  if (!node.selectedHost || !node.actionable) {
    return { node: null, reason: "The selected item is no longer available." };
  }
  return { node, reason: null };
}
