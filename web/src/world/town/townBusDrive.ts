/**
 * The bus's drive, as geometry and time: Town's streets and side roads as a
 * road graph, the nearest way from the bus's terminus (Apartments) past
 * every stop where someone waits and back, and the trip's timing — where
 * the bus is, which way it faces, when it slows, when its doors open, and
 * when its riders step off at the terminus. Pure: the service owns the
 * schedule (shared/bin.ts); TownBusLayer draws what this says.
 */

import { BIN_BUS_DWELL_MS } from "../../../../shared/bin";
import { TOWN_TILE as T, type TownLayout, type TownPoint } from "./townLayout";

/** A street is five tiles: pavement, three lanes, pavement. */
const STREET = 5;

export type TownFacing = "left" | "right" | "up" | "down";

/** The middle of a street's lanes, in world pixels. */
export const townLaneY = (road: number) => (road + STREET / 2) * T;
/** The middle of a side road's lanes, in world pixels. */
const sideLaneX = (x: number) => (x + STREET / 2) * T;

/**
 * Town's roads as a graph: a node at every crossing and at every point
 * (`extra`, on a street's lanes) the bus halts at, and an edge along each
 * street between neighbouring nodes and along each side road between the
 * streets it joins. The bus drives only on it, so never off the map.
 */
export type TownRoadGraph = {
  nodes: readonly TownPoint[];
  /** Each node's neighbours, by index. */
  next: readonly (readonly number[])[];
};

const keyOf = (point: TownPoint) => `${point.x},${point.y}`;

export function townRoadGraph(
  layout: Pick<TownLayout, "roads" | "verticalRoads">,
  extra: readonly TownPoint[],
): TownRoadGraph {
  const nodes: TownPoint[] = [];
  const index = new Map<string, number>();
  const node = (point: TownPoint) => {
    const key = keyOf(point);
    let at = index.get(key);
    if (at === undefined) {
      at = nodes.length;
      nodes.push(point);
      index.set(key, at);
    }
    return at;
  };
  const next: number[][] = [];
  const link = (a: number, b: number) => {
    if (a === b) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const out = (next[from] ??= []);
      if (!out.includes(to)) out.push(to);
    }
  };
  const roads = new Set(layout.roads);
  const onStreet = new Map<number, Set<number>>();
  const mark = (road: number, x: number) => {
    const xs = onStreet.get(road) ?? new Set<number>();
    xs.add(x);
    onStreet.set(road, xs);
  };
  for (const side of layout.verticalRoads) {
    const above = side.y0 - STREET;
    const below = side.y1;
    if (!roads.has(above) || !roads.has(below)) continue;
    const x = sideLaneX(side.x);
    mark(above, x);
    mark(below, x);
    link(node({ x, y: townLaneY(above) }), node({ x, y: townLaneY(below) }));
  }
  for (const point of extra) {
    const road = [...roads].find((r) => townLaneY(r) === point.y);
    if (road !== undefined) mark(road, point.x);
  }
  for (const [road, xs] of onStreet) {
    const sorted = [...xs].sort((a, b) => a - b);
    const y = townLaneY(road);
    for (let i = 1; i < sorted.length; i += 1)
      link(node({ x: sorted[i - 1]!, y }), node({ x: sorted[i]!, y }));
  }
  for (let i = 0; i < nodes.length; i += 1) next[i] ??= [];
  return { nodes, next };
}

const span = (a: TownPoint, b: TownPoint) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * The shortest way along the roads from `from`, as each node's distance and
 * the node it is reached from.
 */
function shortest(graph: TownRoadGraph, from: number) {
  const n = graph.nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[from] = 0;
  for (;;) {
    let at = -1;
    for (let i = 0; i < n; i += 1)
      if (!done[i] && dist[i]! < Infinity && (at < 0 || dist[i]! < dist[at]!))
        at = i;
    if (at < 0) break;
    done[at] = true;
    for (const to of graph.next[at]!) {
      const d = dist[at]! + span(graph.nodes[at]!, graph.nodes[to]!);
      if (d < dist[to]! - 1e-9) {
        dist[to] = d;
        prev[to] = at;
      }
    }
  }
  return { dist, prev };
}

/**
 * The bus's way from `from` past each of `halts` and back to `from`, by the
 * roads: the visiting order that drives least (every order for a few
 * halts, nearest-next then improved for many), and each leg's points.
 * Halts the roads do not reach are left out.
 */
