/**
 * Town's bus, as geometry: a stop at every road crossing, the one route the
 * bus drives past all of them, and where each binned agent waits. Pure: the
 * service owns the schedule (shared/bin.ts) and who rides; this places them.
 */

import type { BinEntry } from "../../../../shared/bin";
import { binClockLabel } from "../bin/binStore";
import {
  TOWN_TILE as T,
  type TownBuilding,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { TOWN_WALK_SPEED } from "./townActors";
import type { TownDirection } from "./townSprites";

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

export type TownBusStop = {
  key: string;
  /** Where its riders wait, on the pavement beside the crossing. */
  wait: TownPoint;
  /** How far along the route the bus passes it, in world pixels. */
  at: number;
  /**
   * Riders in each row of its queue: as many as its pavement holds before
   * the next stop's sign along the street or the map's edge, at most
   * TOWN_QUEUE_ROW.
   */
  row: number;
};

/** One pass along a street, edge to edge, at the lanes' height. */
export type TownBusLeg = { y: number; from: number; to: number };

export type TownBusRoute = {
  legs: readonly TownBusLeg[];
  length: number;
  stops: readonly TownBusStop[];
  /** The map's width in world pixels: the bus fades in and out beyond it. */
  width: number;
};

const lane = (road: number) => (road + STREET / 2) * T;
/** Each street is driven from this many tiles off the map to as many beyond it. */
const OFF_MAP = 6;

/**
 * Every crossing of a street and a side road has a stop. The bus drives
 * every street from one edge of the map to the other, alternating
 * direction, so it passes every crossing whatever the rows' widths; between
 * streets it is off the map.
 */
export function townBusRoute(layout: TownLayout): TownBusRoute {
  const roads = [...new Set(layout.roads)].sort((a, b) => a - b);
  const left = -OFF_MAP * T;
  const right = (layout.width + OFF_MAP) * T;
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
          row: 1,
        });
      }
  });
  for (const stop of stops) {
    // A queue runs left along the pavement from the stop, its front row
    // half a step further out, and ends short of the sign to its left.
    const bound = Math.max(
      0,
      ...stops
        .filter((o) => o.wait.y === stop.wait.y && o.wait.x < stop.wait.x)
        .map((o) => o.wait.x + SIGN_RIGHT),
    );
    const room = stop.wait.x - bound - HALF_AGENT - TOWN_QUEUE_GAP / 2;
    stop.row = Math.max(
      1,
      Math.min(TOWN_QUEUE_ROW, Math.floor(room / TOWN_QUEUE_GAP) + 1),
    );
  }
  return { legs, length: legs.length * span, stops, width: layout.width * T };
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

/** The leftmost point a stop's queue of `shown` riders reaches. */
export function townQueueLeft(stop: TownBusStop, shown: number) {
  return shown > stop.row
    ? townQueueSpot(stop, stop.row).x
    : townQueueSpot(stop, Math.max(0, shown - 1)).x;
}

/** About how long the bus waits at each stop where someone boards. */
export const TOWN_BUS_DWELL_MS = 10_000;
/** The bus's slowest cruise, in world pixels a second (agents walk ~80). */
const CRUISE_MIN = 80;
const CRUISE_MAX = 2_000;
/** Seconds the bus takes to reach its cruise from a stop, or to stop from it. */
const EASE_S = 3;

/** A stretch of steady acceleration: its start speed, rate and length in s. */
type Phase = { t: number; v: number; acc: number };

/**
 * How the bus drives `length` pixels at cruise `v` (rate `a`), coming in
 * moving or from a stop (`moving0`) and leaving moving or stopping
 * (`moving1`). Too short to reach cruise, it changes speed just enough.
 */
function drivePhases(
  length: number,
  moving0: boolean,
  moving1: boolean,
  v: number,
  a: number,
): Phase[] {
  if (length <= 0) return [];
  if (moving0 && moving1) return [{ t: length / v, v, acc: 0 }];
  const ramp = (v * v) / (2 * a);
  if (moving0 !== moving1) {
    if (length < ramp) {
      const acc = (v * v) / (2 * length);
      return [{ t: v / acc, v: moving0 ? v : 0, acc: moving0 ? -acc : acc }];
    }
    const change = { t: v / a, v: moving0 ? v : 0, acc: moving0 ? -a : a };
    const cruise = { t: (length - ramp) / v, v, acc: 0 };
    return moving0 ? [cruise, change] : [change, cruise];
  }
  if (length < 2 * ramp) {
    const peak = Math.sqrt(a * length);
    return [
      { t: peak / a, v: 0, acc: a },
      { t: peak / a, v: peak, acc: -a },
    ];
  }
  return [
    { t: v / a, v: 0, acc: a },
    { t: (length - 2 * ramp) / v, v, acc: 0 },
    { t: v / a, v, acc: -a },
  ];
}

const phasesTime = (phases: readonly Phase[]) =>
  phases.reduce((sum, phase) => sum + phase.t, 0);

function phasesDistance(phases: readonly Phase[], t: number) {
  let done = 0;
  for (const phase of phases) {
    const step = Math.min(t, phase.t);
    done += phase.v * step + 0.5 * phase.acc * step * step;
    if (t <= phase.t) return done;
    t -= phase.t;
  }
  return done;
}

