/**
 * Town's buses, headless: the stops, who waits at each and where each bus is,
 * as a pure function of the bin's state, the layout's stops and the service's
 * trip clock (route clock: townBusRoute.ts). One bus per departure (a bin
 * "trip"): it seats eight and shows how many more ride as "+N". It runs the canonical route on a timetable fixed by its trip's own
 * countdown, drawn on every street it drives, and stands briefly at every
 * stop, doors open (riders there board), until the route's last stop, the
 * terminus, where it waits with its doors open until the countdown ends.
 * Who rides never moves it. Then it pulls away and leaves by the right edge
 * exactly when the close commits (the entry's departure time).
 * Until it has left it can still be stopped. World pixels throughout.
 */

import type { BinEntry } from "../../../../../shared/bin";
import { TOWN_TILE as T } from "../townLayout";
import type { TownBusStop } from "../townBusStop";
import { BUS_H, BUS_SEATS, BUS_W, STOP_H, STOP_W } from "../townBusGeometry";
import {
  townBusPlan,
  townBusPosition,
  townBusRoute,
  type TownBusPlan,
  type TownBusRouteStop,
} from "./townBusRoute";

export {
  BUS_DUE_LEFT_MS,
  BUS_SHORT_APPROACH_MS,
  busApproachMs,
} from "./townBusRoute";

export type TownBusRider = {
  entryId: string;
  label: string;
  /** Top left of the rider's window (seated) or feet (waiting), world px. */
  x: number;
  y: number;
};

export type TownBus = {
  trip: string;
  /** Its trip's bus, as drawn frame to frame. */
  key: string;
  x: number;
  y: number;
  /** Route distance drawn: it only ever grows. */
  at: number;
  /** Where it stands at the terminus: its drive away starts there. */
  home: number;
  /** Time since its trip's clock started (a boarding restarts it), ms. */
  since: number;
  /** Active trip time on the service's clock, ms. */
  elapsed: number;
  /** Departing: driving away (parked, doors shut, under reduced motion). */
  phase: "arriving" | "waiting" | "departing";
  doorsOpen: boolean;
  /** Which of two wheel frames, from distance travelled. */
  wheel: 0 | 1;
  /** Its speed now, px/s (0 standing or held). */
  speed: number;
  /** Its trip's pull-away time, ms: an emptied bus leaves just as fast. */
  departure: number;
  /** Time left at the stop before it drives away, ms (0 once it has started). */
  remaining: number;
  riders: TownBusRider[];
  /** Riders aboard beyond its eight seats (drawn as "+N"). */
  extra: number;
};

export type TownBusSceneStop = {
  id: string;
  main: boolean;
  /** The pole and sign, world px. */
  box: { x: number; y: number; w: number; h: number };
  /** Riders standing by it with a box until their bus calls. */
  waiting: TownBusRider[];
  /** Riders whose stop it is (waiting or aboard). */
  riders: number;
  /** A dropped agent lands here: the stop and its queue, tightly. */
  dropZone: { x: number; y: number; w: number; h: number };
};

export type TownBusScene = {
  /** Every stop in road order. */
  stops: TownBusSceneStop[];
  /** The main stop's pole and sign. */
  stop: { x: number; y: number; w: number; h: number };
  /** The map's right edge, world px: a bus past it has left. */
  edge: number;
  /** Everyone waiting at any stop. */
  waiting: TownBusRider[];
  buses: TownBus[];
  /** Each rider's stop, by entry ID. */
  stopOf: ReadonlyMap<string, string>;
  /**
   * The soonest departure, for the edge chip: its wait, or that it is
   * leaving, and the stop where its bus waits (world px, the pole's foot).
   */
  next: {
    remaining: number;
    leaving: boolean;
    riders: number;
    stop: { x: number; y: number };
  } | null;
};

