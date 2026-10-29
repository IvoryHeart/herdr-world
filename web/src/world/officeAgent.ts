import type {
  OfficeAgent,
  OfficeAgentDestination,
  OfficeQualifiedTarget,
} from "./officeProjectionTypes";
import type {
  WorldAgentStatus,
  WorldLeafObject,
  WorldSpaceObject,
} from "./worldObject";
import { stableNumber } from "./stableNumber";
export function projectAgent(
  leaf: WorldLeafObject & { kind: "agent" },
  roomKey: string,
  hostKey: string,
  deskKeys: ReadonlyMap<string, string>,
): OfficeAgent {
  const destination = statusDestination(leaf.status);
  const summary = leaf.taskSummary?.slice(0, 160);
  return {
    key: leaf.id,
    nodeId: leaf.id,
    currentPaneRef: target(leaf, "pane", leaf.nativeId),
    currentTerminalRef: target(leaf, "terminal", leaf.terminalId),
    currentTabRef: target(leaf, "tab", leaf.tabId),
    deskKey: deskKeys.get(leaf.tabId) ?? null,
    observedGeneration: leaf.generation,
    roomKey,
    hostKey,
    displayLabel: leaf.agentName ?? leaf.agentLabel ?? leaf.label,
    ...(leaf.appearance ? { appearance: leaf.appearance } : {}),
    ...(leaf.agentName ? { agentName: leaf.agentName } : {}),
    ...(leaf.agentLabel ? { harness: leaf.agentLabel } : {}),
    ...(summary ? { taskSummary: summary } : {}),
    semanticStatus: leaf.status,
    stateLabels: leaf.stateLabels,
    focused: leaf.focused,
    destination,
    placement:
      destination === "room"
        ? "standing"
        : destination === "reception"
          ? "waiting"
          : "bar",
    stale: leaf.stale,
    canOpenInSpaces: leaf.capabilities.openSpaces,
    characterIndex: stableNumber(leaf.id) % 12,
  };
}

export function target(
  node: Pick<
    WorldLeafObject | WorldSpaceObject,
    "connectionId" | "generation" | "id"
  >,
  kind: OfficeQualifiedTarget["kind"],
  nativeId: string,
): OfficeQualifiedTarget {
  return {
    connectionId: node.connectionId,
    generation: node.generation,
    kind,
    nativeId,
    worldId: node.id,
  };
}

function statusDestination(status: WorldAgentStatus): OfficeAgentDestination {
  if (status === "working" || status === "unknown") return "room";
  return status === "blocked" || status === "done" ? "reception" : "bar";
}
