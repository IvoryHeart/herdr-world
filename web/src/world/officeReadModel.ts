import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficePaneDevice,
} from "./herdrOfficeProjection";
import type { WorldAgentStatus } from "./worldObject";

export type OfficeStatusCounts = Readonly<Record<WorldAgentStatus, number>>;
export type OfficeReadModel = {
  roomCounts: ReadonlyMap<string, OfficeStatusCounts>;
  agentOf(key: string): OfficeAgent | undefined;
  agentForPane(connectionId: string, paneId: string): OfficeAgent | undefined;
};

const projections = new WeakMap<HerdrOfficeProjection, OfficeReadModel>();
const emptyCounts = () => ({
  blocked: 0,
  working: 0,
  done: 0,
  idle: 0,
  unknown: 0,
});

/** Build beside the cooperative canonical roster, before snapshot publication. */
export function createOfficeReadModel(
  hosts: readonly { connectionId: string; generation: number }[],
  agentOf: OfficeReadModel["agentOf"],
  paneOf: (key: string) => OfficePaneDevice | undefined,
) {
  const counts = new Map<string, OfficeStatusCounts>();
  const model: OfficeReadModel = {
    roomCounts: counts,
    agentOf,
    agentForPane: (connectionId, paneId) => {
      const host = hosts.find((host) => host.connectionId === connectionId);
      if (!host) return undefined;
      const pane = paneOf(
        JSON.stringify([connectionId, host.generation, "pane-device", paneId]),
      );
      return pane?.agentKey ? agentOf(pane.agentKey) : undefined;
    },
  };
  return {
    model,
    // World already counted these statuses; preserve its immutable contribution.
    addRoom(key: string, statuses: OfficeStatusCounts) {
      counts.set(key, statuses);
    },
  };
}

export function setOfficeReadModel(
  office: HerdrOfficeProjection,
  model: OfficeReadModel,
) {
  projections.set(office, model);
}

/** The fallback serves small, manually constructed projections, never runtime snapshots. */
export function officeReadModel(
  office: HerdrOfficeProjection,
): OfficeReadModel {
  const prepared = projections.get(office);
  if (prepared) return prepared;
  const agents = new Map<string, OfficeAgent>();
  const rooms = new Map<string, Record<WorldAgentStatus, number>>();
  for (const { agent, roomKey } of office.roster) {
    agents.set(agent.key, agent);
    let room = rooms.get(roomKey);
    if (!room) rooms.set(roomKey, (room = emptyCounts()));
    room[agent.semanticStatus] += 1;
  }
  const model: OfficeReadModel = {
    roomCounts: rooms,
    agentOf: (key) => agents.get(key),
    agentForPane: (connectionId, paneId) =>
      office.roster.find(
        ({ agent }) =>
          agent.currentPaneRef.connectionId === connectionId &&
          agent.currentPaneRef.nativeId === paneId,
      )?.agent,
  };
  projections.set(office, model);
  return model;
}

/** Finish/seen overlays share preparation and adjust only affected room totals. */
export function withOfficeReadModel(
  from: HerdrOfficeProjection,
  to: HerdrOfficeProjection,
  changes?: ReadonlyMap<OfficeAgent, OfficeAgent>,
): HerdrOfficeProjection {
  const base = officeReadModel(from);
  if (!changes?.size) {
    projections.set(to, base);
    return to;
  }
  const counts = new Map(base.roomCounts);
  const adjusted = new Map<string, Record<WorldAgentStatus, number>>();
  const agents = new Map<string, OfficeAgent>();
  for (const [before, after] of changes) {
    if (agents.has(after.key)) continue;
    let room = adjusted.get(before.roomKey);
    if (!room)
      adjusted.set(
        before.roomKey,
        (room = { ...(counts.get(before.roomKey) ?? emptyCounts()) }),
      );
    room[before.semanticStatus] -= 1;
    room[after.semanticStatus] += 1;
    counts.set(before.roomKey, room);
    agents.set(after.key, after);
  }
  projections.set(to, {
    roomCounts: counts,
    agentOf: (key) => agents.get(key) ?? base.agentOf(key),
    agentForPane: (connection, pane) => {
      const agent = base.agentForPane(connection, pane);
      return agent ? (agents.get(agent.key) ?? agent) : undefined;
    },
  });
  return to;
}
