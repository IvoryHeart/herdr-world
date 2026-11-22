/**
 * Town's bus, as geometry: a stop at every road crossing, the bus's terminus
 * at Apartments, the roads it drives between them, and where each binned
 * agent waits. Pure: the service owns the schedule (shared/bin.ts) and who
 * rides; this places them, and townBusDrive.ts times the drive.
 */

import type { BinEntry } from "../../../../shared/bin";
import {
  TOWN_TILE as T,
  type TownBuilding,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { TOWN_WALK_SPEED } from "./townActors";
import {
  townApartmentsDoor,
  townApartmentsLot,
  townApartmentsPathColumn,
} from "./townApartmentsLot";
import {
  TOWN_BUS_DOOR_DX,
  townLaneY,
  townRoadGraph,
  type TownRoadGraph,
} from "./townBusDrive";
import type { TownDirection } from "./townSprites";
import { townBuildingOf } from "./townBuildings";

/** A street is five tiles: pavement, three lanes, pavement. */
const STREET = 5;
/** Riders queue along the pavement this far apart, in world pixels. */
export const TOWN_QUEUE_GAP = 18;
/** The most riders standing in one row of a stop's queue. */
export const TOWN_QUEUE_ROW = 10;
/**
 * A long queue turns back once, in front of itself: two rows at most. Past
 * them the queue's last place is a count of everyone else.
 */
export const TOWN_QUEUE_ROWS = 2;
/** The front row stands this much nearer the viewer, still on the pavement. */
const QUEUE_ROW_DY = 7;
/** Pavement right of a stop's waiting point taken by its pole and flag. */
const SIGN_RIGHT = 28;
/** Half a standing agent's width, so none overhangs what it must not cover. */
const HALF_AGENT = 10;
/**
 * The fewest tiles between two stops on one street: a stop's queue, turned
 * back once, still clears the sign of the stop to its left. Crossings nearer
 * than this (stacked buildings of slightly different widths) share one stop.
 */
export const TOWN_STOP_SPACING = Math.ceil(
  (SIGN_RIGHT + HALF_AGENT + TOWN_QUEUE_GAP / 2) / T,
);

export type TownBusStop = {
  key: string;
  /** Where its riders wait, on the pavement beside the crossing. */
  wait: TownPoint;
  /** Where the bus halts for it, on the street's lanes just short of the crossing. */
  halt: TownPoint;
  /**
   * Riders in each row of its queue: as many as its pavement holds before
   * the next stop's sign along the street or the map's edge, at most
   * TOWN_QUEUE_ROW.
   */
  row: number;
};

/**
 * The bus's home and every trip's end: Apartments' stop, on the last street
 * above the building, where riders step off and walk in by its door.
 */
export type TownBusTerminus = {
  /** Where the bus stands, parked between trips and letting riders off. */
  halt: TownPoint;
  /** Riders step off onto the pavement here, beside its front door. */
  kerb: TownPoint;
  /** Their walk from the kerb, its last point the door they go in by. */
  walk: readonly TownPoint[];
  /** The stop's sign's foot (like a stop's `wait`), or null at the center. */
  sign: TownPoint | null;
  /**
   * Apartments, or the town center where a town too small for the building
   * (townApartmentsLot) opens Apartments from the center instead.
   */
  to: "apartments" | "center";
};

export type TownBusRoute = {
  stops: readonly TownBusStop[];
  terminus: TownBusTerminus | null;
  /** The streets and side roads the bus drives (townBusDrive.ts). */
  graph: TownRoadGraph;
};

const lane = townLaneY;
/** A stop's bus halts this far left of where its riders wait, clear of the crossing. */
const HALT_BEFORE = 24;
/** The bus's half length: a halt stays this far inside the map. */
const BUS_HALF = 32;

/**
 * Where the bus parks and riders get off: on the last street, its front
 * door at the top of a footpath (layoutTown paints it) beside Apartments,
 * down to the plaza's walk and in at the building's door. Without the
 * building, in front of the town center's door.
 */
export function townBusTerminus(
  layout: Pick<TownLayout, "roads" | "plaza" | "width" | "center">,
): TownBusTerminus | null {
  if (!layout.roads.length) return null;
  const lot = townApartmentsLot(layout);
  if (lot) {
    const last = Math.max(...layout.roads);
    const pathX = (townApartmentsPathColumn(lot, layout.plaza) + 0.5) * T;
    const kerb = { x: pathX, y: (last + STREET - 0.5) * T };
    const walkY = (layout.plaza.y + 0.5) * T;
    const door = townApartmentsDoor(lot);
    return {
      halt: { x: pathX - TOWN_BUS_DOOR_DX, y: lane(last) },
      kerb,
      walk: [kerb, { x: pathX, y: walkY }, { x: door.x, y: walkY }, door],
      sign: { x: pathX + 6, y: kerb.y },
      to: "apartments",
    };
  }
  const { center } = layout;
  if (!layout.roads.includes(center.street)) return null;
  const doorX = (center.x + center.w / 2) * T;
  const kerb = { x: doorX, y: (center.street + 0.5) * T };
  return {
    halt: { x: doorX - TOWN_BUS_DOOR_DX, y: lane(center.street) },
    kerb,
    walk: [kerb, { x: doorX, y: center.street * T - 2 }],
    sign: null,
    to: "center",
  };
}

/**
 * Every crossing of a street and a side road has a stop, the town's left
 * edge roads included, shared with any crossing on that street fewer than
 * TOWN_STOP_SPACING tiles away. The bus lives at its terminus (Apartments)
 * and drives only the town's roads (townBusDrive.ts), out to the stops where
 * someone waits and back, so it never leaves the map.
 */
export function townBusRoute(layout: TownLayout): TownBusRoute {
  const roads = [...new Set(layout.roads)].sort((a, b) => a - b);
  const terminus = townBusTerminus(layout);
  const stops: TownBusStop[] = [];
  for (const road of roads)
    for (const side of layout.verticalRoads)
      if (side.y0 === road + STREET || side.y1 === road) {
        const wait = { x: (side.x - 0.5) * T, y: (road + STREET - 0.5) * T };
        if (
          stops.some(
            (stop) =>
              stop.wait.y === wait.y &&
              Math.abs(stop.wait.x - wait.x) < TOWN_STOP_SPACING * T,
          )
        )
          continue;
        stops.push({
          key: `${side.x}:${road}`,
          wait,
          halt: {
            x: Math.max(BUS_HALF, wait.x - HALT_BEFORE),
            y: lane(road),
          },
          row: 1,
        });
      }
  // Apartments' sign stands on its street's pavement like a stop's.
  const signs = [
    ...stops.map((stop) => stop.wait),
    ...(terminus?.sign ? [terminus.sign] : []),
  ];
  for (const stop of stops) {
    // A queue runs left along the pavement from the stop, its front row
    // half a step further out, and ends short of the sign to its left.
    const bound = Math.max(
      0,
      ...signs
        .filter((o) => o.y === stop.wait.y && o.x < stop.wait.x)
        .map((o) => o.x + SIGN_RIGHT),
    );
    const room = stop.wait.x - bound - HALF_AGENT - TOWN_QUEUE_GAP / 2;
    stop.row = Math.max(
      1,
      Math.min(TOWN_QUEUE_ROW, Math.floor(room / TOWN_QUEUE_GAP) + 1),
    );
  }
  const graph = townRoadGraph(layout, [
    ...stops.map((stop) => stop.halt),
    ...(terminus ? [terminus.halt] : []),
  ]);
  return { stops, terminus, graph };
}

/**
 * How a stop's queue of `count` riders shows: `shown` stand in it, and past
 * its two rows the last place reads "+`more`" for the rest. `front` stand
 * in its first row, the one the clock is over.
 */
export function townQueueShape(stop: TownBusStop, count: number) {
  const places = stop.row * TOWN_QUEUE_ROWS;
  const shown = count > places ? places - 1 : count;
  return { shown, more: count - shown, front: Math.min(shown, stop.row) };
}

/**
 * Place `slot` in a stop's queue. The first row runs left along the pavement
 * from the stop; a longer queue turns and comes back in front of it, half a
 * step out so the heads behind still show, ending beside the stop again.
 */
export function townQueueSpot(stop: TownBusStop, slot: number): TownPoint {
  const k = slot % stop.row;
  if (slot < stop.row)
    return { x: stop.wait.x - k * TOWN_QUEUE_GAP, y: stop.wait.y };
  return {
    x: stop.wait.x - (stop.row - 1 - k) * TOWN_QUEUE_GAP - TOWN_QUEUE_GAP / 2,
    y: stop.wait.y + QUEUE_ROW_DY,
  };
}

/**
 * What each stop's "+N" board still counts: those counted in it that are
 * not yet on the bus. Once the bus takes them all, a stop is left out and
 * its board comes down with the queue it stood for.
 */
export function townQueueMoreLeft(
  riders: readonly Pick<TownBinRider, "entry" | "stop" | "counted">[],
  boarded: ReadonlySet<string>,
): Map<string, number> {
  const left = new Map<string, number>();
  for (const rider of riders)
    if (rider.counted && !boarded.has(rider.entry.id))
      left.set(rider.stop.key, (left.get(rider.stop.key) ?? 0) + 1);
  return left;
}

/** The leftmost point a stop's queue of `shown` riders reaches. */
export function townQueueLeft(stop: TownBusStop, shown: number) {
  return shown > stop.row
    ? townQueueSpot(stop, stop.row).x
    : townQueueSpot(stop, Math.max(0, shown - 1)).x;
}

/** A binned agent shown in Town, at the stop nearest its room. */
export type TownBinRider = {
  entry: BinEntry;
  agentKey: string;
  stop: TownBusStop;
  /** Its place in the stop's queue: joining, it takes the end. */
  slot: number;
  /**
   * Counted in its stop's "+N" rather than standing: it walks to the
   * queue's last place (the count's) and waits there unseen.
   */
  counted: boolean;
  /** Where it stands, and the front door it walks out of. */
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
  const placed: Omit<TownBinRider, "counted" | "at">[] = [];
  const queues = new Map<string, number>();
  for (const entry of entries) {
    const agentKey = agentOf(entry);
    if (!agentKey) continue;
    away.add(agentKey);
    const agent = model.agents.get(agentKey)!;
    const home = townBuildingOf(agent);
    const building = layout.buildings.find((b) => b.hostKey === home);
    const stop = building
      ? townNearestStop(route, layout, building, agent.roomKey)
      : null;
    if (!building || !stop) continue;
    const slot = queues.get(stop.key) ?? 0;
    queues.set(stop.key, slot + 1);
    placed.push({
      entry,
      agentKey,
      stop,
      slot,
      // Where its actor stood as it went out: the front door's tile.
      door: { x: (building.entryX + 0.5) * T, y: (building.y + 1) * T + 13 },
    });
  }
  // Everyone waiting stands in the queue, up to its two rows; past them the
  // rest wait in its last place, which shows their count.
  const riders = placed.map((rider): TownBinRider => {
    const { shown } = townQueueShape(rider.stop, queues.get(rider.stop.key)!);
    const counted = rider.slot >= shown;
    return {
      ...rider,
      counted,
      at: townQueueSpot(rider.stop, counted ? shown : rider.slot),
    };
  });
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

/**
 * A waiting rider's walk outside: whether this page saw its actor indoors
 * (on its way out), and when it went out of the front door (ms), or null
 * while it is not out.
 */
export type TownRiderOuting = { indoors: boolean; out: number | null };

/**
 * A rider's outing before Town first draws it. One this page has never
 * shown (binned here a moment ago, or on Board before Town was opened)
 * counts as on its way out, so it walks from its front door; one this page
 * already showed outside (Town opened again) stands at its stop.
 */
export function townRiderFirstOuting(shownBefore: boolean): TownRiderOuting {
  return { indoors: !shownBefore, out: null };
}

/**
 * A rider's outing after the frame drawn at `time`, where its actor is out
 * of the front door (`out`), indoors, or not drawn yet (null). One seen
 * indoors walks from the door when it goes out, however long its walk
 * indoors took (slower on a phone, where frames come less often). One
 * already out when first seen and not counted as on its way out
 * (townRiderFirstOuting) stands at its stop, as every rider does with
 * reduced motion.
 */
export function townRiderOuting(
  outing: TownRiderOuting,
  out: boolean | null,
  time: number,
  still: boolean,
): TownRiderOuting {
  if (out === null) return { indoors: outing.indoors, out: null };
  if (!out) return { indoors: true, out: null };
  if (outing.out !== null) return outing;
  return {
    indoors: outing.indoors,
    out: outing.indoors && !still ? time : -Infinity,
  };
}

/**
 * A binned agent `seconds` after it went out of its front door (`from`):
 * up to the pavement, then along it to its place at the stop (`to`), at
 * the agents' indoor walking speed and with their walking frames (a step
 * every 6 px, as townRendererActors draws them). There it stands facing out.
 */
export function townRiderWalk(
  from: TownPoint,
  to: TownPoint,
  seconds: number,
): {
  x: number;
  y: number;
  dir: TownDirection;
  frame: number;
  walking: boolean;
} {
  const up = Math.abs(to.y - from.y);
  const along = Math.abs(to.x - from.x);
  const walked = Math.max(0, seconds) * TOWN_WALK_SPEED;
  if (!(walked < up + along))
    return { x: to.x, y: to.y, dir: "down", frame: 0, walking: false };
  const frame = Math.floor(walked / 6) % 4;
  if (walked < up)
    return {
      x: from.x,
      y: from.y + Math.sign(to.y - from.y) * walked,
      dir: to.y < from.y ? "up" : "down",
      frame,
      walking: true,
    };
  return {
    x: from.x + Math.sign(to.x - from.x) * (walked - up),
    y: to.y,
    dir: to.x < from.x ? "left" : "right",
    frame,
    walking: true,
  };
}

/** A walk's length along `points`, in world pixels. */
export function townWalkLength(points: readonly TownPoint[]) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1)
    length +=
      Math.abs(points[i]!.x - points[i - 1]!.x) +
      Math.abs(points[i]!.y - points[i - 1]!.y);
  return length;
}