export type TownBusInput = {
  /** Every stop in road order (TownLayout.busStops). */
  stops: readonly TownBusStop[];
  /** The town's width, world px: buses enter and leave past its edges. */
  width: number;
  entries: readonly BinEntry[];
  /** The stop nearest an entry's room (unknown: the main stop). */
  homeStop?(entry: BinEntry): string | undefined;
  /** Time left of each entry now (the store's clock), by entry ID. */
  remaining(entry: BinEntry): number;
  /** Service-owned active trip time, independent of boarding resets. */
  elapsed?(entry: BinEntry): number;
  paused: boolean;
  reducedMotion: boolean;
};

/** Active trip time when an entry joined; absent (older service) is 0. */
const joinedMs = (entry: BinEntry) => entry.trip_joined_ms ?? 0;

const box = (stop: TownBusRouteStop) => ({
  x: stop.poleX - STOP_W / 2,
  y: stop.footY - STOP_H,
  w: STOP_W,
  h: STOP_H,
});

export function townBusScene(input: TownBusInput): TownBusScene {
  const route = townBusRoute(input.stops, input.width);
  const main = route.stops.find((stop) => stop.main) ?? route.stops[0]!;
  const trips = new Map<string, BinEntry[]>();
  for (const entry of input.entries) {
    const list = trips.get(entry.trip) ?? [];
    list.push(entry);
    trips.set(entry.trip, list);
  }
  const ordered = [...trips.entries()]
    .map(([trip, riders]) => ({
      trip,
      riders,
      remaining: Math.min(...riders.map(input.remaining)),
      duration: Math.max(...riders.map((r) => r.duration_ms)),
      departure: Math.max(...riders.map((r) => r.departure_ms)),
      tripDuration: Math.max(
        ...riders.map((r) => r.trip_duration_ms ?? r.duration_ms),
      ),
      serviceElapsed: riders.every((r) => Number.isFinite(r.trip_elapsed_ms))
        ? Math.min(
            ...riders.map((r) => input.elapsed?.(r) ?? r.trip_elapsed_ms ?? 0),
          )
        : null,
    }))
    .sort((a, b) => a.remaining - b.remaining || a.trip.localeCompare(b.trip));
  const waitingAt = new Map<string, TownBusRider[]>(
    route.stops.map((stop) => [stop.id, []]),
  );
  const ridersAt = new Map<string, number>();
  const stopOf = new Map<string, string>();
  const buses: TownBus[] = [];
  const finals = new Map<string, TownBusRouteStop>();
  for (const trip of ordered) {
    const since = trip.duration + trip.departure - trip.remaining;
    const elapsed = trip.serviceElapsed ?? since;
    const plan: TownBusPlan = townBusPlan({
      route,
      tripDurationMs: trip.tripDuration,
      riders: trip.riders.map((entry) => ({
        entryId: entry.id,
        home: input.homeStop?.(entry) ?? main.id,
        joinedMs: joinedMs(entry),
      })),
    });
    const stops = new Map(route.stops.map((stop) => [stop.id, stop]));
    const byEntry = new Map(trip.riders.map((entry) => [entry.id, entry]));
    // Seats fill in route order.
    const seated = plan.riders
      .map((rider) => ({ rider, stop: stops.get(rider.stop)! }))
      .sort(
        (a, b) =>
          a.stop.at - b.stop.at ||
          a.rider.joinedMs - b.rider.joinedMs ||
          (a.rider.entryId < b.rider.entryId ? -1 : 1),
      );
    for (const { rider, stop } of seated) {
      stopOf.set(rider.entryId, stop.id);
      ridersAt.set(stop.id, (ridersAt.get(stop.id) ?? 0) + 1);
    }
    const departing = trip.remaining < trip.departure;
    const final = plan.final!;
    finals.set(trip.trip, final);
    const position = input.reducedMotion
      ? {
          x: final.busX,
          y: final.busY,
          at: final.at,
          speed: 0,
          arrived: true,
          visible: true,
          atStop: final.id,
        }
      : townBusPosition(plan, elapsed);
    let { x } = position;
    let speed = position.speed * 1000;
    let phase: TownBus["phase"] = position.arrived ? "waiting" : "arriving";
    if (departing) {
      // The countdown is over: it pulls away and leaves the map as the
      // close commits. Reduced motion keeps it parked, doors shut.
      phase = "departing";
      if (!input.reducedMotion) {
        const away = pullAway(input.width - x, trip.departure);
        const t = trip.departure - trip.remaining;
        x += away.at(t);
        speed = away.speedAt(t) * 1000;
      }
    }
    const riders: TownBusRider[] = [];
    let extra = 0;
    for (const { rider, stop } of seated) {
      const entry = byEntry.get(rider.entryId)!;
      if (departing || position.at >= stop.at - 1) {
        const window = BUS_SEATS[riders.length];
        if (!window) {
          extra += 1;
          continue;
        }
        riders.push({
          entryId: entry.id,
          label: entry.label,
          x: Math.round(x) + window.x,
          y: position.y + window.y,
        });
      } else {
        const queue = waitingAt.get(stop.id)!;
        queue.push({
          entryId: entry.id,
          label: entry.label,
          x: stop.poleX - 14 - queue.length * 12,
          y: stop.footY - 2,
        });
      }
    }
    if (!position.visible || x >= input.width) continue;
    buses.push({
      trip: trip.trip,
      key: trip.trip,
      x,
      y: position.y,
      at: position.at,
      home: final.busX,
      since,
      elapsed,
      phase,
      // Held (paused), a bus stands where it is with its doors open; it
      // opens them too while it stands at any stop on its way.
      doorsOpen:
        phase === "waiting" ||
        input.paused ||
        (phase === "arriving" && position.atStop !== null),
      wheel: busWheel(x),
      speed: input.paused ? 0 : speed,
      departure: trip.departure,
      remaining: Math.max(0, trip.remaining - trip.departure),
      riders,
      extra,
    });
  }
  const stops = route.stops.map((stop): TownBusSceneStop => {
    const waiting = waitingAt.get(stop.id)!;
    const sign = box(stop);
    const left =
      Math.min(sign.x, ...waiting.map((rider) => rider.x - 6)) - T / 2;
    return {
      id: stop.id,
      main: stop.main,
      box: sign,
      waiting,
      riders: ridersAt.get(stop.id) ?? 0,
      dropZone: {
        x: left,
        y: sign.y - T / 2,
        w: sign.x + sign.w + T / 2 - left,
        h: sign.h + T,
      },
    };
  });
  const soonest = ordered[0];
  const waitsAt = soonest ? finals.get(soonest.trip) : undefined;
  return {
    stops,
    stop: box(main),
    edge: input.width,
    waiting: stops.flatMap((stop) => stop.waiting),
    buses,
    stopOf,
    next: soonest
      ? {
          remaining: Math.max(0, soonest.remaining - soonest.departure),
          leaving: soonest.remaining < soonest.departure,
          riders: soonest.riders.length,
          stop: waitsAt
            ? { x: waitsAt.poleX, y: waitsAt.footY }
            : { x: main.poleX, y: main.footY },
        }
      : null,
  };
}

