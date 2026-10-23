import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficePaneDevice,
  OfficeRoom,
} from "../herdrOfficeProjection";
import {
  hostColorKey,
  placeColor,
  terminalColor,
  workspaceColorKey,
  type TerminalColor,
  type TerminalColorTarget,
  type TerminalColors,
} from "../terminalColor";
import type { TownInput } from "./townLayout";

export type TownSeatRef = { deskKey: string; seat: number };

/** Indexed view of one Office projection for the town scene. */
export type TownModel = {
  projection: HerdrOfficeProjection;
  input: TownInput;
  hosts: ReadonlyMap<string, OfficeHost>;
  rooms: ReadonlyMap<string, OfficeRoom>;
  desks: ReadonlyMap<string, OfficeDesk>;
  devices: ReadonlyMap<string, OfficePaneDevice>;
  /** Agents of presented rooms; the complete roster stays on the projection. */
  agents: ReadonlyMap<string, OfficeAgent>;
  agentSeats: ReadonlyMap<string, TownSeatRef>;
  roomCounts: ReadonlyMap<string, TownRoomCounts>;
  /** Each desk's terminal colour (its Herdr tab's, see terminalColor.ts). */
  deskColors: ReadonlyMap<string, TerminalColor>;
  /** Rooms' and buildings' chosen colours; absent ones use their defaults. */
  placeColors: TownPlaceColors;
};

export type TownPlaceColors = {
  rooms: ReadonlyMap<string, TerminalColor>;
  hosts: ReadonlyMap<string, TerminalColor>;
};
export const NO_PLACE_COLORS: TownPlaceColors = {
  rooms: new Map(),
  hosts: new Map(),
};

/** What a room's colour is saved under: its workspace's card key. */
export const townRoomColorKey = (room: OfficeRoom) =>
  workspaceColorKey(room.workspaceRef.connectionId, room.workspaceRef.nativeId);

/** Each host's connection, from its presented rooms. */
export function townHostConnections(projection: HerdrOfficeProjection) {
  const connections = new Map<string, string>();
  for (const room of projection.rooms)
    connections.set(room.hostKey, room.workspaceRef.connectionId);
  return connections;
}

/** The chosen colours of the projection's rooms and buildings. */
export function townPlaceColors(
  projection: HerdrOfficeProjection,
  colors: TerminalColors,
): TownPlaceColors {
  const rooms = new Map<string, TerminalColor>();
  for (const room of projection.rooms) {
    const color = placeColor(colors, townRoomColorKey(room));
    if (color) rooms.set(room.key, color);
  }
  const hosts = new Map<string, TerminalColor>();
  for (const [hostKey, connectionId] of townHostConnections(projection)) {
    const color = placeColor(colors, hostColorKey(connectionId));
    if (color) hosts.set(hostKey, color);
  }
  return rooms.size || hosts.size ? { rooms, hosts } : NO_PLACE_COLORS;
}

/** The same colours keep the same object, so nothing is repainted. */
export function keepPlaceColors(
  last: TownPlaceColors,
  next: TownPlaceColors,
): TownPlaceColors {
  const same = (
    a: ReadonlyMap<string, string>,
    b: ReadonlyMap<string, string>,
  ) =>
    a.size === b.size && [...a].every(([key, color]) => b.get(key) === color);
  return same(last.rooms, next.rooms) && same(last.hosts, next.hosts)
    ? last
    : next;
}

export type TownRoomCounts = {
  desks: number;
  agents: number;
  working: number;
  blocked: number;
  done: number;
  idle: number;
  unknown: number;
};

export type TownAgentStatus = OfficeAgent["semanticStatus"];

/** Each connection's workspace IDs, which qualify a colliding tab key. */
function workspaceIdsOf(projection: HerdrOfficeProjection) {
  const ids = new Map<string, Set<string>>();
  for (const room of projection.rooms) {
    const { connectionId, nativeId } = room.workspaceRef;
    if (!ids.has(connectionId)) ids.set(connectionId, new Set());
    ids.get(connectionId)!.add(nativeId);
  }
  return ids;
}

const deskTarget = (
  room: OfficeRoom,
  desk: OfficeDesk,
  ids: ReadonlyMap<string, ReadonlySet<string>>,
): TerminalColorTarget => ({
  connectionId: desk.tabRef.connectionId,
  workspaceId: room.workspaceRef.nativeId,
  tabId: desk.tabRef.nativeId,
  workspaceIds: ids.get(desk.tabRef.connectionId) ?? new Set(),
});

