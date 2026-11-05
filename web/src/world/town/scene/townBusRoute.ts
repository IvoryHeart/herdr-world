/**
 * The bus's route clock (bin-bus plan; evening ruling 2026-11-05): where a
 * trip's bus is, as a pure function of the layout's stops and the service's
 * trip clock.
 *
 * The canonical route runs every street that has a stop, top to bottom, each
 * from the map's left edge to its right edge (the bus leaves by the right and
 * comes back in from the left for the next street). The bus stands at every
 * stop it reaches, empty or not, for the same short dwell, braking in and
 * pulling away over the same ramp: one timetable per trip, fixed by the
 * layout and the trip's countdown alone, so no boarding, reset or Put back
 * changes its speed or moves it. It holds at the last occupied stop with its
 * doors open until its departure, and never reaches the stops after it. It is
 * drawn on every street it drives. World px.
 */

import { TOWN_TILE as T } from "../townLayout";
import type { TownBusStop } from "../townBusStop";
import { BUS_W } from "../townBusGeometry";

/** The bus stops at the stop with this long left on the clock. */
export const BUS_DUE_LEFT_MS = 10_000;
/** A countdown too short for that still sees the bus pull in over this. */
export const BUS_SHORT_APPROACH_MS = 3_000;
/** How long a countdown's bus takes to run its route. */
export const busApproachMs = (countdownMs: number) =>
  Math.max(
    countdownMs - BUS_DUE_LEFT_MS,
    Math.min(BUS_SHORT_APPROACH_MS, countdownMs * 0.3),
  );
/** The longest a bus stands at a stop, doors open. */
export const BUS_STOP_MS = 1000;
/** The most of the approach that standing at stops may take. */
export const BUS_STOP_SHARE = 0.5;
/** Distance drawn over which the bus brakes into, or pulls away from, a stop. */
export const BUS_RAMP = 96;
/** Canonical distance of a brake into a stop (two ramps' worth). */
export const BUS_BRAKE = 2 * BUS_RAMP;
/** Space between buses of a convoy. */
export const BUS_GAP = 6;

export type TownBusRouteStop = {
  id: string;
  order: number;
  main: boolean;
  /** Its street's index along the route. */
  leg: number;
  /** Route distance at which a bus stands at it. */
  at: number;
  /** The pole's centre and the sign's foot, world px. */
  poleX: number;
  footY: number;
  /** Where a bus stands at it: left x and top y. */
  busX: number;
  busY: number;
};

export type TownBusRoute = {
  /** Each street's bus lane top, in route order. */
  legs: { road: number; y: number }[];
  /** One street's run, from off the left edge to the right edge. */
  legLength: number;
  length: number;
  /** Every stop in road order. */
  stops: TownBusRouteStop[];
  width: number;
};

export function townBusRoute(
  stops: readonly TownBusStop[],
  width: number,
): TownBusRoute {
  const roads = [...new Set(stops.map((stop) => stop.road))].sort(
    (a, b) => a - b,
  );
  const legs = roads.map((road) => ({ road, y: road * T + T + 2 }));
  const legLength = width + BUS_W;
  const routeStops = [...stops]
    .sort((a, b) => a.order - b.order)
    .map((stop) => {
      const leg = roads.indexOf(stop.road);
      const poleX = stop.x * T + T / 2;
      const busX = poleX - BUS_W - 4;
      return {
        id: stop.id,
        order: stop.order,
        main: stop.main,
        leg,
        at: leg * legLength + busX + BUS_W,
        poleX,
        footY: stop.y * T + T,
        busX,
        busY: legs[leg]!.y,
      };
    });
  return {
    legs,
    legLength,
    length: legs.length * legLength,
    stops: routeStops,
    width,
  };
}

export type TownBusTimetableStop = {
  id: string;
  /** Route distance at which the bus stands at it. */
  at: number;
  /** Active trip time the bus comes to a stand there, and pulls away. */
  arriveMs: number;
  leaveMs: number;
};