const busWheel = (x: number) => (Math.floor(Math.abs(x) / 6) % 2) as 0 | 1;

/**
 * One easing for every drive off the map: `distance` px over `durationMs`,
 * from `v0` px/ms (0: from rest), speeding up evenly. Already going fast
 * enough, it keeps its speed. Pure, for sampling per frame.
 */
export function pullAway(distance: number, durationMs: number, v0 = 0) {
  const d = Math.max(0, distance);
  const duration =
    v0 > 0 && v0 * durationMs >= d ? d / v0 : Math.max(1, durationMs);
  const a = (2 * (d - v0 * duration)) / (duration * duration);
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));
  return {
    duration,
    at: (t: number) => v0 * clamp(t) + (a * clamp(t) ** 2) / 2,
    /** Px per ms. */
    speedAt: (t: number) => v0 + a * clamp(t),
  };
}

/** Each bus as last drawn, by `TownBus.key`. */
export type TownBusSeen = ReadonlyMap<
  string,
  Pick<TownBus, "x" | "y" | "speed" | "departure">
>;

export const townBusSeen = (buses: readonly TownBus[]): TownBusSeen =>
  new Map(
    buses.map((bus) => [
      bus.key,
      { x: bus.x, y: bus.y, speed: bus.speed, departure: bus.departure },
    ]),
  );