/**
 * An agent `walked` pixels along `points` (straight runs, across or up and
 * down), with the walking frames townRiderWalk draws; at the end it stands,
 * facing the way it last walked.
 */
export function townWalkAlong(
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
  let dir: TownDirection = "down";
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (!length) continue;
    dir =
      b.x !== a.x ? (b.x < a.x ? "left" : "right") : b.y < a.y ? "up" : "down";
    if (left < length) {
      const k = left / length;
      return {
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        dir,
        frame: Math.floor(walked / 6) % 4,
        walking: true,
      };
    }
    left -= length;
  }
  const end = points[points.length - 1] ?? { x: 0, y: 0 };
  return { x: end.x, y: end.y, dir, frame: 0, walking: false };
}

/** How long a rider's walk between `from` and `to` takes, in ms. */
export function townRiderWalkMs(from: TownPoint, to: TownPoint) {
  return (
    ((Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) / TOWN_WALK_SPEED) *
    1000
  );
}

/**
 * A rider put back, `seconds` after it left its place in the queue (`at`):
 * its walk out backwards, along the pavement and down to its front door
 * (`door`), where its actor takes over and goes back in.
 */
export function townRiderWalkBack(
  door: TownPoint,
  at: TownPoint,
  seconds: number,
): {
  x: number;
  y: number;
  dir: TownDirection;
  frame: number;
  walking: boolean;
} {
  const along = Math.abs(at.x - door.x);
  const down = Math.abs(at.y - door.y);
  const walked = Math.max(0, seconds) * TOWN_WALK_SPEED;
  if (!(walked < along + down))
    return { x: door.x, y: door.y, dir: "up", frame: 0, walking: false };
  const frame = Math.floor(walked / 6) % 4;
  if (walked < along)
    return {
      x: at.x + Math.sign(door.x - at.x) * walked,
      y: at.y,
      dir: door.x < at.x ? "left" : "right",
      frame,
      walking: true,
    };
  return {
    x: door.x,
    y: at.y + Math.sign(door.y - at.y) * (walked - along),
    dir: door.y < at.y ? "up" : "down",
    frame,
    walking: true,
  };
}

