/**
 * Where Town's one bus stop stands: on the topmost street, just right of its
 * right-hand crossing (or at the street's right end when it has none), on the
 * near sidewalk, so buses pull up in the lane beside it. When a later layout
 * adds a street above the first row of buildings, the same rule picks it.
 * Tile coordinates.
 */
export type TownBusStop = {
  /** The pole's tile. */
  x: number;
  y: number;
  /** The street's top sidewalk row (TownLayout.roads); buses use the lane below. */
  road: number;
  /** The tile column where queued buses must stop (the street's left end). */
  queueStart: number;
};

export function townBusStop(
  roads: readonly number[],
  verticalRoads: readonly { x: number; y0: number; y1: number }[],
  width: number,
  margin: number,
): TownBusStop {
  const road = Math.min(...roads);
  const crossings = verticalRoads.filter((v) => v.y1 === road);
  const right = crossings.length
    ? Math.max(...crossings.map((v) => v.x)) + 6
    : width - margin - 3;
  return {
    x: Math.min(width - 2, right),
    y: road,
    road,
    queueStart: 1,
  };
}

/** Whether a tile is clear of the stop (lamps and benches keep their distance). */
export const nearTownBusStop = (
  stop: TownBusStop,
  point: { x: number; y: number },
) => Math.abs(point.x - stop.x) <= 2 && Math.abs(point.y - stop.y) <= 1;
