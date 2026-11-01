/**
 * Town's bus, headless: where the stop, its waiting riders and each bus are,
 * as a pure function of the bin's state and time left. One bus per departure
 * (a bin "trip"); it drives in from the town's left edge along the stop's
 * street, initially timed to stop with 10 s on the clock. Boarding resets the
 * departure clock without changing its set-off run, so it can arrive early. It waits with its
 * doors open until the countdown ends, then pulls away and leaves by the
 * right edge exactly when the close commits (the entry's departure time).
 * It moves as a mover with the bus's character (townMotion.ts): it slows
 * into the stop and speeds up away from it. Until it has left it can still be
 * stopped. Buses that cannot all stand at the stop queue behind it to
 * the left, then in further lanes below, so every rider has a place on the
 * map that can be panned to and dragged from. World pixels throughout.
 */

import type { BinEntry } from "../../../../../shared/bin";
import { TOWN_TILE as T } from "../townLayout";
import type { TownBusStop } from "../townBusStop";
import { BUS_H, BUS_SEATS, BUS_W, STOP_H, STOP_W } from "../townBusGeometry";
import { BUS_CHARACTER, moverRun, type MoverRun } from "./townMotion";

/** The bus stops at the stop with this long left on the clock. */
export const BUS_DUE_LEFT_MS = 10_000;
/** A countdown too short for that still sees the bus pull in over this. */
export const BUS_SHORT_APPROACH_MS = 3_000;

/** How long a countdown's bus takes to drive in from the map's edge. */
export const busApproachMs = (countdownMs: number) =>
  Math.max(
    countdownMs - BUS_DUE_LEFT_MS,
    Math.min(BUS_SHORT_APPROACH_MS, countdownMs * 0.3),
  );
const GAP = 6;
const LANE = BUS_H + 4;

export type TownBusRider = {
  entryId: string;
  label: string;
  /** Top left of the rider's window (seated) or feet (waiting), world px. */
  x: number;
  y: number;
};

/** A set-off trajectory and progress retained when boarding resets the clock. */
export type TownBusApproach = {
  start: number;
  run: MoverRun;
  elapsed: number;
};

export type TownBus = {
  trip: string;
  /** This bus of its trip (a trip of more than eight riders takes more). */
  key: string;
  x: number;
  y: number;
  /** Where it stands at the stop (or in the queue): its drive away starts here. */
  home: number;
  /** Time since its trip's clock started (a boarding restarts it), ms. */
  since: number;
  approach: TownBusApproach;
  /** Departing: driving away (parked, doors shut, under reduced motion). */
  phase: "arriving" | "waiting" | "departing";
  doorsOpen: boolean;
  /** Which of two wheel frames, from distance travelled. */
  wheel: 0 | 1;
  /** Time left at the stop before it drives away, ms (0 once it has started). */
  remaining: number;
  riders: TownBusRider[];
};

export type TownBusScene = {
  stop: { x: number; y: number; w: number; h: number };
  /** The map's right edge, world px: a bus past it has left. */
  edge: number;
  /** Riders whose bus has not pulled up yet, standing by the stop with a box. */
  waiting: TownBusRider[];
  buses: TownBus[];
  /** Everything a dropped agent can land on: the stop, its pavement, the buses. */
  dropZone: { x: number; y: number; w: number; h: number };
  /** The soonest departure, for the edge chip: its wait, or that it is leaving. */
  next: { remaining: number; leaving: boolean; riders: number } | null;
};

export type TownBusInput = {
  stop: TownBusStop;
  /** The town's width, world px: buses enter and leave past its edges. */
  width: number;
  entries: readonly BinEntry[];
  /** Time left of each entry now (the store's clock), by entry ID. */
  remaining(entry: BinEntry): number;
  paused: boolean;
  reducedMotion: boolean;
  /**
   * Each bus's original trajectory and progress at the last boarding reset.
   * Its departure clock restarts, but its approach keeps the set-off speed.
   */
  starts?: ReadonlyMap<string, TownBusApproach>;
};

