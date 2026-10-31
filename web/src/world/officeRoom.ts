import { projectAgent, target } from "./officeAgent";
import type { OfficeHost } from "./officeHost";
import type {
  OfficeAgent,
  OfficeDesk,
  OfficePaneDevice,
  OfficeRoom,
} from "./officeProjectionTypes";
import {
  boundedOptionalText,
  type WorldAgentStatus,
  type WorldLeafObject,
  type WorldSpaceObject,
} from "./worldObject";

/**
 * One Town room from one World space: its desks (tabs), pane devices and
 * agents, with each desk's occupant and completions.
 */
export type ProjectedRoom = {
  host: OfficeHost;
  source: WorldSpaceObject;
  room: Omit<
    OfficeRoom,
    | "desks"
    | "roomAgents"
    | "omittedDeskCount"
    | "omittedAgentCount"
    | "observedDeskCount"
    | "observedAgentCount"
    | "deskFold"
    | "deskRenderLimit"
  >;
  desks: OfficeDesk[];
  agents: OfficeAgent[];
};

export function buildRoom(
  space: WorldSpaceObject,
  host: OfficeHost,
  paneDevicesPerDesk: number,
): ProjectedRoom {
  const construction = constructRoom(space, host, paneDevicesPerDesk);
  let step = construction.next();
  while (!step.done) step = construction.next();
  return step.value;
}

// Both entry points consume this constructor (as constructHost in
// worldObject.ts): preparation can suspend it inside a large room, and
// render drains it. Each pane and agent is indexed once by tab and desk, so a
// room costs O(panes), not O(tabs × panes).
export function* constructRoom(
  space: WorldSpaceObject,
  host: OfficeHost,
  paneDevicesPerDesk: number,
): Generator<void, ProjectedRoom> {
  const operational = space.capabilities.openSpaces;
  const roomKey = space.id;
  // Each tab's leaves, in the room's order.
  const leavesByTab = new Map<string, WorldLeafObject[]>();
  for (const leaf of space.children) {
    const leaves = leavesByTab.get(leaf.tabId);
    if (leaves) leaves.push(leaf);
    else leavesByTab.set(leaf.tabId, [leaf]);
    yield;
  }
  const NO_LEAVES: readonly WorldLeafObject[] = [];
  // Desks keep Herdr's tab order: tab.list order is the source of truth, and
  // a moved tab keeps the number it had.
  const desks: OfficeDesk[] = [];
  for (const [index, tab] of space.tabs.entries()) {
    const leaves = leavesByTab.get(tab.tab_id) ?? NO_LEAVES;
    desks.push({
      key: JSON.stringify([space.connectionId, "tab", tab.tab_id]),
      hostKey: host.key,
      roomKey,
      tabRef: target(space, "tab", tab.tab_id),
      terminalSelectionKeys: leaves.map(({ id }) => id).sort(),
      observedGeneration: space.generation,
      displayLabel: boundedOptionalText(tab.label, 100) ?? `Tab ${tab.number}`,
      appearanceStatus: leaves[0]?.appearance?.status,
      order: index,
      stale: space.stale,
      canOpenInSpaces: operational,
      completionAgentKeys: [],
      paneDevices: [],
      observedPaneCount: Math.max(tab.pane_count, leaves.length),
      omittedPaneCount: 0,
    });
    yield;
  }
  const deskKeys = new Map(
    desks.map((desk) => [desk.tabRef.nativeId, desk.key]),
  );
  const agents: OfficeAgent[] = [];
  for (const leaf of space.children) {
    if (leaf.kind !== "agent") continue;
    agents.push(
      projectAgent(
        leaf as WorldLeafObject & { kind: "agent" },
        roomKey,
        host.key,
        deskKeys,
      ),
    );
    yield;
  }
  agents.sort(compareAgents);
  // Each desk's agents, in the room's agent order.
  const agentsByDesk = new Map<string, OfficeAgent[]>();
  for (const agent of agents) {
    if (agent.deskKey == null) continue;
    const deskAgents = agentsByDesk.get(agent.deskKey);
    if (deskAgents) deskAgents.push(agent);
    else agentsByDesk.set(agent.deskKey, [agent]);
  }
  for (const desk of desks) {
    desk.paneDevices = projectPaneDevices(
      leavesByTab.get(desk.tabRef.nativeId) ?? NO_LEAVES,
      desk,
    ).slice(0, paneDevicesPerDesk);
    desk.omittedPaneCount = Math.max(
      0,
      desk.observedPaneCount - desk.paneDevices.length,
    );
    const deskAgents = agentsByDesk.get(desk.key) ?? [];
    const candidates = deskAgents
      .filter((agent) => agent.destination === "room")
      .sort(compareDeskCandidates);
    if (candidates[0]) desk.occupantAgentKey = candidates[0].key;
    desk.completionAgentKeys = deskAgents
      .filter((agent) => agent.semanticStatus === "done")
      .map(({ key }) => key)
      .sort();
    yield;
  }
  return {
    host,
    source: space,
    room: {
      key: roomKey,
      hostKey: host.key,
      workspaceRef: target(space, "workspace", space.nativeId),
      observedGeneration: space.generation,
      displayLabel: space.label,
      accessibleLabel: space.label,
      order: space.workspace.number,
      stale: space.stale,
      canOpenInSpaces: operational,
    },
    desks,
    agents,
  };
}

const preparedPaneDevices = new WeakMap<OfficeDesk, OfficePaneDevice[]>();
export function projectPaneDevices(
  leaves: readonly WorldLeafObject[],
  desk: OfficeDesk,
): OfficePaneDevice[] {
  const previous = preparedPaneDevices.get(desk);
  if (previous) return previous;
  const devices = leaves
    .filter(({ tabId }) => tabId === desk.tabRef.nativeId)
    .sort((left, right) => left.nativeId.localeCompare(right.nativeId))
    .map((leaf, order) => ({
      key: JSON.stringify([
        leaf.connectionId,
        leaf.generation,
        "pane-device",
        leaf.nativeId,
      ]),
      nodeId: leaf.id,
      paneRef: target(leaf, "pane", leaf.nativeId),
      terminalRef: target(leaf, "terminal", leaf.terminalId),
      deskKey: desk.key,
      hostKey: desk.hostKey,
      roomKey: desk.roomKey,
      displayLabel: `Pane ${order + 1}${leaf.agentName || leaf.agentLabel ? ` · ${leaf.agentName || leaf.agentLabel}` : ""}`,
      order,
      stale: leaf.stale,
      canOpenInSpaces: leaf.capabilities.openSpaces,
      ...(leaf.kind === "agent" ? { agentKey: leaf.id } : {}),
      ...(leaf.agentSessionFingerprint
        ? { agentSessionFingerprint: leaf.agentSessionFingerprint }
        : {}),
    }));
  preparedPaneDevices.set(desk, devices);
  return devices;
}

export function compareAgents(left: OfficeAgent, right: OfficeAgent) {
  return left.key.localeCompare(right.key);
}

export function compareDeskCandidates(left: OfficeAgent, right: OfficeAgent) {
  return (
    roomStatusOrder(left.semanticStatus) -
      roomStatusOrder(right.semanticStatus) ||
    Number(right.focused) - Number(left.focused) ||
    left.key.localeCompare(right.key)
  );
}

function roomStatusOrder(status: WorldAgentStatus) {
  return status === "working" ? 0 : status === "unknown" ? 1 : 2;
}