export type TownBusTimetable = {
  /** The approach: the whole route, standing at every stop, takes exactly this. */
  durationMs: number;
  /** Steady cruise between stops, px per ms. */
  speed: number;
  /** How long it stands at each stop. */
  dwellMs: number;
  /** Distance drawn braking into, or pulling away from, a stop, and its time. */
  ramp: number;
  rampMs: number;
  /** Every stop in road order. */
  stops: TownBusTimetableStop[];
};

/**
 * A trip's timetable, from the layout's route and the trip's countdown alone:
 * every stop gets the same dwell, `min(BUS_STOP_MS, BUS_STOP_SHARE × T / N)`
 * (always some, so no stop is skipped), and the cruise is what fits the route,
 * its ramps and its dwells exactly into the approach T.
 */
export function townBusTimetable(
  route: TownBusRoute,
  tripDurationMs: number,
): TownBusTimetable {
  const durationMs = Math.max(1, busApproachMs(tripDurationMs));
  const ats = route.stops.map((stop) => stop.at);
  const n = ats.length;
  const dwellMs = n
    ? Math.min(BUS_STOP_MS, (BUS_STOP_SHARE * durationMs) / n)
    : 0;
  let ramp = n ? Math.min(BUS_RAMP, ats[0]!, route.length - ats[n - 1]!) : 0;
  for (let k = 1; k < n; k += 1)
    ramp = Math.min(ramp, (ats[k]! - ats[k - 1]!) / 2);
  ramp = Math.max(0, ramp);
  const speed = (route.length + 2 * ramp * n) / (durationMs - n * dwellMs);
  const stops = route.stops.map((stop, k) => {
    const arriveMs = (stop.at + ramp * (2 * k + 1)) / speed + k * dwellMs;
    return { id: stop.id, at: stop.at, arriveMs, leaveMs: arriveMs + dwellMs };
  });
  return {
    durationMs,
    speed,
    dwellMs,
    ramp,
    rampMs: (2 * ramp) / speed,
    stops,
  };
}

/**
 * Where the timetable puts the bus `elapsedMs` into its trip: route distance
 * drawn, its speed (px per ms) and the stop it stands at, if any. Each stop's
 * slot is the same: a linear brake over the ramp, the dwell, a linear pull
 * away over the ramp.
 */
export function townBusAt(
  timetable: TownBusTimetable,
  elapsedMs: number,
): { at: number; speed: number; standing: string | null } {
  const t = Math.max(0, elapsedMs);
  const { speed: v, ramp, rampMs: tau } = timetable;
  let from = 0;
  let since = 0;
  for (const stop of timetable.stops) {
    if (t < stop.arriveMs - tau)
      return { at: from + v * (t - since), speed: v, standing: null };
    if (t < stop.arriveMs) {
      const u = stop.arriveMs - t;
      return {
        at: stop.at - (v * u * u) / (2 * tau),
        speed: (v * u) / tau,
        standing: null,
      };
    }
    if (t < stop.leaveMs) return { at: stop.at, speed: 0, standing: stop.id };
    if (t < stop.leaveMs + tau) {
      const u = t - stop.leaveMs;
      return {
        at: stop.at + (v * u * u) / (2 * tau),
        speed: (v * u) / tau,
        standing: null,
      };
    }
    from = stop.at + ramp;
    since = stop.leaveMs + tau;
  }
  return { at: from + v * (t - since), speed: v, standing: null };
}

export type TownBusRiderInput = {
  entryId: string;
  /** The stop nearest the rider's room. */
  home: string;
  /** Active trip time when it joined (0 for set-off riders). */
  joinedMs: number;
};

export type TownBusRiderPlan = TownBusRiderInput & {
  /** Where it waits: its home, or the next stop ahead if the bus had left it. */
  stop: string;
};

export type TownBusPlan = {
  route: TownBusRoute;
  timetable: TownBusTimetable;
  /** Steady cruise, px per ms (the timetable's). */
  speed: number;
  dwellMs: number;
  riders: TownBusRiderPlan[];
  /** Occupied stops in road order. */
  occupied: TownBusRouteStop[];
  final: TownBusRouteStop | null;
};

