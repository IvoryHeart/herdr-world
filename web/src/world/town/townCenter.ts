/**
 * The town center: Town's landmark at the top of the town, across the first
 * street from the buildings, where the owner launches agents and reaches the
 * Town master (its radial menu, TownCenterMenu.tsx). Pure geometry, shared by the layout, the painter, the
 * hit test and the camera; townLots.ts places it.
 */

/**
 * Its rectangle in tiles: the whole drawn building, flag to front steps;
 * `street` is the top row of the first street, where its forecourt ends.
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
 * The first street's top row, under the center and its short forecourt: the
 * steps open onto the pavement with no lawn between them.
 */
export const TOWN_CENTER_STREET = TOWN_CENTER_TOP + TOWN_CENTER_HEIGHT + 3;

/**
 * The paved forecourt from the front steps down to the street's pavement, a
 * little wider than the steps, hedged along its sides. Tiles, x1 and y1
 * exclusive.
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
  return { x0, y0, x1, y1, bushes };
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
