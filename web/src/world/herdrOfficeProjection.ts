import type {
  WorldAgentStatus,
  WorldHostState,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "./worldObject";
import { boundedOptionalText } from "./worldObject";

export const OFFICE_PRESENTATION_BOUNDS = Object.freeze({
  rooms: 128,
  desksPerRoom: 8,
  roomAgentsPerRoom: 16,
  receptionDesks: 6,
  waitingAgentsPerReception: 4,
  barAgents: 16,
  rosterPage: 50,
});

export type OfficeQualifiedTarget = {
  connectionId: string;
  generation: number;
  kind: "workspace" | "tab" | "pane" | "terminal";
  nativeId: string;
  worldId: string;
};

export type OfficeHost = {
  key: string;
  displayLabel: string;
  accessibleLabel?: string;
  displayOrder: number;
  connectionState: WorldHostState;
  observed: boolean;
  stale: boolean;
  compatibleWithWorld: boolean;
  compatibleWithSpaces: boolean;
  selected: boolean;
  deterministicSkin: { themeIndex: number; badge: string };
};

export type OfficeAgentDestination = "room" | "reception" | "bar";
export type OfficeAgentPlacement = "seated" | "standing" | "waiting" | "bar";

export type OfficeAgent = {
  key: string;
  nodeId: string;
  currentPaneRef: OfficeQualifiedTarget;
  currentTerminalRef: OfficeQualifiedTarget;
  currentTabRef: OfficeQualifiedTarget;
  deskKey: string | null;
  observedGeneration: number;
  roomKey: string;
  hostKey: string;
  displayLabel: string;
  taskSummary?: string;
  semanticStatus: WorldAgentStatus;
  stateLabels: Partial<Record<WorldAgentStatus, string>>;
  focused: boolean;
  destination: OfficeAgentDestination;
  placement: OfficeAgentPlacement;
  stale: boolean;
  canOpenInSpaces: boolean;
  characterIndex: number;
};

export type OfficeDesk = {
  key: string;
  hostKey: string;
  roomKey: string;
  tabRef: OfficeQualifiedTarget;
  terminalSelectionKeys: string[];
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  occupantAgentKey?: string;
  completionAgentKeys: string[];
};

export type OfficeRoom = {
  key: string;
  hostKey: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  accessibleLabel?: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  desks: OfficeDesk[];
  roomAgents: OfficeAgent[];
  omittedDeskCount: number;
  omittedAgentCount: number;
  observedDeskCount: number;
  observedAgentCount: number;
};

export type OfficeReception = {
  key: string;
  hostKey: string;
  hostLabel: string;
  stale: boolean;
  waitingAgents: OfficeAgent[];
  observedWaitingAgentCount: number;
  overflowCount: number;
};

export type OfficeRosterEntry = {
  agent: OfficeAgent;
  roomKey: string;
  roomLabel: string;
  hostKey: string;
  hostLabel: string;
  roomPresented: boolean;
  deskPresented: boolean;
  destinationPresented: boolean;
};

export type OfficeDeskRosterEntry = {
  desk: OfficeDesk;
  roomLabel: string;
  hostLabel: string;
  presented: boolean;
};

export type OfficeRoomRosterEntry = {
  key: string;
  hostKey: string;
  hostLabel: string;
  workspaceRef: OfficeQualifiedTarget;
  observedGeneration: number;
  displayLabel: string;
  order: number;
  stale: boolean;
  canOpenInSpaces: boolean;
  presented: boolean;
};

export type OfficeCoverage = {
  configuredHosts: number;
  observedHosts: number;
  compatibleHosts: number;
  connectingHosts: number;
  staleHosts: number;
  observedWorkspaces: number;
  observedDesks: number;
  observedAgents: number;
  status: Record<WorldAgentStatus, number>;
  omittedRooms: number;
  omittedDesks: number;
  omittedRoomAgents: number;
  omittedReceptionDesks: number;
  omittedWaitingAgents: number;
  omittedBarAgents: number;
};

export type HerdrOfficeProjection = {
  version: 1;
  generatedAt: number;
  hosts: OfficeHost[];
  rooms: OfficeRoom[];
  receptions: OfficeReception[];
  barAgents: OfficeAgent[];
  roomRoster: OfficeRoomRosterEntry[];
  deskRoster: OfficeDeskRosterEntry[];
  roster: OfficeRosterEntry[];
  unresolved: Array<{ kind: "room-bound"; count: number }>;
  coverage: OfficeCoverage;
  presentationBounds: typeof OFFICE_PRESENTATION_BOUNDS & {
    totalRooms: number;
    renderedRooms: number;
    totalDesks: number;
    renderedDesks: number;
    totalRoomAgents: number;
    renderedRoomAgents: number;
    totalReceptionDesks: number;
    renderedReceptionDesks: number;
    totalWaitingAgents: number;
    renderedWaitingAgents: number;
    totalBarAgents: number;
    renderedBarAgents: number;
  };
};

type ProjectedRoom = {
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
  >;
  desks: OfficeDesk[];
  agents: OfficeAgent[];
};

export function projectWorldOffice(
  world: WorldObject,
  generatedAt: number,
): HerdrOfficeProjection {
  const hosts = world.hosts.map(
    (host, displayOrder): OfficeHost => ({
      key: host.id,
      displayLabel: host.label,
      accessibleLabel: host.label,
      displayOrder,
      connectionState: host.hostState,
      observed: host.connection.snapshot !== null,
      stale: host.stale || host.hostState === "offline-stale",
      compatibleWithWorld:
        host.hostState === "active" || host.hostState === "ready-inactive",
      compatibleWithSpaces: host.hostState === "active",
      selected: host.selectedHost,
      deterministicSkin: {
        themeIndex: stableNumber(host.id) % 6,
        badge: `HOST ${String(displayOrder + 1).padStart(2, "0")}`,
      },
    }),
  );
  const hostById = new Map(hosts.map((host) => [host.key, host]));
  const allRooms = world.spaces
    .map((space) => projectRoom(space, hostById.get(space.parentId)!))
    .sort(compareRooms);
  const presentedRooms = boundedWithPriority(
    allRooms,
    OFFICE_PRESENTATION_BOUNDS.rooms,
    ({ host }) => host.selected,
  );
  const presentedRoomKeys = new Set(presentedRooms.map(({ room }) => room.key));
  const allAgents = allRooms.flatMap(({ agents }) => agents);
  const allDesks = allRooms.flatMap(({ desks }) => desks);
  const rooms = presentedRooms.map((entry) => {
    const desks = entry.desks.slice(0, OFFICE_PRESENTATION_BOUNDS.desksPerRoom);
    const seated = new Set(
      desks.flatMap(({ occupantAgentKey }) =>
        occupantAgentKey ? [occupantAgentKey] : [],
      ),
    );
    const roomAgents = entry.agents
      .filter(({ destination }) => destination === "room")
      .map((agent) => ({
        ...agent,
        placement: seated.has(agent.key)
          ? ("seated" as const)
          : ("standing" as const),
      }))
      .sort((left, right) => compareRoomAgents(left, right, desks));
    return {
      ...entry.room,
      desks,
      roomAgents: roomAgents.slice(
        0,
        OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      ),
      omittedDeskCount: Math.max(0, entry.desks.length - desks.length),
      omittedAgentCount: Math.max(
        0,
        roomAgents.length - OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      ),
      observedDeskCount: entry.desks.length,
      observedAgentCount: entry.agents.length,
    };
  });
  const roomByKey = new Map(rooms.map((room) => [room.key, room]));
  const receptions = boundedWithPriority(
    hosts,
    OFFICE_PRESENTATION_BOUNDS.receptionDesks,
    ({ selected }) => selected,
  ).map((host): OfficeReception => {
    const waitingAgents = allAgents
      .filter(
        (agent) =>
          agent.hostKey === host.key && agent.destination === "reception",
      )
      .sort(compareAgents);
    return {
      key: `reception:${host.key}`,
      hostKey: host.key,
      hostLabel: host.displayLabel,
      stale: host.stale,
      waitingAgents: waitingAgents.slice(
        0,
        OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
      ),
      observedWaitingAgentCount: waitingAgents.length,
      overflowCount: Math.max(
        0,
        waitingAgents.length -
          OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
      ),
    };
  });
  const barCandidates = allAgents
    .filter(({ destination }) => destination === "bar")
    .sort(compareBarAgents);
  const barAgents = barCandidates.slice(
    0,
    OFFICE_PRESENTATION_BOUNDS.barAgents,
  );
  const presentedRoomAgentKeys = new Set(
    rooms.flatMap(({ roomAgents }) => roomAgents.map(({ key }) => key)),
  );
  const presentedWaitingKeys = new Set(
    receptions.flatMap(({ waitingAgents }) =>
      waitingAgents.map(({ key }) => key),
    ),
  );
  const presentedBarKeys = new Set(barAgents.map(({ key }) => key));
  const roomRoster = allRooms.map(
    ({ host, room }): OfficeRoomRosterEntry => ({
      key: room.key,
      hostKey: host.key,
      hostLabel: host.displayLabel,
      workspaceRef: room.workspaceRef,
      observedGeneration: room.observedGeneration,
      displayLabel: room.displayLabel,
      order: room.order,
      stale: room.stale,
      canOpenInSpaces: room.canOpenInSpaces,
      presented: presentedRoomKeys.has(room.key),
    }),
  );
  const deskRoster = allRooms.flatMap(({ host, room, desks }) =>
    desks.map(
      (desk): OfficeDeskRosterEntry => ({
        desk,
        roomLabel: room.displayLabel,
        hostLabel: host.displayLabel,
        presented:
          roomByKey.get(room.key)?.desks.some(({ key }) => key === desk.key) ===
          true,
      }),
    ),
  );
  const roster = allRooms.flatMap(({ host, room, agents }) =>
    agents.map((agent): OfficeRosterEntry => {
      const presentedRoom = roomByKey.get(room.key);
      const projectedAgent =
        presentedRoom?.roomAgents.find(({ key }) => key === agent.key) ?? agent;
      return {
        agent: projectedAgent,
        roomKey: room.key,
        roomLabel: room.displayLabel,
        hostKey: host.key,
        hostLabel: host.displayLabel,
        roomPresented: presentedRoomKeys.has(room.key),
        deskPresented:
          !!agent.deskKey &&
          presentedRoom?.desks.some(({ key }) => key === agent.deskKey) ===
            true,
        destinationPresented:
          agent.destination === "room"
            ? presentedRoomAgentKeys.has(agent.key)
            : agent.destination === "reception"
              ? presentedWaitingKeys.has(agent.key)
              : presentedBarKeys.has(agent.key),
      };
    }),
  );
  const roomCandidates = allAgents.filter(
    ({ destination }) => destination === "room",
  );
  const waitingCandidates = allAgents.filter(
    ({ destination }) => destination === "reception",
  );
  const renderedRoomAgents = rooms.reduce(
    (count, room) => count + room.roomAgents.length,
    0,
  );
  const renderedWaitingAgents = receptions.reduce(
    (count, reception) => count + reception.waitingAgents.length,
    0,
  );
  const omittedRooms = Math.max(
    0,
    allRooms.length - OFFICE_PRESENTATION_BOUNDS.rooms,
  );
  const omittedDesks = allRooms.reduce(
    (count, { room, desks }) =>
      count +
      (presentedRoomKeys.has(room.key)
        ? Math.max(0, desks.length - OFFICE_PRESENTATION_BOUNDS.desksPerRoom)
        : desks.length),
    0,
  );
  const renderedDesks = rooms.reduce(
    (count, room) => count + room.desks.length,
    0,
  );
  return {
    version: 1,
    generatedAt,
    hosts,
    rooms,
    receptions,
    barAgents,
    roomRoster,
    deskRoster,
    roster,
    unresolved: omittedRooms
      ? [{ kind: "room-bound", count: omittedRooms }]
      : [],
    coverage: {
      configuredHosts: hosts.length,
      observedHosts: hosts.filter(({ observed }) => observed).length,
      compatibleHosts: hosts.filter(({ compatibleWithWorld }) =>
        Boolean(compatibleWithWorld),
      ).length,
      connectingHosts: hosts.filter(
        ({ connectionState }) => connectionState === "reconnecting",
      ).length,
      staleHosts: hosts.filter(({ stale }) => stale).length,
      observedWorkspaces: allRooms.length,
      observedDesks: allDesks.length,
      observedAgents: allAgents.length,
      status: countStatuses(allAgents),
      omittedRooms,
      omittedDesks,
      omittedRoomAgents: Math.max(
        0,
        roomCandidates.length - renderedRoomAgents,
      ),
      omittedReceptionDesks: Math.max(
        0,
        hosts.length - OFFICE_PRESENTATION_BOUNDS.receptionDesks,
      ),
      omittedWaitingAgents: Math.max(
        0,
        waitingCandidates.length - renderedWaitingAgents,
      ),
      omittedBarAgents: Math.max(0, barCandidates.length - barAgents.length),
    },
    presentationBounds: {
      ...OFFICE_PRESENTATION_BOUNDS,
      totalRooms: allRooms.length,
      renderedRooms: rooms.length,
      totalDesks: allDesks.length,
      renderedDesks,
      totalRoomAgents: roomCandidates.length,
      renderedRoomAgents,
      totalReceptionDesks: hosts.length,
      renderedReceptionDesks: receptions.length,
      totalWaitingAgents: waitingCandidates.length,
      renderedWaitingAgents,
      totalBarAgents: barCandidates.length,
      renderedBarAgents: barAgents.length,
    },
  };
}

function projectRoom(space: WorldSpaceObject, host: OfficeHost): ProjectedRoom {
  const operational = space.capabilities.openSpaces;
  const roomKey = space.id;
  const desks = [...space.tabs]
    .sort(
      (left, right) =>
        left.number - right.number || left.tab_id.localeCompare(right.tab_id),
    )
    .map(
      (tab): OfficeDesk => ({
        key: JSON.stringify([space.connectionId, "tab", tab.tab_id]),
        hostKey: host.key,
        roomKey,
        tabRef: target(space, "tab", tab.tab_id),
        terminalSelectionKeys: space.children
          .filter(({ tabId }) => tabId === tab.tab_id)
          .map(({ id }) => id)
          .sort(),
        observedGeneration: space.generation,
        displayLabel:
          boundedOptionalText(tab.label, 100) ?? `Tab ${tab.number}`,
        order: tab.number,
        stale: space.stale,
        canOpenInSpaces: operational,
        completionAgentKeys: [],
      }),
    );
  const deskKeys = new Map(
    desks.map((desk) => [desk.tabRef.nativeId, desk.key]),
  );
  const agents = space.children
    .filter((leaf): leaf is WorldLeafObject & { kind: "agent" } =>
      Boolean(leaf.kind === "agent"),
    )
    .map((leaf) => projectAgent(leaf, roomKey, host.key, deskKeys))
    .sort(compareAgents);
  for (const desk of desks) {
    const candidates = agents
      .filter(
        (agent) => agent.destination === "room" && agent.deskKey === desk.key,
      )
      .sort(compareDeskCandidates);
    if (candidates[0]) desk.occupantAgentKey = candidates[0].key;
    desk.completionAgentKeys = agents
      .filter(
        (agent) =>
          agent.semanticStatus === "done" && agent.deskKey === desk.key,
      )
      .map(({ key }) => key)
      .sort();
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

function projectAgent(
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
    displayLabel: leaf.agentLabel ?? leaf.label,
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

function target(
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
  return status === "blocked" ? "reception" : "bar";
}

function compareRooms(left: ProjectedRoom, right: ProjectedRoom) {
  return (
    left.host.displayOrder - right.host.displayOrder ||
    left.source.workspace.number - right.source.workspace.number ||
    left.room.key.localeCompare(right.room.key)
  );
}

function boundedWithPriority<T>(
  values: readonly T[],
  limit: number,
  priority: (value: T) => boolean,
) {
  if (values.length <= limit) return [...values];
  const admitted = new Set(
    [
      ...values.filter(priority),
      ...values.filter((value) => !priority(value)),
    ].slice(0, limit),
  );
  return values.filter((value) => admitted.has(value));
}

function compareAgents(left: OfficeAgent, right: OfficeAgent) {
  return left.key.localeCompare(right.key);
}

function compareDeskCandidates(left: OfficeAgent, right: OfficeAgent) {
  return (
    roomStatusOrder(left.semanticStatus) -
      roomStatusOrder(right.semanticStatus) ||
    Number(right.focused) - Number(left.focused) ||
    left.key.localeCompare(right.key)
  );
}

function compareRoomAgents(
  left: OfficeAgent,
  right: OfficeAgent,
  desks: readonly OfficeDesk[],
) {
  const order = new Map(desks.map((desk, index) => [desk.key, index]));
  return (
    Number(left.placement !== "seated") -
      Number(right.placement !== "seated") ||
    (order.get(left.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.deskKey ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    compareDeskCandidates(left, right)
  );
}

function compareBarAgents(left: OfficeAgent, right: OfficeAgent) {
  const rank = (status: WorldAgentStatus) =>
    status === "idle" ? 0 : status === "done" ? 1 : 2;
  return (
    rank(left.semanticStatus) - rank(right.semanticStatus) ||
    left.key.localeCompare(right.key)
  );
}

function roomStatusOrder(status: WorldAgentStatus) {
  return status === "working" ? 0 : status === "unknown" ? 1 : 2;
}

function countStatuses(agents: readonly OfficeAgent[]) {
  const counts: Record<WorldAgentStatus, number> = {
    working: 0,
    idle: 0,
    blocked: 0,
    done: 0,
    unknown: 0,
  };
  for (const agent of agents) counts[agent.semanticStatus] += 1;
  return counts;
}

function stableNumber(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