export function townBusScene(input: TownBusInput): TownBusScene {
  const { stop } = input;
  const poleX = stop.x * T + T / 2;
  const kerb = stop.road * T + T; // top of the carriageway
  const stopBox = {
    x: poleX - STOP_W / 2,
    y: stop.y * T + T - STOP_H,
    w: STOP_W,
    h: STOP_H,
  };
  // Trips, soonest departure first: the first stands at the stop.
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
    }))
    .sort((a, b) => a.remaining - b.remaining || a.trip.localeCompare(b.trip));
  // A trip with more riders than seats takes more than one bus.
  const departures = ordered.flatMap((trip) => {
    const parts: (typeof trip & { key: string })[] = [];
    for (let i = 0; i < trip.riders.length; i += BUS_SEATS.length)
      parts.push({
        ...trip,
        key: `${trip.trip}#${i / BUS_SEATS.length}`,
        riders: trip.riders.slice(i, i + BUS_SEATS.length),
      });
    return parts;
  });
  const frontX = poleX - BUS_W - 4;
  const perLane = Math.max(
    1,
    Math.floor((frontX - stop.queueStart * T) / (BUS_W + GAP)) + 1,
  );
  const waiting: TownBusRider[] = [];
  const buses: TownBus[] = departures.map((trip, index) => {
    const lane = Math.floor(index / perLane);
    const slot = index % perLane;
    const slotX = frontX - slot * (BUS_W + GAP);
    const y = kerb + 2 + lane * LANE;
    const since = trip.duration + trip.departure - trip.remaining;
    const plan = input.starts?.get(trip.key) ?? {
      start: -BUS_W,
      run: moverRun(
        BUS_CHARACTER,
        slotX + BUS_W,
        { from: "moving", to: "rest" },
        busApproachMs(trip.duration),
      ),
      elapsed: 0,
    };
    const approach = { ...plan, elapsed: plan.elapsed + since };
    let x = slotX;
    let phase: TownBus["phase"] = "waiting";
    if (trip.remaining < trip.departure) {
      // The countdown is over: it pulls away and leaves the map as the
      // close commits. Reduced motion keeps it parked, doors shut.
      phase = "departing";
      if (!input.reducedMotion)
        x =
          slotX +
          moverRun(
            BUS_CHARACTER,
            input.width - slotX,
            { from: "rest", to: "moving" },
            trip.departure,
          ).at(trip.departure - trip.remaining);
    } else if (!input.reducedMotion && approach.elapsed < plan.run.duration) {
      // Keep the original run, including its deceleration, across resets.
      // An early arrival simply waits longer on the reset departure clock.
      phase = "arriving";
      x = Math.min(slotX, plan.start + plan.run.at(approach.elapsed));
    }
    const riders = trip.riders.map((entry, seat) => {
      const window = BUS_SEATS[seat]!;
      return {
        entryId: entry.id,
        label: entry.label,
        x: Math.round(x) + window.x,
        y: y + window.y,
      };
    });
    if (phase === "arriving")
      riders.forEach((rider, i) =>
        waiting.push({
          ...rider,
          x: poleX - 14 - (waiting.length + i) * 12,
          y: stop.y * T + T - 2,
        }),
      );
    return {
      trip: trip.trip,
      key: trip.key,
      x,
      y,
      home: slotX,
      since,
      approach,
      phase,
      // Held (paused), a bus stands where it is with its doors open.
      doorsOpen: phase === "waiting" || input.paused,
      wheel: (Math.floor(Math.abs(x) / 6) % 2) as 0 | 1,
      remaining: Math.max(0, trip.remaining - trip.departure),
      riders: phase === "arriving" ? [] : riders,
    };
  });
  const lanes = Math.max(1, Math.ceil(departures.length / perLane));
  const left = Math.min(
    poleX - 14 - waiting.length * 12,
    departures.length
      ? frontX - (Math.min(perLane, departures.length) - 1) * (BUS_W + GAP)
      : poleX - 2 * T,
  );
  const dropZone = {
    x: left - T,
    y: stopBox.y - T,
    w: poleX + STOP_W + 2 * T - left,
    h: kerb + 2 + lanes * LANE + T - (stopBox.y - T),
  };
  const soonest = ordered[0];
  return {
    stop: stopBox,
    edge: input.width,
    waiting,
    buses,
    dropZone,
    next: soonest
      ? {
          remaining: Math.max(0, soonest.remaining - soonest.departure),
          leaving: soonest.remaining < soonest.departure,
          riders: soonest.riders.length,
        }
      : null,
  };
}

/** Each bus as last drawn, by `TownBus.key`. */
export type TownBusSeen = ReadonlyMap<
  string,
  { since: number; approach: TownBusApproach; phase: TownBus["phase"] }
>;

/**
 * What changed since the last drawn frame: buses whose clock restarted (an
 * agent boarded before they pulled away), with their original run/progress, and how many
 * pulled in at the stop (each sounds its horn). A held bus's clock stands
 * still, so holding is never a restart or an arrival.
 */
export function townBusChanges(
  seen: TownBusSeen,
  buses: readonly TownBus[],
  paused: boolean,
) {
  const restarts = new Map<string, TownBusApproach>();
  let arrivals = 0;
  for (const bus of buses) {
    const was = seen.get(bus.key);
    if (!was) continue;
    if (bus.since < was.since - 250 && was.phase !== "departing")
      restarts.set(bus.key, was.approach);
    else if (was.phase === "arriving" && bus.phase === "waiting" && !paused)
      arrivals += 1;
  }
  return { restarts, arrivals };
}

export const townBusSeen = (buses: readonly TownBus[]): TownBusSeen =>
  new Map(
    buses.map((bus) => [
      bus.key,
      { since: bus.since, approach: bus.approach, phase: bus.phase },
    ]),
  );

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
export function townBusAt(scene: TownBusScene, x: number, y: number) {
  for (const bus of [...scene.buses].reverse())
    if (x >= bus.x && x < bus.x + BUS_W && y >= bus.y && y < bus.y + BUS_H)
      return bus;
  return null;
}

export const inTownBusDropZone = (scene: TownBusScene, x: number, y: number) =>
  x >= scene.dropZone.x &&
  x < scene.dropZone.x + scene.dropZone.w &&
  y >= scene.dropZone.y &&
  y < scene.dropZone.y + scene.dropZone.h;