/** One trip's drive: when it comes in, each halt, and where it is when. */
export type TownBusTimeline = {
  /** Seconds into the trip the bus comes in; it waits off the map until then. */
  start: number;
  pieces: readonly {
    t0: number;
    t1: number;
    from: number;
    /** Where the piece ends: the next stop, or the route's end. */
    to: number;
    phases: readonly Phase[];
  }[];
  /** Each stop the bus waits at: its arrival, in seconds into the trip. */
  halts: ReadonlyMap<string, number>;
  /** The cruise it drives at, in world pixels a second. */
  cruise: number;
  length: number;
};

/**
 * Fit the bus's drive into the trip, which the service times: it comes in,
 * slows to each stop in `halting` (where someone boards), waits about 10 s,
 * speeds up and goes on, and leaves the map as the trip ends. It drives no
 * faster than it must; with time to spare it comes in later.
 */
export function townBusTimeline(
  route: TownBusRoute,
  halting: ReadonlySet<string>,
  tripMs: number,
): TownBusTimeline {
  const stops: TownBusStop[] = [];
  for (const stop of [...route.stops].sort((a, b) => a.at - b.at))
    if (halting.has(stop.key) && !stops.some((s) => s.at === stop.at))
      stops.push(stop);
  const trip = tripMs / 1000;
  // Many stops share at most half the trip, so the bus still has time to drive.
  const dwell = Math.min(
    TOWN_BUS_DWELL_MS / 1000,
    (trip * 0.5) / Math.max(1, stops.length),
  );
  const marks = [0, ...stops.map((stop) => stop.at), route.length];
  const plan = (v: number) =>
    marks
      .slice(1)
      .map((to, index) =>
        drivePhases(
          to - marks[index]!,
          index === 0,
          index === marks.length - 2,
          v,
          v / EASE_S,
        ),
      );
  const drive = (v: number) =>
    plan(v).reduce((sum, phases) => sum + phasesTime(phases), 0);
  const budget = Math.max(0, trip - dwell * stops.length);
  let cruise = CRUISE_MIN;
  if (drive(CRUISE_MIN) > budget) {
    let low = CRUISE_MIN;
    let high = CRUISE_MAX;
    for (let step = 0; step < 40; step += 1) {
      const mid = (low + high) / 2;
      if (drive(mid) > budget) low = mid;
      else high = mid;
    }
    cruise = high;
  }
  const legs = plan(cruise);
  let t = Math.max(0, budget - drive(cruise));
  const start = t;
  const pieces: TownBusTimeline["pieces"][number][] = [];
  const halts = new Map<string, number>();
  legs.forEach((phases, index) => {
    const from = marks[index]!;
    const to = marks[index + 1]!;
    pieces.push({ t0: t, t1: t + phasesTime(phases), from, to, phases });
    t += phasesTime(phases);
    const stop = stops[index];
    if (!stop) return;
    halts.set(stop.key, t);
    for (const other of route.stops)
      if (other.at === stop.at) halts.set(other.key, t);
    pieces.push({
      t0: t,
      t1: t + dwell,
      from: stop.at,
      to: stop.at,
      phases: [],
    });
    t += dwell;
  });
  return { start, pieces, halts, cruise, length: route.length };
}

/** A stop's clock reads "due" from this long before the bus pulls in. */
export const TOWN_BUS_DUE_MS = 5_000;

/**
 * What a stop's clock reads. The trip starts with the bus off the map (it
 * comes in late when it has time to spare, see townBusTimeline) and drives
 * the route first, so the clock counts to when the bus pulls in at this
 * stop: `halt` in this trip, seconds into it, for those riding it, and
 * `nextHalt` in the next one for those waiting for it. It reads "due" in
 * the last few seconds and while the bus stands there, "stopped" while the
 * bus is stopped.
 */
export function townStopClock({
  elapsed,
  next,
  stopped,
  riding,
  halt,
  nextHalt,
}: {
  /** ms into the trip on the map, or null (binBusClock). */
  elapsed: number | null;
  /** ms until the next trip sets off (binBusClock). */
  next: number;
  stopped: boolean;
  /** Someone at the stop rides the trip on the map. */
  riding: boolean;
  halt: number | undefined;
  nextHalt: number | undefined;
}) {
  if (elapsed !== null && riding && stopped) return "stopped";
  const until =
    elapsed !== null && riding
      ? (halt ?? 0) * 1000 - elapsed
      : next + (nextHalt ?? 0) * 1000;
  return until <= TOWN_BUS_DUE_MS ? "due" : binClockLabel(until);
}

/**
 * How far along the route the bus is `elapsedMs` into its trip, or null
 * while it has not yet come in.
 */
/** A microsecond: closer than this to a piece's end is at its end. */
const END_S = 1e-6;

export function townBusAlong(timeline: TownBusTimeline, elapsedMs: number) {
  const t = elapsedMs / 1000;
  if (t < timeline.start) return null;
  for (const piece of timeline.pieces)
    if (t <= piece.t1)
      // A piece's end is its mark exactly; summed phases may round short.
      return t >= piece.t1 - END_S
        ? piece.to
        : piece.from + phasesDistance(piece.phases, t - piece.t0);
  return timeline.length;
}

/**
 * How much of the bus shows at `x`: it fades in as it comes onto the map
 * and out as it leaves, so it is gone from the screen when its trip ends.
 */
export function townBusOpacity(route: TownBusRoute, x: number) {
  const outside = Math.max(0, -x, x - route.width);
  return Math.max(0, Math.min(1, 1 - (outside - 1.5 * T) / (3 * T)));
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
    const building = layout.buildings.find((b) => b.hostKey === agent.hostKey);
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