export function townBusWay(
  graph: TownRoadGraph,
  from: TownPoint,
  halts: readonly { key: string; at: TownPoint }[],
): {
  order: string[];
  legs: TownPoint[][];
  length: number;
} {
  const indexOf = (point: TownPoint) =>
    graph.nodes.findIndex((node) => node.x === point.x && node.y === point.y);
  const start = indexOf(from);
  if (start < 0) return { order: [], legs: [], length: 0 };
  const places = [
    { key: "", node: start },
    ...halts
      .map((halt) => ({ key: halt.key, node: indexOf(halt.at) }))
      .filter((place) => place.node >= 0),
  ];
  const trees = places.map((place) => shortest(graph, place.node));
  const reach = (a: number, b: number) => trees[a]!.dist[places[b]!.node]!;
  const live = places
    .map((_, i) => i)
    .filter((i) => i > 0 && reach(0, i) < Infinity);
  const cost = (order: readonly number[]) => {
    let sum = 0;
    let at = 0;
    for (const i of order) {
      sum += reach(at, i);
      at = i;
    }
    return sum + reach(at, 0);
  };
  let best: number[] = [...live];
  if (live.length <= 7) {
    let bestCost = cost(best);
    const permute = (rest: number[], taken: number[]) => {
      if (!rest.length) {
        const c = cost(taken);
        if (c < bestCost - 1e-9) {
          bestCost = c;
          best = [...taken];
        }
        return;
      }
      for (let i = 0; i < rest.length; i += 1)
        permute(
          [...rest.slice(0, i), ...rest.slice(i + 1)],
          [...taken, rest[i]!],
        );
    };
    permute(live, []);
  } else {
    // Nearest next, then reverse any stretch that shortens the round.
    const left = new Set(live);
    best = [];
    let at = 0;
    while (left.size) {
      let pick = -1;
      for (const i of left)
        if (pick < 0 || reach(at, i) < reach(at, pick)) pick = i;
      best.push(pick);
      left.delete(pick);
      at = pick;
    }
    for (let improved = true, rounds = 0; improved && rounds < 20; rounds++) {
      improved = false;
      for (let i = 0; i < best.length - 1; i += 1)
        for (let j = i + 1; j < best.length; j += 1) {
          const tried = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          if (cost(tried) < cost(best) - 1e-9) {
            best = tried;
            improved = true;
          }
        }
    }
  }
  const legs: TownPoint[][] = [];
  let at = 0;
  for (const i of [...best, 0]) {
    const target = places[i]!.node;
    const { prev } = trees[at]!;
    const way: number[] = [target];
    while (way[0] !== places[at]!.node) way.unshift(prev[way[0]!]!);
    legs.push(way.map((n) => graph.nodes[n]!));
    at = i;
  }
  return {
    order: best.map((i) => places[i]!.key),
    legs,
    length: cost(best),
  };
}

/** The radius the bus turns a corner on, in world pixels. */
const CORNER_R = 14;

type Line = { kind: "line"; a: TownPoint; b: TownPoint; length: number };
type Arc = {
  kind: "arc";
  /** Where the arc begins, the way in and the way out (unit, on the axes). */
  a: TownPoint;
  d1: TownPoint;
  d2: TownPoint;
  r: number;
  length: number;
};

/** A leg of the drive: straight runs joined by quarter turns at corners. */
export type TownBusPath = {
  parts: readonly (Line | Arc)[];
  length: number;
};

const unit = (a: TownPoint, b: TownPoint) => ({
  x: Math.sign(b.x - a.x),
  y: Math.sign(b.y - a.y),
});

/** The leg through `points`, its corners rounded. */
export function townBusPath(points: readonly TownPoint[]): TownBusPath {
  // Drop repeats and points in the middle of a straight run.
  const way: TownPoint[] = [];
  for (const point of points) {
    const last = way[way.length - 1];
    if (last && last.x === point.x && last.y === point.y) continue;
    const before = way[way.length - 2];
    if (
      last &&
      before &&
      ((before.x === last.x && last.x === point.x) ||
        (before.y === last.y && last.y === point.y))
    )
      way.pop();
    way.push(point);
  }
  const parts: (Line | Arc)[] = [];
  let from = way[0];
  for (let i = 1; i < way.length; i += 1) {
    const corner = way[i]!;
    const after = way[i + 1];
    const d1 = unit(way[i - 1]!, corner);
    if (!after) {
      parts.push({
        kind: "line",
        a: from!,
        b: corner,
        length: span(from!, corner),
      });
      break;
    }
    const d2 = unit(corner, after);
    const r = Math.min(
      CORNER_R,
      span(way[i - 1]!, corner) / 2,
      span(corner, after) / 2,
    );
    const a = { x: corner.x - d1.x * r, y: corner.y - d1.y * r };
    parts.push({ kind: "line", a: from!, b: a, length: span(from!, a) });
    parts.push({ kind: "arc", a, d1, d2, r, length: (Math.PI / 2) * r });
    from = { x: corner.x + d2.x * r, y: corner.y + d2.y * r };
  }
  return {
    parts: parts.filter((part) => part.length > 0),
    length: parts.reduce((sum, part) => sum + part.length, 0),
  };
}

