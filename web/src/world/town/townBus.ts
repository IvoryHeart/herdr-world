import type { BinEntry } from "../../../../shared/bin";
import { TOWN_TILE, type TownLayout, type TownPoint } from "./townLayout";

/**
 * Town's bin is the London bus stop. One bus collects everyone at the stop
 * before it leaves; its journey across the screen is the countdown, and the
 * close runs as it leaves. Positions here are pure functions of the time left,
 * so the motion is the same at any frame rate and pauses exactly with the bin.
 */

export type BusPhase = "arrive" | "wait" | "leave";

/** How long the bus takes to pull in and to pull away, for a countdown. */
export function busTimes(durationMs: number) {
  return {
    arriveMs: Math.min(4_000, durationMs * 0.25),
    leaveMs: Math.min(5_000, durationMs * 0.3),
  };
}

/** Where a bus is in its journey: the phase, and progress through it (0–1). */
export function busPhase(
  durationMs: number,
  leftMs: number,
): { phase: BusPhase; t: number } {
  const { arriveMs, leaveMs } = busTimes(durationMs);
  const elapsed = durationMs - leftMs;
  if (elapsed < arriveMs)
    return { phase: "arrive", t: Math.max(0, elapsed / arriveMs) };
  if (leftMs > leaveMs) return { phase: "wait", t: 0 };
  return { phase: "leave", t: Math.min(1, 1 - leftMs / leaveMs) };
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;

/** The bus's left edge (screen px, unrounded) on its way from, to and past the stop. */
export function busX(
  pose: { phase: BusPhase; t: number },
  from: number,
  stop: number,
  to: number,
) {
  if (pose.phase === "arrive") return from + (stop - from) * easeOut(pose.t);
  if (pose.phase === "wait") return stop;
  return stop + (to - stop) * easeIn(pose.t);
}

/** A bus leaving early (its last passenger got off): eased away over this long. */
export const BUS_DEPART_MS = 1_400;
export function departX(startX: number, to: number, elapsedMs: number) {
  const t = Math.min(1, Math.max(0, elapsedMs / BUS_DEPART_MS));
  return startX + (to - startX) * easeIn(t);
}

/** Entries that leave together: the same deadline within this much. */
const TRIP_TOLERANCE_MS = 300;

export type BusTrip = {
  entries: BinEntry[];
  durationMs: number;
  leftMs: number;
};

/** Group the bin into buses: everyone with the same deadline rides together. */
export function busTrips(
  entries: readonly BinEntry[],
  timeLeft: (entry: BinEntry) => number,
): BusTrip[] {
  const sorted = [...entries].sort((a, b) => timeLeft(a) - timeLeft(b));
  const trips: BusTrip[] = [];
  for (const entry of sorted) {
    const left = timeLeft(entry);
    const trip = trips[trips.length - 1];
    if (trip && Math.abs(trip.leftMs - left) <= TRIP_TOLERANCE_MS)
      trip.entries.push(entry);
    else
      trips.push({
        entries: [entry],
        durationMs: entry.duration_ms,
        leftMs: left,
      });
  }
  return trips;
}

/** A trip a newly dropped agent can still catch (the bus hasn't started to leave). */
export function catchableTrip(trips: readonly BusTrip[]) {
  return trips.find((trip) => {
    const { leaveMs } = busTimes(trip.durationMs);
    return trip.leftMs > leaveMs + 500;
  });
}

/**
 * The stop stands on the pavement a few tiles along from the first building's
 * door, clear of its reception card and the street lamps (every 11 tiles from
 * the sixth). World pixels, at its foot.
 */
export function townBusStop(layout: TownLayout): TownPoint | null {
  const building = [...layout.buildings].sort(
    (a, b) => a.y - b.y || a.x - b.x,
  )[0];
  if (!building) return null;
  let tx = building.doorX + 8;
  const taken = (x: number) =>
    layout.lamps.some((lamp) => lamp.x === x && lamp.y === building.roadY) ||
    layout.verticalRoads.some((road) => road.x === x);
  while (taken(tx) && tx < layout.width - 2) tx += 1;
  return {
    x: tx * TOWN_TILE + TOWN_TILE / 2,
    y: building.roadY * TOWN_TILE + TOWN_TILE - 2,
  };
}

/** Where the bus's wheels run: the middle of the road below the stop. */
export const BUS_ROAD_OFFSET = TOWN_TILE * 2;

/**
 * A press-and-hold on the bus: it freezes at once, before the service pauses,
 * and then follows the service. Once the service has answered the pause, a
 * resume from any World (or an empty bin) lets it go; a refused pause, or a
 * resume that overtook the pause, lets it go too.
 */
export class BusHold {
  /** performance.now() when the bus froze, or null while it drives. */
  at: number | null = null;
  /** Held here, and the service has not answered the pause yet. */
  private pending = false;

  hold(now: number, servicePaused: boolean) {
    if (this.at === null && !servicePaused) this.pending = true;
    this.at ??= now;
  }
  release() {
    this.at = null;
    this.pending = false;
  }
  /** The pause call settled; `paused` is the latest state the service gave. */
  answered(paused: boolean) {
    this.pending = false;
    if (!paused) this.at = null;
  }
  /** The service's latest state arrived. */
  observe(paused: boolean, empty: boolean) {
    if (paused) this.pending = false;
    else if (!this.pending || empty) this.release();
  }
  held(servicePaused: boolean) {
    return this.at !== null || servicePaused;
  }
}

export type BusParkingInput = {
  /** Buses waiting at the stop at once. */
  count: number;
  /** The camera's zoom: buses are drawn at it when they fit. */
  zoom: number;
  /** The stop's screen x, and the bottom of the first row (the road). */
  stopX: number;
  road: number;
  /** The usable screen area, in canvas pixels. */
  left: number;
  right: number;
  top: number;
  /** One bus at scale 1, and where its door is. */
  busW: number;
  busH: number;
  doorX: number;
};

const BUS_GAP = 6;

/**
 * Where parked buses stand, so every one is on screen: side by side from the
 * stop, the first with its door at the stop, in rows rising above the road
 * when one row is not enough, and smaller (never below scale 1) when even the
 * rows run out.
 */
export function busParking(input: BusParkingInput) {
  const { count, left, right, top, road, busW, busH } = input;
  const fits = (scale: number) => {
    const cols = Math.max(
      1,
      Math.floor((right - left + BUS_GAP) / (busW * scale + BUS_GAP)),
    );
    const rows = Math.max(
      1,
      Math.floor((road - top + BUS_GAP) / (busH * scale + BUS_GAP)),
    );
    return { cols, ok: cols * rows >= count };
  };
  let scale = input.zoom;
  while (scale > 1 && !fits(scale).ok) scale = Math.max(1, scale * 0.85);
  const { cols } = fits(scale);
  const pitch = busW * scale + BUS_GAP;
  const atStop = Math.min(
    right - busW * scale,
    Math.max(left, input.stopX - (input.doorX + 4) * scale),
  );
  const slots = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols);
    const inRow = Math.min(cols, count - row * cols);
    // A row starts at the stop when it fits there, else as far right as fits.
    const start = Math.max(
      left,
      Math.min(atStop, right - inRow * pitch + BUS_GAP),
    );
    return {
      x: start + (index % cols) * pitch,
      bottom: road - row * (busH * scale + BUS_GAP),
    };
  });
  return { scale, slots };
}
