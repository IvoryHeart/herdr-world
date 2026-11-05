/**
 * A bus stop: one stands at every crossing of a vertical road with a street,
 * just right of it on the street's top sidewalk, so buses pull up in the lane
 * beside it. The stop nearest the town centre is the main one. Tile
 * coordinates.
 */
export type TownBusStop = {
  /** Stable while the roads stand: `<street row>:<pole column>`. */
  id: string;
  /** Its place in road order: streets top to bottom, then left to right. */
  order: number;
  /** The stop nearest the town centre, named first in hints. */
  main: boolean;
  /** The pole's tile. */
  x: number;
  y: number;
  /** The street's top sidewalk row (TownLayout.roads); buses use the lane below. */
  road: number;
  /** The tile column where queued buses must stop (the street's left end). */
  queueStart: number;
};

/** A street's tiles: pavement, three lanes, pavement. */
export const TOWN_ROAD_BAND = 5;
/** Street tiles the stop needs right of its crossing's right pavement. */
export const TOWN_BUS_STOP_CLEARANCE = 4;

export function townBusStop(
  roads: readonly number[],
  verticalRoads: readonly { x: number; y0: number; y1: number }[],
  width: number,
  margin: number,
): TownBusStop {
  const road = Math.min(...roads);
  // A crossing meets the street from above (ends on it) or from below
  // (starts just past its five-tile band).
  const crossings = verticalRoads.filter(
    (v) => v.y1 === road || v.y0 === road + TOWN_ROAD_BAND,
  );
  const right = crossings.length
    ? Math.max(...crossings.map((v) => v.x)) + 6
    : width - margin - 3;
  const x = Math.min(width - 2, right);
  return {
    id: `${road}:${x}`,
    order: 0,
    main: true,
    x,
    y: road,
    road,
    queueStart: 1,
  };
}

/**
 * Every stop in road order: one right of each crossing (a vertical road meeting
 * a street from above or below), nudged right past a door's path onto that
 * sidewalk. A town without crossings keeps the single top-street stop. The main
 * stop is the one nearest the town centre (ties: the earlier in road order).
 */
export function townBusStops(
  roads: readonly number[],
  verticalRoads: readonly { x: number; y0: number; y1: number }[],
  size: { width: number; height: number },
  margin: number,
  doors: readonly { x: number; y: number }[] = [],
): TownBusStop[] {
  const seen = new Set<string>();
  const found: { road: number; x: number }[] = [];
  for (const road of [...roads].sort((a, b) => a - b))
    for (const v of verticalRoads) {
      if (v.y1 !== road && v.y0 !== road + TOWN_ROAD_BAND) continue;
      let x = v.x + 6;
      while (doors.some((d) => d.y === road && Math.abs(d.x - x) <= 1)) x += 1;
      x = Math.min(size.width - 2, x);
      const id = `${road}:${x}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({ road, x });
    }
  if (!found.length)
    return [townBusStop(roads, verticalRoads, size.width, margin)];
  found.sort((a, b) => a.road - b.road || a.x - b.x);
  const stops = found.map(
    ({ road, x }, order): TownBusStop => ({
      id: `${road}:${x}`,
      order,
      main: false,
      x,
      y: road,
      road,
      queueStart: 1,
    }),
  );
  const main = nearestTownBusStop(stops, {
    x: size.width / 2,
    y: size.height / 2,
  });
  return stops.map((stop) => (stop === main ? { ...stop, main: true } : stop));
}

/** The stop nearest a tile point; ties go to the earlier stop in road order. */
export function nearestTownBusStop(
  stops: readonly TownBusStop[],
  at: { x: number; y: number },
): TownBusStop {
  let best = stops[0]!;
  let bestDistance = Infinity;
  for (const stop of stops) {
    const distance = (stop.x - at.x) ** 2 + (stop.y - at.y) ** 2;
    if (distance < bestDistance) {
      best = stop;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whether a tile is clear of the stop (lamps and benches keep their distance). */
export const nearTownBusStop = (
  stop: TownBusStop,
  point: { x: number; y: number },
) => Math.abs(point.x - stop.x) <= 2 && Math.abs(point.y - stop.y) <= 1;

/**
 * Each room's stop: the one nearest the room's centre (ties: road order). An
 * agent sent to the bus waits there, wherever it was dropped.
 */
export function townRoomStops(layout: {
  busStops: readonly TownBusStop[];
  buildings: readonly {
    rooms: readonly {
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
  }[];
}): Map<string, string> {
  const stops = new Map<string, string>();
  for (const building of layout.buildings)
    for (const room of building.rooms)
      stops.set(
        room.key,
        nearestTownBusStop(layout.busStops, {
          x: room.x + room.w / 2,
          y: room.y + room.h / 2,
        }).id,
      );
  return stops;
}

/** Each stop's nearest room (ties: the first room laid out), for its name. */
export function townStopRooms(layout: {
  busStops: readonly TownBusStop[];
  buildings: readonly {
    rooms: readonly {
      key: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }[];
  }[];
}): Map<string, string> {
  const rooms = layout.buildings.flatMap((building) => building.rooms);
  const result = new Map<string, string>();
  for (const stop of layout.busStops) {
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const room of rooms) {
      const distance =
        (room.x + room.w / 2 - stop.x) ** 2 +
        (room.y + room.h / 2 - stop.y) ** 2;
      if (distance < bestDistance) {
        best = room.key;
        bestDistance = distance;
      }
    }
    if (best !== null) result.set(stop.id, best);
  }
  return result;
}

/**
 * A street's furniture: a bus stop at every crossing (each stepping past a
 * bar door's path onto its pavement; the main one nearest the centre), and a
 * lamp every 11 tiles along each street's top pavement, clear of crossings and
 * stops. `walk` says whether a tile is pavement.
 */
export function townStreetFurniture(
  town: {
    roads: readonly number[];
    verticalRoads: readonly { x: number; y0: number; y1: number }[];
    width: number;
    height: number;
    margin: number;
    buildings: readonly { barDoorX: number; roadY: number }[];
  },
  walk: (x: number, y: number) => boolean,
) {
  const { roads, verticalRoads, width } = town;
  const busStops = townBusStops(
    roads,
    verticalRoads,
    { width, height: town.height },
    town.margin,
    town.buildings.map((b) => ({ x: b.barDoorX, y: b.roadY })),
  );
  const lamps: { x: number; y: number }[] = [];
  for (const ry of roads)
    for (let tx = 6; tx < width - 4; tx += 11) {
      if (verticalRoads.some((v) => tx >= v.x - 1 && tx <= v.x + 5)) continue;
      if (busStops.some((stop) => nearTownBusStop(stop, { x: tx, y: ry })))
        continue;
      if (walk(tx, ry)) lamps.push({ x: tx, y: ry });
    }
  const busStop = busStops.find((stop) => stop.main)!;
  return { busStops, busStop, lamps };
}