/** Where along `path` the bus is at `s` pixels, and the way it points. */
export function townBusPathAt(path: TownBusPath, s: number) {
  let left = Math.max(0, s);
  for (const part of path.parts) {
    if (left > part.length && part !== path.parts[path.parts.length - 1]) {
      left -= part.length;
      continue;
    }
    const k = part.length ? Math.min(1, left / part.length) : 1;
    if (part.kind === "line") {
      const d = unit(part.a, part.b);
      return {
        x: part.a.x + (part.b.x - part.a.x) * k,
        y: part.a.y + (part.b.y - part.a.y) * k,
        dx: d.x,
        dy: d.y,
        turning: false,
      };
    }
    const angle = (k * Math.PI) / 2;
    const { a, d1, d2, r } = part;
    return {
      x: a.x + d2.x * r * (1 - Math.cos(angle)) + d1.x * r * Math.sin(angle),
      y: a.y + d2.y * r * (1 - Math.cos(angle)) + d1.y * r * Math.sin(angle),
      dx: d1.x * Math.cos(angle) + d2.x * Math.sin(angle),
      dy: d1.y * Math.cos(angle) + d2.y * Math.sin(angle),
      turning: true,
    };
  }
  return { x: 0, y: 0, dx: 1, dy: 0, turning: false };
}

/**
 * The bus's slowest cruise, in world pixels a second (agents walk ~76; the
 * service's timetable speed is about 80): with time to spare it drives
 * slower rather than standing.
 */
const CRUISE_MIN = 40;
const CRUISE_MAX = 4_000;
/** Seconds the bus takes to reach its cruise from a stand, or to stop. */
const EASE_S = 2.5;
/** At a corner it slows to this share of its cruise, and no slower than… */
const CORNER_SHARE = 0.35;
const CORNER_MIN = 45;

/**
 * How the bus drives a leg at cruise `v`: from a stand, slowing into each
 * corner, and to a stand at its end. Cumulative distance (`s`) and seconds
 * (`t`) at fine samples along it.
 */
function driveProfile(path: TownBusPath, v: number) {
  const length = path.length;
  if (length <= 0) return { s: [0], t: [0] };
  const ds = Math.max(4, length / 1500);
  const n = Math.ceil(length / ds);
  const s = Array.from({ length: n + 1 }, (_, i) => Math.min(length, i * ds));
  const corners: [number, number][] = [];
  let along = 0;
  for (const part of path.parts) {
    if (part.kind === "arc") corners.push([along, along + part.length]);
    along += part.length;
  }
  const corner = Math.min(v, Math.max(CORNER_MIN, v * CORNER_SHARE));
  const a = v / EASE_S;
  const cap = s.map((at) =>
    corners.some(([c0, c1]) => at >= c0 - ds && at <= c1 + ds) ? corner : v,
  );
  const speed = [...cap];
  speed[0] = 0;
  speed[n] = 0;
  for (let i = 1; i <= n; i += 1)
    speed[i] = Math.min(
      speed[i]!,
      Math.sqrt(speed[i - 1]! ** 2 + 2 * a * (s[i]! - s[i - 1]!)),
    );
  for (let i = n - 1; i >= 0; i -= 1)
    speed[i] = Math.min(
      speed[i]!,
      Math.sqrt(speed[i + 1]! ** 2 + 2 * a * (s[i + 1]! - s[i]!)),
    );
  const t = [0];
  for (let i = 1; i <= n; i += 1) {
    const mean = (speed[i - 1]! + speed[i]!) / 2;
    t.push(t[i - 1]! + (mean > 0 ? (s[i]! - s[i - 1]!) / mean : 0));
  }
  return { s, t };
}

