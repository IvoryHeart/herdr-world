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

export type TownBusRoute = {
  points: readonly TownPoint[];
  length: number;
  stops: readonly TownBusStop[];
};

const lane = (road: number) => (road + STREET / 2) * T;

/**
 * Every crossing of a street and a side road has a stop. The bus snakes
 * along each street in turn, from off the map's left edge, turning down the
 * outermost side road to the next street, and leaves the map past the last.
 */
export function townBusRoute(layout: TownLayout): TownBusRoute {
  const roads = [...new Set(layout.roads)].sort((a, b) => a - b);
  const crossings = new Map<string, TownPoint>();
  for (const road of roads)
    for (const side of layout.verticalRoads)
      if (side.y0 === road + STREET || side.y1 === road)
        crossings.set(`${side.x}:${road}`, {
          x: (side.x - 0.5) * T,
          y: (road + STREET - 0.5) * T,
        });
  const points: TownPoint[] = [];
  let right = true;
  roads.forEach((road, index) => {
    if (!index) points.push({ x: -3 * T, y: lane(road) });
    const next = roads[index + 1];
    if (next === undefined) {
      points.push({
        x: right ? (layout.width + 3) * T : -3 * T,
        y: lane(road),
      });
      return;
    }
    const sides = layout.verticalRoads
      .filter((side) => side.y0 === road + STREET && side.y1 === next)
      .map((side) => (side.x + STREET / 2) * T);
    const turn = sides.length
      ? right
        ? Math.max(...sides)
        : Math.min(...sides)
      : right
        ? layout.width * T
        : 0;
    points.push({ x: turn, y: lane(road) }, { x: turn, y: lane(next) });
    right = !right;
  });
  const length = points.reduce(
    (sum, point, index) =>
      index ? sum + distance(points[index - 1]!, point) : 0,
    0,
  );
  const stops = [...crossings].map(([key, wait]) => ({
    key,
    wait,
    at: alongRoute(points, wait),
  }));
  return { points, length, stops };
}

/** The bus's position `distance` pixels along the route, and its heading. */
export function townBusAt(route: TownBusRoute, along: number) {
  let left = Math.max(0, along);
  for (let index = 1; index < route.points.length; index += 1) {
    const a = route.points[index - 1]!;
    const b = route.points[index]!;
    const step = distance(a, b);
    if (left <= step || index === route.points.length - 1) {
      const k = step ? Math.min(1, left / step) : 1;
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        facing: (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
          ? b.x < a.x
            ? "left"
            : "right"
          : "down") as "left" | "right" | "down",
      };
    }
    left -= step;
  }
  const only = route.points[0] ?? { x: 0, y: 0 };
  return { ...only, facing: "right" as const };
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

function distance(a: TownPoint, b: TownPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** How far along the route its closest point to `point` is. */
function alongRoute(points: readonly TownPoint[], point: TownPoint) {
  let best = Infinity;
  let along = 0;
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const step = distance(a, b);
    const k = step
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) /
              (step * step),
          ),
        )
      : 0;
    const gap = distance(point, {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
    });
    if (gap < best) {
      best = gap;
      along = walked + step * k;
    }
    walked += step;
  }
  return along;
}
