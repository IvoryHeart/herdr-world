/**
 * Town's bus, as geometry: a stop at every road crossing, the one route the
 * bus drives past all of them, and where each binned agent waits. Pure: the
 * service owns the schedule (shared/bin.ts) and who rides; this places them.
 */

import type { BinEntry } from "../../../../shared/bin";
import {
  TOWN_TILE as T,
  type TownBuilding,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import type { TownModel } from "./townModel";

/** A street is five tiles: pavement, three lanes, pavement. */
const STREET = 5;
/** Riders queue along the pavement this far apart, in world pixels. */
const QUEUE_GAP = 11;
/** Riders shown standing at one stop; the rest are a count. */
export const TOWN_STOP_QUEUE = 4;

export type TownBusStop = {
  key: string;
  /** Where its riders wait, on the pavement beside the crossing. */
  wait: TownPoint;
  /** How far along the route the bus passes it, in world pixels. */
  at: number;
};

/** One pass along a street, edge to edge, at the lanes' height. */
export type TownBusLeg = { y: number; from: number; to: number };

export type TownBusRoute = {
  legs: readonly TownBusLeg[];
  length: number;
  stops: readonly TownBusStop[];
};

const lane = (road: number) => (road + STREET / 2) * T;

/**
 * Every crossing of a street and a side road has a stop. The bus drives
 * every street from one edge of the map to the other, alternating
 * direction, so it passes every crossing whatever the rows' widths; between
 * streets it is off the map.
 */
export function townBusRoute(layout: TownLayout): TownBusRoute {
  const roads = [...new Set(layout.roads)].sort((a, b) => a - b);
  const left = -3 * T;
  const right = (layout.width + 3) * T;
  const legs = roads.map((road, index) => ({
    y: lane(road),
    from: index % 2 ? right : left,
    to: index % 2 ? left : right,
  }));
  const span = right - left;
  const stops: TownBusStop[] = [];
  roads.forEach((road, index) => {
    const leg = legs[index]!;
    for (const side of layout.verticalRoads)
      if (side.y0 === road + STREET || side.y1 === road) {
        const key = `${side.x}:${road}`;
        if (stops.some((stop) => stop.key === key)) continue;
        const wait = { x: (side.x - 0.5) * T, y: (road + STREET - 0.5) * T };
        stops.push({
          key,
          wait,
          at: index * span + Math.abs(wait.x - leg.from),
        });
      }
  });
  return { legs, length: legs.length * span, stops };
}

/** The bus's position `along` pixels along the route, and its heading. */
export function townBusAt(route: TownBusRoute, along: number) {
  let left = Math.max(0, along);
  for (let index = 0; index < route.legs.length; index += 1) {
    const leg = route.legs[index]!;
    const step = Math.abs(leg.to - leg.from);
    if (left <= step || index === route.legs.length - 1) {
      const k = step ? Math.min(1, left / step) : 1;
      return {
        x: leg.from + (leg.to - leg.from) * k,
        y: leg.y,
        facing: (leg.to < leg.from ? "left" : "right") as "left" | "right",
      };
    }
    left -= step;
  }
  return { x: 0, y: 0, facing: "right" as const };
}

/** A binned agent shown in Town, at the stop nearest its room. */
export type TownBinRider = {
  entry: BinEntry;
  agentKey: string;
  stop: TownBusStop;
  /** Its place in the stop's queue. */
  slot: number;
  /** Where it stands, and the front door it walked out of. */
  at: TownPoint;
  door: TownPoint;
};

/**
 * Town's agents for the bin's entries: the agents to take out of their
 * rooms (`away`, entries and closes in progress) and the riders to draw.
 * An entry whose agent Town does not show has no rider.
 */
export function townBinRiders(
  entries: readonly BinEntry[],
  closing: readonly BinEntry[],
  model: Pick<TownModel, "agents">,
  layout: TownLayout,
  route: TownBusRoute,
) {
  const byPane = new Map<string, string>();
  for (const agent of model.agents.values()) {
    const pane = agent.currentPaneRef;
    byPane.set(
      `${pane.connectionId}\0${pane.generation}\0${pane.nativeId}`,
      agent.key,
    );
  }
  const agentOf = (entry: BinEntry) =>
    byPane.get(
      `${entry.connection_id}\0${entry.connection_generation}\0${entry.pane_id}`,
    );
  const away = new Set<string>();
  for (const entry of closing) {
    const key = agentOf(entry);
    if (key) away.add(key);
  }
  const riders: TownBinRider[] = [];
  const queues = new Map<string, number>();
  for (const entry of entries) {
    const agentKey = agentOf(entry);
    if (!agentKey) continue;
    away.add(agentKey);
    const agent = model.agents.get(agentKey)!;
    const building = layout.buildings.find((b) => b.hostKey === agent.hostKey);
    const stop = building
      ? townNearestStop(route, layout, building, agent.roomKey)
      : null;
    if (!building || !stop) continue;
    const slot = queues.get(stop.key) ?? 0;
    queues.set(stop.key, slot + 1);
    riders.push({
      entry,
      agentKey,
      stop,
      slot,
      at: {
        x: stop.wait.x - Math.min(slot, TOWN_STOP_QUEUE - 1) * QUEUE_GAP,
        y: stop.wait.y,
      },
      door: { x: (building.entryX + 0.5) * T, y: building.y * T },
    });
  }
  return { away, riders };
}

/**
 * The stop an agent walks to: on the street its building's front door opens
 * onto, the one nearest its room; any stop when that street has none.
 */
export function townNearestStop(
  route: TownBusRoute,
  layout: TownLayout,
  building: TownBuilding,
  roomKey: string,
): TownBusStop | null {
  const room = building.rooms.find((placed) => placed.key === roomKey);
  const x = ((room ? room.x + room.w / 2 : building.entryX) + 0.5) * T;
  const front = Math.max(
    -Infinity,
    ...layout.roads.filter((road) => road + STREET <= building.y),
  );
  const onFront = route.stops.filter(
    (stop) => stop.wait.y === (front + STREET - 0.5) * T,
  );
  const door = { x, y: building.y * T };
  let best: TownBusStop | null = null;
  let cost = Infinity;
  for (const stop of onFront.length ? onFront : route.stops) {
    const next =
      Math.abs(stop.wait.x - door.x) + Math.abs(stop.wait.y - door.y);
    if (next < cost) {
      cost = next;
      best = stop;
    }
  }
  return best;
}