/** About how long the bus waits at each stop where someone boards. */
export const TOWN_BUS_DWELL_MS = BIN_BUS_DWELL_MS;
/** Its doors take this long to open, and to close. */
export const TOWN_BUS_DOOR_S = 0.8;
/** It turns round where it stands, when it must go back the way it came. */
export const TOWN_BUS_TURN_S = 1.6;
/** Riders step off this far apart at the terminus… */
const ALIGHT_STEP_S = 0.7;
/** …all of them within about this long. */
const ALIGHT_SPREAD_S = 8;
/** The last rider is in this long before the trip ends and they close. */
export const TOWN_BUS_IN_BEFORE_END_S = 0.4;
/** The way the bus faces, parked at its terminus between trips. */
export const TOWN_BUS_PARKED: TownFacing = "right";

type Stand = {
  kind: "stand";
  t0: number;
  t1: number;
  at: TownPoint;
  facing: TownFacing;
  /** Its doors stand open from `open` to `close`, seconds into the trip. */
  open?: number;
  close?: number;
};
type Turn = {
  kind: "turn";
  t0: number;
  t1: number;
  at: TownPoint;
  from: TownFacing;
  to: TownFacing;
};
type Drive = {
  kind: "drive";
  t0: number;
  t1: number;
  path: TownBusPath;
  s: readonly number[];
  /** Seconds from t0 at each sample. */
  t: readonly number[];
};

/** One trip, seconds into it: the bus's parts, each halt and the arrival. */
export type TownBusTimeline = {
  /** When it pulls away from the terminus; until then it stands parked. */
  start: number;
  pieces: readonly (Stand | Turn | Drive)[];
  /** Each stop it halts at: when it stands there, and its doors' times. */
  halts: ReadonlyMap<
    string,
    {
      at: number;
      open: number;
      close: number;
      point: TownPoint;
      facing: TownFacing;
    }
  >;
  /** At the terminus: when it stands there, its doors open, and riders' pace. */
  arrive: {
    at: number;
    open: number;
    /** Rider k (in boarding order) steps off at open + k·step. */
    step: number;
    point: TownPoint;
    facing: TownFacing;
  };
  /** The walk's length from the bus's door to the terminus's door, in s. */
  walk: number;
  cruise: number;
};

const facingOf = (dx: number, dy: number): TownFacing =>
  Math.abs(dx) >= Math.abs(dy)
    ? dx < 0
      ? "left"
      : "right"
    : dy < 0
      ? "up"
      : "down";

const opposite = (a: TownFacing, b: TownFacing) =>
  (a === "left" && b === "right") ||
  (a === "right" && b === "left") ||
  (a === "up" && b === "down") ||
  (a === "down" && b === "up");

function legFacing(points: readonly TownPoint[], end: boolean) {
  const path = townBusPath(points);
  if (!path.length) return null;
  const at = townBusPathAt(path, end ? path.length : 0);
  return facingOf(at.dx, at.dy);
}

/**
 * Fit the trip, which the service times from the bus's speed and its route
 * (`tripMs`, binBusTripMs): parked at `terminus`,
 * the bus pulls away, drives the nearest way past each stop in `halting`
 * (stops by key, with the point it halts at), stands there about 10 s with
 * its doors open, and comes back; there its `riders` step off and walk the
 * `walkS` seconds to the door, the last in just before the trip ends. It
 * drives no faster than it must; with time to spare it leaves later.
 */