/**
 * A bus with nobody left on it (its last rider put back, or closed early):
 * it never vanishes in place but drives on to the map's right edge, pulling
 * away like a departure, or keeping its speed if already moving.
 */
export type TownBusLeaver = {
  key: string;
  y: number;
  /** Where it was and when, ms on the layer's clock. */
  from: number;
  start: number;
  run: ReturnType<typeof pullAway>;
};

/**
 * Buses drawn last frame that the scene no longer has and that were on the
 * map: each becomes a leaver. Under reduced motion they just go.
 */
export function townBusLeavers(
  seen: TownBusSeen,
  buses: readonly TownBus[],
  width: number,
  now: number,
  reducedMotion: boolean,
): TownBusLeaver[] {
  if (reducedMotion) return [];
  const still = new Set(buses.map((bus) => bus.key));
  const leavers: TownBusLeaver[] = [];
  for (const [key, was] of seen) {
    if (still.has(key) || was.x >= width || was.x + BUS_W <= 0) continue;
    const run = pullAway(width - was.x, was.departure, was.speed / 1000);
    leavers.push({ key, y: was.y, from: was.x, start: now, run });
  }
  return leavers;
}

/** Where a leaver is now, or null once it has left the map. */
export function townBusLeaverAt(leaver: TownBusLeaver, now: number) {
  const t = now - leaver.start;
  if (t >= leaver.run.duration) return null;
  const x = leaver.from + leaver.run.at(t);
  return { x, wheel: busWheel(x) };
}

/**
 * The rider under a world point, searching in reverse draw order (later
 * lanes and later buses are drawn on top), then the waiting queue.
 */
export function townBusRiderAt(
  scene: TownBusScene,
  x: number,
  y: number,
): string | null {
  for (const bus of [...scene.buses].reverse())
    for (const rider of bus.riders)
      if (
        x >= rider.x - 2 &&
        x < rider.x + 10 &&
        y >= rider.y - 2 &&
        y < rider.y + 10
      )
        return rider.entryId;
  for (const rider of scene.waiting)
    if (
      x >= rider.x - 5 &&
      x < rider.x + 5 &&
      y >= rider.y - 22 &&
      y < rider.y + 2
    )
      return rider.entryId;
  return null;
}

/** The bus under a world point (press and hold stops it), top first. */
export function townBusHitAt(scene: TownBusScene, x: number, y: number) {
  for (const bus of [...scene.buses].reverse())
    if (x >= bus.x && x < bus.x + BUS_W && y >= bus.y && y < bus.y + BUS_H)
      return bus;
  return null;
}

const inside = (
  r: { x: number; y: number; w: number; h: number },
  x: number,
  y: number,
) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** The stop a dropped agent lands on (any stop sends it to its own), if any. */
export const townBusStopAt = (scene: TownBusScene, x: number, y: number) =>
  scene.stops.find((stop) => inside(stop.dropZone, x, y)) ?? null;

/** A drop here sends the agent to the bus: any stop's zone, or a bus. */
export const inTownBusDropZone = (scene: TownBusScene, x: number, y: number) =>
  townBusStopAt(scene, x, y) !== null || townBusHitAt(scene, x, y) !== null;
