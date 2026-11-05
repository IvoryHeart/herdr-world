/**
 * The bus's route clock (bin-bus plan, ruling A-R′): where a trip's bus is,
 * as a pure function of the layout's stops and the service's trip clock.
 *
 * The canonical route runs every street that has a stop, top to bottom, each
 * from the map's left edge to its right edge (the bus leaves by the right and
 * comes back in from the left for the next street). Its length over the trip's
 * set-off approach time fixes the speed for the whole trip, so no boarding,
 * reset or Put back can change it or move the bus. Progress is
 * `D = speed × active trip time`. The bus is drawn only on a street with an
 * occupied stop; it rolls past intermediate stops (riders hop on) and eases
 * into the last occupied stop, where it waits until its departure. World px.
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
/** Route distance over which the bus eases into its final stop. */
export const BUS_BRAKE = 192;
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

/** The route's speed for a trip, px per ms: fixed by the trip's own countdown. */
export const townBusSpeed = (route: TownBusRoute, tripDurationMs: number) =>
  route.length / busApproachMs(tripDurationMs);

export type TownBusRiderInput = {
  entryId: string;
  /** The stop nearest the rider's room. */
  home: string;
  /** Active trip time when it joined (0 for set-off riders). */
  joinedMs: number;
};

export type TownBusRiderPlan = TownBusRiderInput & {
  /** Where it waits: its home, or the next stop ahead if the bus had passed it. */
  stop: string;
};

export type TownBusPlan = {
  route: TownBusRoute;
  speed: number;
  riders: TownBusRiderPlan[];
  /** Occupied stops in road order. */
  occupied: TownBusRouteStop[];
  final: TownBusRouteStop | null;
};

/**
 * Who waits where, by replaying the joins in order (a pure function of the
 * entries, so every observer and every remount agrees). A rider's stop is its
 * home, unless at its join the bus had passed it (the next stop ahead, or the
 * final stop) or was already waiting at its final stop (that stop).
 */
export function townBusPlan(input: {
  route: TownBusRoute;
  tripDurationMs: number;
  riders: readonly TownBusRiderInput[];
}): TownBusPlan {
  const { route } = input;
  const speed = townBusSpeed(route, input.tripDurationMs);
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
      const d = speed * Math.max(0, rider.joinedMs);
      const final = finalOf();
      let stop = home;
      if (final && d >= final.at + BUS_BRAKE / 2) stop = final;
      else if (home.at <= d)
        stop =
          route.stops.find((s) => s.at > d) ??
          final ??
          route.stops[route.stops.length - 1]!;
      occupied.add(stop);
      return { ...rider, stop: stop.id };
    });
  return {
    route,
    speed,
    riders,
    occupied: [...occupied].sort((a, b) => a.at - b.at),
    final: finalOf(),
  };
}

/**
 * The drawn route distance for progress `d`: canonical until the brake, then
 * eased into `finalAt` and held there. Moving `finalAt` ahead mid-brake moves
 * the bus by at most BUS_BRAKE / 2.
 */
export function townBusEase(d: number, finalAt: number | null) {
  if (finalAt === null) return d;
  const start = finalAt - BUS_BRAKE / 2;
  if (d <= start) return d;
  if (d >= finalAt + BUS_BRAKE / 2) return finalAt;
  const u = (d - start) / BUS_BRAKE;
  return start + BUS_BRAKE * (u - (u * u) / 2);
}

export type TownBusPosition = {
  /** Route distance drawn (eased), and the leg it is on. */
  at: number;
  leg: number;
  x: number;
  y: number;
  /** Px per ms now (0 once standing). */
  speed: number;
  /** Standing at its final stop. */
  arrived: boolean;
  /** On a street with an occupied stop: drawn; otherwise off the map. */
  visible: boolean;
  /** Rolling past (or standing at) an occupied stop: doors open. */
  atStop: string | null;
};

/** Bus `index` of the convoy (0 leads), `elapsedMs` into the trip. */
export function townBusPosition(
  plan: TownBusPlan,
  elapsedMs: number,
  index = 0,
): TownBusPosition {
  const { route } = plan;
  const back = index * (BUS_W + BUS_GAP);
  const d = plan.speed * Math.max(0, elapsedMs) - back;
  const finalAt = plan.final ? plan.final.at - back : null;
  const at = townBusEase(d, finalAt);
  const leg = Math.max(
    0,
    Math.min(route.legs.length - 1, Math.floor(at / route.legLength)),
  );
  const x = at - leg * route.legLength - BUS_W;
  const arrived = finalAt !== null && d >= finalAt + BUS_BRAKE / 2;
  const slope =
    finalAt === null || d <= finalAt - BUS_BRAKE / 2
      ? 1
      : arrived
        ? 0
        : 1 - (d - (finalAt - BUS_BRAKE / 2)) / BUS_BRAKE;
  const stop = plan.occupied.find(
    (s) => Math.abs(s.at - back - at) < BUS_W / 2,
  );
  return {
    at,
    leg,
    x,
    y: route.legs[leg]?.y ?? 0,
    speed: plan.speed * slope,
    arrived,
    visible: x < route.width && plan.occupied.some((s) => s.leg === leg),
    atStop: stop?.id ?? null,
  };
}