export function townBusTimeline(
  graph: TownRoadGraph,
  terminus: TownPoint,
  halting: readonly { key: string; at: TownPoint }[],
  riders: number,
  walkS: number,
  tripMs: number,
): TownBusTimeline {
  const trip = tripMs / 1000;
  const way = townBusWay(graph, terminus, halting);
  const stops = way.order.map(
    (key) => halting.find((halt) => halt.key === key)!,
  );
  const people = Math.max(1, riders);
  const step = Math.min(ALIGHT_STEP_S, ALIGHT_SPREAD_S / people);
  const alight =
    TOWN_BUS_DOOR_S + (people - 1) * step + walkS + TOWN_BUS_IN_BEFORE_END_S;
  // The facings at each end of each leg, for the turns where it reverses.
  const ends = way.legs.map((leg) => ({
    from: legFacing(leg, false),
    to: legFacing(leg, true),
  }));
  let facing: TownFacing = TOWN_BUS_PARKED;
  const turns: boolean[] = [];
  ends.forEach((end) => {
    turns.push(!!end.from && opposite(facing, end.from));
    facing = end.to ?? end.from ?? facing;
  });
  const endTurn = opposite(facing, TOWN_BUS_PARKED);
  const turning =
    (turns.filter(Boolean).length + (endTurn ? 1 : 0)) * TOWN_BUS_TURN_S;
  // Many stops share at most 40% of the trip, so the bus still has time to drive.
  const room = Math.max(0, trip - alight - turning);
  const dwell = Math.min(
    TOWN_BUS_DWELL_MS / 1000,
    (room * 0.4) / Math.max(1, stops.length),
  );
  const paths = way.legs.map((leg) => townBusPath(leg));
  const drive = (v: number) =>
    paths.reduce((sum, path) => {
      const { t } = driveProfile(path, v);
      return sum + t[t.length - 1]!;
    }, 0);
  const budget = Math.max(0, room - dwell * stops.length);
  let cruise = CRUISE_MIN;
  if (drive(CRUISE_MIN) > budget) {
    let low = CRUISE_MIN;
    let high = CRUISE_MAX;
    for (let i = 0; i < 30; i += 1) {
      const mid = (low + high) / 2;
      if (drive(mid) > budget) low = mid;
      else high = mid;
    }
    cruise = high;
  }
  const profiles = paths.map((path) => driveProfile(path, cruise));
  // Too far for even the fastest cruise: the drive is hurried to fit.
  const total = profiles.reduce((sum, p) => sum + p.t[p.t.length - 1]!, 0);
  const hurry = total > budget && total > 0 ? budget / total : 1;
  let t = Math.max(0, budget - total * hurry);
  const start = t;
  const pieces: (Stand | Turn | Drive)[] = [];
  const halts = new Map<
    string,
    {
      at: number;
      open: number;
      close: number;
      point: TownPoint;
      facing: TownFacing;
    }
  >();
  let at = terminus;
  facing = TOWN_BUS_PARKED;
  let arrive: TownBusTimeline["arrive"] = {
    at: t,
    open: t + TOWN_BUS_DOOR_S,
    step,
    point: terminus,
    facing,
  };
  paths.forEach((path, index) => {
    const end = ends[index]!;
    if (turns[index] && end.from) {
      pieces.push({
        kind: "turn",
        t0: t,
        t1: t + TOWN_BUS_TURN_S,
        at,
        from: facing,
        to: end.from,
      });
      t += TOWN_BUS_TURN_S;
    }
    const profile = profiles[index]!;
    const times = profile.t.map((x) => x * hurry);
    const length = times[times.length - 1]!;
    if (path.length > 0)
      pieces.push({
        kind: "drive",
        t0: t,
        t1: t + length,
        path,
        s: profile.s,
        t: times,
      });
    t += length;
    facing = end.to ?? end.from ?? facing;
    const stop = stops[index];
    const leg = way.legs[index]!;
    at = leg[leg.length - 1] ?? at;
    if (stop) {
      const open = t + Math.min(TOWN_BUS_DOOR_S, dwell / 4);
      const close = t + dwell - Math.min(TOWN_BUS_DOOR_S, dwell / 4);
      halts.set(stop.key, { at: t, open, close, point: at, facing });
      pieces.push({
        kind: "stand",
        t0: t,
        t1: t + dwell,
        at,
        facing,
        open,
        close,
      });
      t += dwell;
    } else {
      // It turns round to face its parked way before its doors open, so they
      // open onto the footpath to the door and its riders step off there.
      if (endTurn) {
        pieces.push({
          kind: "turn",
          t0: t,
          t1: t + TOWN_BUS_TURN_S,
          at,
          from: facing,
          to: TOWN_BUS_PARKED,
        });
        t += TOWN_BUS_TURN_S;
        facing = TOWN_BUS_PARKED;
      }
      arrive = {
        at: t,
        open: t + TOWN_BUS_DOOR_S,
        step,
        point: at,
        facing,
      };
      const close = t + TOWN_BUS_DOOR_S + (people - 1) * step + TOWN_BUS_DOOR_S;
      pieces.push({
        kind: "stand",
        t0: t,
        t1: close,
        at,
        facing,
        open: arrive.open,
        close,
      });
      t = close;
    }
  });
  return { start, pieces, halts, arrive, walk: walkS, cruise };
}

/** How the bus shows at a moment. */
export type TownBusPose = {
  x: number;
  y: number;
  facing: TownFacing;
  /** Its lean into a corner or a turn, in degrees. */
  tilt: number;
  doors: boolean;
  moving: boolean;
  braking: boolean;
};

