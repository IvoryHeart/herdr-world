/**
 * The town center: Town's landmark at the top of the map, centred above the
 * first street, where the owner launches agents and reaches the Town master
 * (its radial menu, TownCenterMenu.tsx). Pure geometry, shared by the layout,
 * the painter, the hit test and the camera.
 */

/**
 * Its rectangle in tiles: the whole drawn building, flag to front steps;
 * `street` is the first street's top row, below its square.
 */
export type TownCenterLot = {
  x: number;
  y: number;
  w: number;
  h: number;
  street: number;
};

/** The center's top row: two tiles of verge above it. */
export const TOWN_CENTER_TOP = 2;
/** The building's height in tiles, its flag included. */
export const TOWN_CENTER_HEIGHT = 15;

/** A phone's center fits its one-column building; wider towns get wings. */
export const townCenterWidth = (narrowPhone: boolean) =>
  narrowPhone ? 24 : 34;

/**
 * The first street's top row, under the center and its square. Phones keep
 * rows for each reception board below the street; elsewhere boards stand
 * across the street and keep their screen size as the town zooms out, so
 * the square is deep enough for them to stand clear of the center.
 */
export const townCenterStreet = (narrow: boolean) =>
  TOWN_CENTER_TOP + TOWN_CENTER_HEIGHT + (narrow ? 3 : 15);

/**
 * Place the center on the buildings' middle column (the town's, without
 * any), kept inside a town `width` tiles wide with `margin` tiles to spare.
 */
export function placeTownCenter(
  buildings: readonly { x: number; w: number }[],
  width: number,
  centerWidth: number,
  margin: number,
  street: number,
): TownCenterLot {
  const axis = buildings.length
    ? (Math.min(...buildings.map((b) => b.x)) +
        Math.max(...buildings.map((b) => b.x + b.w))) /
      2
    : width / 2;
  const x = Math.round(axis - centerWidth / 2);
  return {
    x: Math.max(margin, Math.min(width - margin - centerWidth, x)),
    y: TOWN_CENTER_TOP,
    w: centerWidth,
    h: TOWN_CENTER_HEIGHT,
    street,
  };
}

/**
 * The paved approach from the front steps down to the first street, a little
 * wider than the steps, hedged along its sides. A deep square also gets
 * lamps along the promenade and two benches facing each other.
 * Tiles, x1 and y1 exclusive.
 */
export function townCenterForecourt(center: TownCenterLot) {
  const half = center.w >= 30 ? 8 : 7;
  const mid = center.x + Math.floor(center.w / 2);
  const x0 = mid - half;
  const x1 = mid + half;
  const y0 = center.y + center.h - 2;
  const y1 = center.street;
  const bushes: { x: number; y: number }[] = [];
  for (let y = y1 - 2; y > y0 + 2; y -= 3)
    bushes.push({ x: x0 - 1, y }, { x: x1, y });
  const deep = y1 - y0 > 8;
  const benchY = Math.round((y0 + 2 + y1) / 2);
  const benches = deep
    ? [
        { x: x0 + 1, y: benchY },
        { x: x1 - 3, y: benchY },
      ]
    : [];
  // Lamps line the promenade's edges, clear of the benches.
  const lamps = deep
    ? [y0 + 5, y1 - 2].flatMap((y) => [
        { x: x0, y },
        { x: x1 - 1, y },
      ])
    : [];
  return { x0, y0, x1, y1, bushes, benches, lamps };
}

/** The frieze over the portico, in pixels below the center's top row. */
export const TOWN_CENTER_FRIEZE_Y = 141;

/**
 * The frieze over the doors, in world pixels: where the name plaque hangs
 * and the radial menu centres.
 */
export function townCenterEmblem(center: TownCenterLot, tile: number) {
  return {
    x: (center.x + center.w / 2) * tile,
    y: center.y * tile + TOWN_CENTER_FRIEZE_Y,
  };
}

/** Whether world point (x, y) in pixels is on the drawn building. */
export function townCenterContains(
  center: TownCenterLot,
  tile: number,
  x: number,
  y: number,
) {
  // The flag and dome are narrower than the hall: the top third hits only
  // the central tower, so a press beside the dome still pans the town.
  const top = center.y * tile;
  const left = center.x * tile;
  const right = (center.x + center.w) * tile;
  const bottom = (center.y + center.h) * tile;
  if (x < left || x >= right || y < top || y >= bottom) return false;
  const towerHalf = 3.5 * tile;
  const mid = (left + right) / 2;
  return y >= top + 5 * tile || Math.abs(x - mid) <= towerHalf;
}