/**
 * Who waits where, by replaying the joins in order (a pure function of the
 * entries, so every observer and every remount agrees). A rider's stop is its
 * home, unless the bus is already holding at its final stop past the dwell
 * (that stop) or had left its home when it joined (the first stop the bus has
 * not yet left). A rider with no earlier rider left waits at home regardless:
 * the bus goes back for it.
 */
export function townBusPlan(input: {
  route: TownBusRoute;
  tripDurationMs: number;
  riders: readonly TownBusRiderInput[];
}): TownBusPlan {
  const { route } = input;
  const timetable = townBusTimetable(route, input.tripDurationMs);
  const slots = new Map(timetable.stops.map((slot) => [slot.id, slot]));
  const byId = new Map(route.stops.map((stop) => [stop.id, stop]));
  const fallback = route.stops.find((stop) => stop.main) ?? route.stops[0];
  const occupied = new Set<TownBusRouteStop>();
  const finalOf = () =>
    [...occupied].reduce<TownBusRouteStop | null>(
      (last, stop) => (!last || stop.at > last.at ? stop : last),
      null,
    );
  const riders = [...input.riders]
    .sort((a, b) => a.joinedMs - b.joinedMs || (a.entryId < b.entryId ? -1 : 1))
    .map((rider) => {
      const home = byId.get(rider.home) ?? fallback!;
      const t = Math.max(0, rider.joinedMs);
      const final = finalOf();
      let stop = home;
      // No earlier remaining rider can reconstruct a late rider's old pickup.
      // The approved orphan rule places it at home, then replays later joins.
      if (!final) stop = home;
      else if (t >= slots.get(final.id)!.leaveMs) stop = final;
      else if (t >= slots.get(home.id)!.leaveMs)
        stop = route.stops.find((s) => slots.get(s.id)!.leaveMs > t) ?? final;
      occupied.add(stop);
      return { ...rider, stop: stop.id };
    });
  return {
    route,
    timetable,
    speed: timetable.speed,
    dwellMs: timetable.dwellMs,
    riders,
    occupied: [...occupied].sort((a, b) => a.at - b.at),
    final: finalOf(),
  };
}

export type TownBusPosition = {
  /** Route distance drawn, and the leg it is on. */
  at: number;
  leg: number;
  x: number;
  y: number;
  /** Px per ms now (0 standing). */
  speed: number;
  /** Come to a stand at its final stop. */
  arrived: boolean;
  /** On a street it drives, up to its final stop's: drawn; else off the map. */
  visible: boolean;
  /** The stop it stands at, doors open (a dwell or its final hold). */
  atStop: string | null;
};

/**
 * Bus `index` of the convoy (0 leads), `elapsedMs` into the trip. The convoy
 * moves and stands as one, BUS_W + BUS_GAP apart; once the timetable would
 * take it on from its final stop, it holds there.
 */
export function townBusPosition(
  plan: TownBusPlan,
  elapsedMs: number,
  index = 0,
): TownBusPosition {
  const { route, final } = plan;
  const back = index * (BUS_W + BUS_GAP);
  const t = Math.max(0, elapsedMs);
  const slot = final
    ? plan.timetable.stops.find((s) => s.id === final.id)!
    : null;
  const now =
    slot && t >= slot.leaveMs
      ? { at: slot.at, speed: 0, standing: slot.id }
      : townBusAt(plan.timetable, t);
  const at = now.at - back;
  const leg = Math.max(
    0,
    Math.min(route.legs.length - 1, Math.floor(at / route.legLength)),
  );
  const x = at - leg * route.legLength - BUS_W;
  return {
    at,
    leg,
    x,
    y: route.legs[leg]?.y ?? 0,
    speed: now.speed,
    arrived: slot !== null && t >= slot.arriveMs,
    visible: x < route.width && leg <= (final?.leg ?? -1),
    atStop: now.standing,
  };
}
