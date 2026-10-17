import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficePaneDevice,
  OfficeRoom,
} from "../herdrOfficeProjection";
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
};

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

export function townModelFromProjection(
  projection: HerdrOfficeProjection,
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
