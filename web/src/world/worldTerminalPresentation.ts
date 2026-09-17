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
