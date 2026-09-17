import type { InspectorView } from "../workspaceResource";
import type { WorldObjectNode } from "./worldObject";

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

export type WorldTerminalPresentation = WorldFloatingTerminal & {
  portal: Element | null;
};

export const MAX_WORLD_FLOATING_TERMINALS = 5;

export function upsertWorldFloatingTerminal(
  current: readonly WorldFloatingTerminal[],
  next: WorldFloatingTerminal,
  limit = MAX_WORLD_FLOATING_TERMINALS,
) {
  const retained = current.filter(
    (terminal) => !sameWorldTerminal(terminal, next),
  );
  if (retained.length === current.length && retained.length >= limit) {
    return { terminals: current, admitted: false } as const;
  }
  return {
    terminals: [...retained, next],
    admitted: true,
  } as const;
}

export function retainWorldFloatingTerminals(
  current: readonly WorldFloatingTerminal[],
  lease: { connectionId: string; runtimeGeneration: number } | null,
) {
  if (!lease) return [];
  return current.filter(
    (terminal) =>
      terminal.connectionId === lease.connectionId &&
      terminal.runtimeGeneration === lease.runtimeGeneration,
  );
}

function sameWorldTerminal(
  left: WorldFloatingTerminal,
  right: WorldFloatingTerminal,
) {
  return (
    left.connectionId === right.connectionId &&
    left.runtimeGeneration === right.runtimeGeneration &&
    left.terminalId === right.terminalId
  );
}

export function floatingTerminalForNode(
  node: WorldObjectNode,
): WorldFloatingTerminal | null {
  if (
    (node.kind !== "agent" && node.kind !== "terminal") ||
    !node.actionable ||
    !node.selectedHost ||
    !node.capabilities.openTerminal
  ) {
    return null;
  }
  return {
    nodeId: node.id,
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    paneId: node.nativeId,
    terminalId: node.terminalId,
    label: node.label,
    hostLabel: node.hostLabel,
    spaceLabel: node.spaceLabel,
  };
}

export function shouldRehomeDockedTerminal({
  currentNodeId,
  nextNodeId,
  inspectorOpen,
  inspectorView,
  alreadyFloating,
}: {
  currentNodeId: string | null;
  nextNodeId: string | null;
  inspectorOpen: boolean;
  inspectorView: InspectorView | null;
  alreadyFloating: boolean;
}) {
  return Boolean(
    currentNodeId &&
      nextNodeId &&
      currentNodeId !== nextNodeId &&
      inspectorOpen &&
      inspectorView === "terminal" &&
      !alreadyFloating,
  );
}
