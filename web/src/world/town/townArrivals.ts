/**
 * A new agent's arrival in Town. When World confirms a start this page asked
 * for (agentStarts.ts), the agent steps out at the town center, or at the bus
 * stop nearest its room when it was launched anywhere else, walks the streets
 * and side roads to its building's front door, goes in to where its status
 * puts it (its desk, as townActors.ts walks it) and a short welcome plays over
 * it there. Nothing plays for agents Town already had, for a failed or
 * uncertain start, or after a reload. Several starts at once arrive one after
 * another. With reduced motion there is no walk: the agent is at its desk
 * with a still highlight that fades.
 *
 * Pure: who arrives when, and the way they walk. TownArrivalLayer draws the
 * walk outdoors and the welcome; the actors keep the agent out of its
 * building until it reaches the front door (`arriving`).
 */

import { AGENT_START_KEEP_MS, type AgentStart } from "../agentStarts";
import { ROAD_GAP } from "./townLots";
import { TOWN_TILE as T, type TownLayout, type TownPoint } from "./townLayout";
import type { TownModel } from "./townModel";
import { townNearestStop, type TownBusRoute } from "./townBus";
import { TOWN_WALK_SPEED } from "./townActors";
import type { TownDirection } from "./townSprites";

/** Arrivals that start together set off this far apart. */
export const TOWN_ARRIVAL_STAGGER_MS = 700;
/** The walk outdoors takes at most this long: a far door is hurried to. */
export const TOWN_ARRIVAL_WALK_MS = 3000;
/** The welcome over the seated agent. */
export const TOWN_ARRIVAL_WELCOME_MS = 1600;
/**
 * Once in, how long the welcome waits for the agent to sit before it plays
 * wherever the agent is (one that is idle goes to the bar). The walk
 * indoors is hurried to TOWN_ARRIVAL_INDOOR_S (townActors.ts).
 */
export const TOWN_ARRIVAL_SIT_WAIT_MS = 3500;

/** A street is five tiles: pavement, three lanes, pavement. */
const STREET = 5;

const playedStarts = new Set<number>();

export type TownArrivalFrom = "center" | "stop";

export type TownArrival = {
  /** The start it plays (AgentStart.id). */
  id: number;
  agentKey: string;
  from: TownArrivalFrom;
  /** When it steps out (ms, performance.now()); before then it waits. */
  begin: number;
  /** When it reaches the front door; `begin` when it does not walk. */
  end: number;
  /** Reduced motion: no walk, a still highlight at its desk. */
  still: boolean;
};

/** Each started agent in the model, by its qualified terminal. */
export function townAgentsByTerminal(model: Pick<TownModel, "agents">) {
  const byTerminal = new Map<string, string>();
  for (const agent of model.agents.values()) {
    const ref = agent.currentTerminalRef;
    byTerminal.set(
      `${ref.connectionId}\0${ref.generation}\0${ref.nativeId}`,
      agent.key,
    );
  }
  return (
    start: Pick<AgentStart, "connectionId" | "generation" | "terminalId">,
  ) =>
    byTerminal.get(
      `${start.connectionId}\0${start.generation}\0${start.terminalId}`,
    );
}

/**
 * Which arrivals play. Each confirmed start plays once, as soon as Town shows
 * its agent, and only while it is recent (AGENT_START_KEEP_MS).
 */
export class TownArrivals {
  arrivals: readonly TownArrival[] = [];

  /**
   * `played`: the starts already played, across Town's mounts (page memory),
   * so returning to Town never plays one again.
   */
  constructor(private readonly played: Set<number> = playedStarts) {}

  /**
   * Take new starts and drop finished arrivals at `now`. `walkMs` is the
   * agent's walk outdoors, null when it cannot walk (no building or stop).
   * Returns whether the arrivals changed.
   */
  update(
    starts: readonly AgentStart[],
    agentOf: (start: AgentStart) => string | undefined,
    walkMs: (agentKey: string, from: TownArrivalFrom) => number | null,
    now: number,
    still: boolean,
  ): boolean {
    const kept = this.arrivals.filter(
      (arrival) => now < townArrivalDone(arrival),
    );
    let changed = kept.length !== this.arrivals.length;
    let last = Math.max(-Infinity, ...kept.map((arrival) => arrival.begin));
    for (const start of starts) {
      if (this.played.has(start.id)) continue;
      // Too old to be news: Town opened long after it, or never showed it.
      if (now - start.at >= AGENT_START_KEEP_MS) {
        this.played.add(start.id);
        continue;
      }
      const agentKey = agentOf(start);
      if (!agentKey) continue;
      this.played.add(start.id);
      if (kept.some((arrival) => arrival.agentKey === agentKey)) continue;
      const from: TownArrivalFrom = start.from === "center" ? "center" : "stop";
      const begin = Math.max(now, last + TOWN_ARRIVAL_STAGGER_MS);
      const walk = still ? 0 : (walkMs(agentKey, from) ?? 0);
      kept.push({
        id: start.id,
        agentKey,
        from,
        begin,
        end: begin + walk,
        still,
      });
      last = begin;
      changed = true;
    }
    if (changed) this.arrivals = kept;
    return changed;
  }