/** What a desk's colour is saved under: its Herdr tab on its connection. */
export function townDeskColorTarget(
  projection: HerdrOfficeProjection,
  desk: OfficeDesk,
): TerminalColorTarget | null {
  const room = projection.rooms.find((entry) => entry.key === desk.roomKey);
  return room ? deskTarget(room, desk, workspaceIdsOf(projection)) : null;
}

/**
 * Each desk's terminal colour. Kept apart from the model's layout input, so a
 * colour change repaints tables without placing the town again.
 */
export function townDeskColors(
  projection: HerdrOfficeProjection,
  colors: TerminalColors,
): ReadonlyMap<string, TerminalColor> {
  const ids = workspaceIdsOf(projection);
  const deskColors = new Map<string, TerminalColor>();
  for (const room of projection.rooms)
    for (const desk of room.desks)
      deskColors.set(
        desk.key,
        terminalColor(colors, deskTarget(room, desk, ids)),
      );
  return deskColors;
}

export function townModelFromProjection(
  projection: HerdrOfficeProjection,
  colors: TerminalColors = {},
): TownModel {
  const hosts = new Map(projection.hosts.map((host) => [host.key, host]));
  const rooms = new Map<string, OfficeRoom>();
  const desks = new Map<string, OfficeDesk>();
  const devices = new Map<string, OfficePaneDevice>();
  const agentSeats = new Map<string, TownSeatRef>();
  for (const room of projection.rooms) {
    rooms.set(room.key, room);
    for (const desk of room.desks) {
      desks.set(desk.key, desk);
      desk.paneDevices.forEach((device, seat) => {
        devices.set(device.key, device);
        if (device.agentKey && !agentSeats.has(device.agentKey))
          agentSeats.set(device.agentKey, { deskKey: desk.key, seat });
      });
    }
  }
  // One pass over the complete roster, keeping only agents of presented rooms.
  const agents = new Map<string, OfficeAgent>();
  const roomCounts = new Map<string, TownRoomCounts>();
  for (const room of projection.rooms)
    roomCounts.set(room.key, {
      desks: room.observedDeskCount,
      agents: 0,
      working: 0,
      blocked: 0,
      done: 0,
      idle: 0,
      unknown: 0,
    });
  const admit = (agent: OfficeAgent) => {
    const counts = roomCounts.get(agent.roomKey);
    if (!counts || agents.has(agent.key)) return;
    agents.set(agent.key, agent);
    counts.agents += 1;
    counts[agent.semanticStatus] += 1;
  };
  for (const entry of projection.roster) admit(entry.agent);
  for (const room of projection.rooms)
    for (const agent of room.roomAgents) admit(agent);
  for (const reception of projection.receptions)
    for (const agent of reception.waitingAgents) admit(agent);
  for (const agent of projection.barAgents) admit(agent);
  return {
    projection,
    input: {
      hosts: projection.hosts.map(({ key, displayOrder }) => ({
        key,
        displayOrder,
      })),
      rooms: projection.rooms.map((room) => ({
        key: room.key,
        hostKey: room.hostKey,
        order: room.order,
        deskKeys: room.desks.map((desk) => desk.key),
        deskSeats: room.desks.map((desk) =>
          Math.max(1, Math.min(4, desk.paneDevices.length)),
        ),
      })),
    },
    hosts,
    rooms,
    desks,
    devices,
    agents,
    agentSeats,
    roomCounts,
    deskColors: townDeskColors(projection, colors),
    placeColors: townPlaceColors(projection, colors),
  };
}

/** Counts for one room, as shown on its status card. */
export function townRoomCounts(
  model: TownModel,
  room: OfficeRoom,
): TownRoomCounts {
  return (
    model.roomCounts.get(room.key) ?? {
      desks: room.observedDeskCount,
      agents: 0,
      working: 0,
      blocked: 0,
      done: 0,
      idle: 0,
      unknown: 0,
    }
  );
}

/** Agents that need the user, in Desk triage order: blocked oldest first, then done. */
export function townAttention(
  model: TownModel,
  since: ReadonlyMap<string, number>,
): OfficeAgent[] {
  const at = (agent: OfficeAgent) => since.get(agent.key) ?? 0;
  const agents = [...model.agents.values()];
  return [
    ...agents
      .filter((agent) => agent.semanticStatus === "blocked")
      .sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key)),
    ...agents
      .filter((agent) => agent.semanticStatus === "done")
      .sort((a, b) => at(b) - at(a) || a.key.localeCompare(b.key)),
  ];
}