/** A put-back rider on its walk home, from `start` until `end` (ms). */
export type TownRiderReturn = {
  rider: TownBinRider;
  start: number;
  end: number;
};

/**
 * The riders walking back to their front doors at `now`, after the bin's
 * riders went from `before` to `riders`. One that stood outside
 * (`outside`) and left the bin without closing (`bin.closing`: the bus took
 * it) walks home from its place in the queue; one binned again, or home,
 * stops. Its agent stays out of its room until then (useTownBin).
 */
export function townRiderReturns(
  returns: readonly TownRiderReturn[],
  before: readonly TownBinRider[],
  riders: readonly TownBinRider[],
  bin: { entries: readonly BinEntry[]; closing: readonly BinEntry[] },
  outside: (id: string) => boolean,
  now: number,
): TownRiderReturn[] {
  const binned = new Set(
    [...bin.entries, ...bin.closing].map((entry) => entry.id),
  );
  const waiting = new Set(riders.map((rider) => rider.agentKey));
  const next = returns.filter(
    (walk) => walk.end > now && !waiting.has(walk.rider.agentKey),
  );
  for (const rider of before)
    if (
      !binned.has(rider.entry.id) &&
      !waiting.has(rider.agentKey) &&
      outside(rider.entry.id) &&
      !next.some((walk) => walk.rider.agentKey === rider.agentKey)
    )
      next.push({
        rider,
        start: now,
        end: now + townRiderWalkMs(rider.door, rider.at),
      });
  return next;
}