/** Parked at the terminus: still, doors shut, facing TOWN_BUS_PARKED. */
export function townBusParked(at: TownPoint): TownBusPose {
  return {
    x: at.x,
    y: at.y,
    facing: TOWN_BUS_PARKED,
    tilt: 0,
    doors: false,
    moving: false,
    braking: false,
  };
}

/** The angle, in degrees, of each facing's way on the screen. */
const AXIS: Record<TownFacing, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: -90,
};

/**
 * Where the bus is `elapsedMs` into its trip and how it shows, or parked
 * at the terminus before it leaves and after the trip.
 */
export function townBusPose(
  timeline: TownBusTimeline,
  terminus: TownPoint,
  elapsedMs: number,
): TownBusPose {
  const time = elapsedMs / 1000;
  for (const piece of timeline.pieces) {
    if (time < piece.t0 || time > piece.t1) continue;
    if (piece.kind === "stand")
      return {
        x: piece.at.x,
        y: piece.at.y,
        facing: piece.facing,
        tilt: 0,
        doors:
          piece.open !== undefined &&
          piece.close !== undefined &&
          time >= piece.open &&
          time < piece.close,
        moving: false,
        braking: false,
      };
    if (piece.kind === "turn") {
      // Round through facing the viewer, leaning as it swings.
      const k = (time - piece.t0) / Math.max(1e-6, piece.t1 - piece.t0);
      const facing = k < 1 / 3 ? piece.from : k < 2 / 3 ? "down" : piece.to;
      return {
        x: piece.at.x,
        y: piece.at.y,
        facing,
        tilt: Math.sin(k * Math.PI * 3) * 6,
        doors: false,
        moving: true,
        braking: false,
      };
    }
    const local = time - piece.t0;
    const { s, t } = piece;
    let low = 0;
    let high = t.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (t[mid]! <= local) low = mid;
      else high = mid;
    }
    const span = t[high]! - t[low]!;
    const k = span > 0 ? Math.min(1, Math.max(0, (local - t[low]!) / span)) : 1;
    const along = s[low]! + (s[high]! - s[low]!) * k;
    const point = townBusPathAt(piece.path, along);
    const facing = facingOf(point.dx, point.dy);
    const angle = (Math.atan2(point.dy, point.dx) * 180) / Math.PI;
    let lean = angle - AXIS[facing];
    if (lean > 180) lean -= 360;
    if (lean < -180) lean += 360;
    // Faster or slower than the sample before: its speed over each stretch.
    const before =
      low > 0 ? (s[low]! - s[low - 1]!) / (t[low]! - t[low - 1]!) : 0;
    const now = span > 0 ? (s[high]! - s[low]!) / span : 0;
    return {
      x: point.x,
      y: point.y,
      facing,
      tilt: point.turning ? lean * 0.5 : 0,
      doors: false,
      moving: true,
      braking: now < before - 0.5 || (now < 1 && local > 0),
    };
  }
  return townBusParked(terminus);
}

/**
 * How far the bus has still to drive, in world pixels, `elapsedMs` into its
 * trip: what is left of the leg it is on and every leg after it. Before it
 * pulls away, the whole drive; once it is back, nothing.
 */
export function townBusLeft(
  timeline: TownBusTimeline,
  elapsedMs: number,
): number {
  const time = elapsedMs / 1000;
  let left = 0;
  for (const piece of timeline.pieces) {
    if (piece.kind !== "drive") continue;
    if (time <= piece.t0) {
      left += piece.path.length;
      continue;
    }
    if (time >= piece.t1) continue;
    const local = time - piece.t0;
    const { s, t } = piece;
    let low = 0;
    let high = t.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (t[mid]! <= local) low = mid;
      else high = mid;
    }
    const span = t[high]! - t[low]!;
    const k = span > 0 ? Math.min(1, Math.max(0, (local - t[low]!) / span)) : 1;
    left += piece.path.length - (s[low]! + (s[high]! - s[low]!) * k);
  }
  return left;
}

/**
 * Where riders step on and off: on the pavement beside the bus's front
 * door, `kerb` being the pavement's height (its front faces `facing`).
 */
export function townBusDoor(
  at: TownPoint,
  facing: TownFacing,
  kerb: number,
): TownPoint {
  const front = facing === "left" ? -1 : 1;
  return { x: at.x + front * TOWN_BUS_DOOR_DX, y: kerb };
}

/** The front door's distance from the bus's middle, in world pixels. */
export const TOWN_BUS_DOOR_DX = 18;
