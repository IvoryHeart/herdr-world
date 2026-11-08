/**
 * The town center: Town's landmark at the top of the town, across the first
 * street from the buildings, where the owner launches agents and reaches the
 * Town master (its radial menu, TownCenterMenu.tsx). Pure geometry, shared by the layout, the painter, the
 * hit test and the camera; townLots.ts places it.
 */

/**
 * Its rectangle in tiles: the whole drawn building, flag to front steps;
 * `street` is the top row of the first street, the pavement at its steps.
 */
export type TownCenterLot = {
  x: number;
  y: number;
  w: number;
  h: number;
  street: number;
};

/** A tile's pixels (TOWN_TILE; townLayout.ts imports this module). */
const TILE = 16;

/** The building's height in tiles, its flag included. */
export const TOWN_CENTER_HEIGHT = 15;

/**
 * The city expenses billboard (TownExpenseBoards.tsx) on a wide town: it
 * stands above the center, never over it, keeping a readable size as the
 * town zooms within these scales (townExpenses.css matches them).
 */
export const TOWN_CITY_BOARD_SCALE = { min: 0.55, max: 2 } as const;
/** World pixels between the billboard's posts and the center's flag. */
export const TOWN_CITY_BOARD_GAP = 4;
/**
 * The billboard's height in screen pixels, posts included, with its notes
 * line wrapped: the camera keeps this much above the center in the first
 * view.
 */
export const TOWN_CITY_BOARD_HEIGHT = 104;

/** The billboard's scale at zoom `z`: screen-constant within its limits. */
export const townCityBoardScale = (z: number) =>
  Math.min(
    TOWN_CITY_BOARD_SCALE.max,
    Math.max(TOWN_CITY_BOARD_SCALE.min, 1 / z),
  );

/**
 * The center's top row: two tiles of verge above it, and on a wide town the
 * billboard's rows above those (its tallest, zoomed out).
 */
export const townCenterTop = (wide: boolean) =>
  2 +
  (wide
    ? Math.ceil(
        (TOWN_CITY_BOARD_HEIGHT * TOWN_CITY_BOARD_SCALE.max +
          TOWN_CITY_BOARD_GAP) /
          TILE,
      )
    : 0);

/** A phone's center fits its one-column building; wider towns get wings. */
export const townCenterWidth = (narrowPhone: boolean) =>
  narrowPhone ? 24 : 34;

/**
 * The first street's top row, right under the center: its front steps open
 * straight onto the pavement, so it stands against the road.
 */
export const townCenterStreet = (wide: boolean) =>
  townCenterTop(wide) + TOWN_CENTER_HEIGHT;

/**
 * The paved apron at the foot of the front steps, a little wider than the
 * steps, meeting the street's pavement. Tiles, x1 and y1 exclusive.
 */
export function townCenterForecourt(center: TownCenterLot) {
  const half = center.w >= 30 ? 8 : 7;
  const mid = center.x + Math.floor(center.w / 2);
  const x0 = mid - half;
  const x1 = mid + half;
  const y0 = center.y + center.h - 2;
  const y1 = center.street;
  return { x0, y0, x1, y1 };
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