  /** Agents still outside at `now`: waiting their turn or walking. */
  outside(now: number): string[] {
    return this.arrivals
      .filter((arrival) => arrival.end > arrival.begin && now < arrival.end)
      .map((arrival) => arrival.agentKey)
      .sort();
  }

  /** The next time the outside agents or the arrivals change, or null. */
  nextChange(now: number): number | null {
    const times = this.arrivals
      .flatMap((arrival) => [arrival.end, townArrivalDone(arrival)])
      .filter((time) => time > now);
    return times.length ? Math.min(...times) : null;
  }
}

/** When an arrival is over: its welcome has played, whenever it sat. */
export const townArrivalDone = (arrival: TownArrival) =>
  arrival.end + TOWN_ARRIVAL_SIT_WAIT_MS + TOWN_ARRIVAL_WELCOME_MS;

/** A tile's walking point, in world pixels (as the actors stand on it). */
const at = (tx: number, ty: number): TownPoint => ({
  x: tx * T + 8,
  y: ty * T + 13,
});

/**
 * The way from where an agent steps out to its building's front door, in
 * straight stretches along pavements: from the center's steps down its square
 * to its street, then by the side roads street by street to the street its
 * front door opens onto, along it and up the path to the door. From a stop it
 * walks along the pavement and up to the door. Null when Town has no such
 * building, street or road.
 */
export function townArrivalPath(
  layout: TownLayout,
  route: TownBusRoute,
  agent: { hostKey: string; roomKey: string },
  from: TownArrivalFrom,
): TownPoint[] | null {
  const building = layout.buildings.find((b) => b.hostKey === agent.hostKey);
  if (!building) return null;
  const door = at(building.entryX, building.y + 1);
  const roads = [...new Set(layout.roads)].sort((a, b) => a - b);
  // The street its front door opens onto: the last one above it.
  const front = roads.reduce(
    (found, road, index) => (road + STREET <= building.y ? index : found),
    -1,
  );
  if (front < 0) return null;
  const points: TownPoint[] = [];
  if (from === "stop") {
    const stop = townNearestStop(route, layout, building, agent.roomKey);
    if (!stop) return null;
    points.push(stop.wait, { x: door.x, y: stop.wait.y });
  } else {
    const center = layout.center;
    const mid = center.x + Math.floor(center.w / 2);
    let street = roads.indexOf(center.street);
    if (street < 0) return null;
    let x = mid;
    points.push(at(mid, center.y + center.h - 1), at(mid, roads[street]!));
    const nearest = (roadsBetween: TownLayout["verticalRoads"]) =>
      roadsBetween.reduce<TownLayout["verticalRoads"][number] | null>(
        (best, road) =>
          !best ||
          Math.abs(road.x - x) + Math.abs(road.x - building.entryX) <
            Math.abs(best.x - x) + Math.abs(best.x - building.entryX)
            ? road
            : best,
        null,
      );
    while (street !== front) {
      const down = front > street;
      const top = roads[down ? street : street - 1]!;
      const bottom = roads[down ? street + 1 : street]!;
      const side = nearest(
        layout.verticalRoads.filter(
          (road) => road.y0 === top + ROAD_GAP && road.y1 === bottom,
        ),
      );
      if (!side) return null;
      // Cross to the pavement on the way, along it to the side road, then
      // down (or up) the side road's pavement to the next street.
      const here = roads[street]! + (down ? STREET - 1 : 0);
      points.push(
        at(x, here),
        at(side.x, here),
        at(side.x, down ? bottom : top + STREET - 1),
      );
      x = side.x;
      street += down ? 1 : -1;
    }
    const pavement = roads[front]! + STREET - 1;
    points.push(at(x, pavement), { x: door.x, y: at(0, pavement).y });
  }
  points.push(door);
  return points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1]!.x ||
      point.y !== points[index - 1]!.y,
  );
}

/** A path's length in world pixels. */
export function townPathLength(points: readonly TownPoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1)
    length +=
      Math.abs(points[index]!.x - points[index - 1]!.x) +
      Math.abs(points[index]!.y - points[index - 1]!.y);
  return length;
}

/** How long an arrival walks `points`: walking pace, hurried past the cap. */
export function townArrivalWalkMs(points: readonly TownPoint[]) {
  return Math.min(
    TOWN_ARRIVAL_WALK_MS,
    (townPathLength(points) / TOWN_WALK_SPEED) * 1000,
  );
}

/**
 * Where an arriving agent is `walked` pixels along its path, with the
 * walking frames the actors use (a step every 6 px). At the end it stands
 * facing the door.
 */
export function townPathPose(
  points: readonly TownPoint[],
  walked: number,
): {
  x: number;
  y: number;
  dir: TownDirection;
  frame: number;
  walking: boolean;
} {
  let left = Math.max(0, walked);
  const frame = Math.floor(left / 6) % 4;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const step = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left < step) {
      const k = left / step;
      const dir: TownDirection =
        b.x !== a.x
          ? b.x > a.x
            ? "right"
            : "left"
          : b.y > a.y
            ? "down"
            : "up";
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        dir,
        frame,
        walking: true,
      };
    }
    left -= step;
  }
  const end = points[points.length - 1] ?? { x: 0, y: 0 };
  return { x: end.x, y: end.y, dir: "up", frame: 0, walking: false };
}
