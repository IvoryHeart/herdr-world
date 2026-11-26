/**
 * Where Town's library (#1027) stands, as tiles: right of the town center,
 * fronting the first street as the center and the post office do, so the
 * three make one civic row at the top of the town. Its reading garden fronts
 * the street; the house holds every agent's and project's memory as books.
 * Pure geometry with no layout import, so the lots can make room for it
 * (townLots.ts) and everything else reads it from the laid-out center.
 * A narrow (phone) town stands it there too (#1351).
 */

import type { TownCenterLot } from "./townCenter";

/** The lot's width in tiles: the building and its garden share it. */
export const TOWN_LIBRARY_WIDTH = 12;
/** The building's rows, its door on the bottom one. */
export const TOWN_LIBRARY_HOUSE_ROWS = 6;
/** The reading garden's rows, in front of the door. */
export const TOWN_LIBRARY_YARD_ROWS = 4;
/** Lawn between the center's east wing and the library. */
export const TOWN_LIBRARY_GAP = 2;
/** Columns a wide town keeps right of its center for the lot and its lawn. */
export const TOWN_LIBRARY_ROOM = TOWN_LIBRARY_GAP + TOWN_LIBRARY_WIDTH;

export type TownLibraryLot = {
  /** Left column and the building's top row, in tiles. */
  x: number;
  y: number;
  w: number;
  /** The garden's top row, at the foot of the door. */
  yardY: number;
};

/**
 * The lot right of the town center's east wing, its garden's front edge on
 * the first street's pavement. A wide town is always wide enough to hold it
 * (townLots.ts), and nothing stands there, so it never moves anything.
 */
export function townLibraryLotBeside(center: TownCenterLot): TownLibraryLot {
  const yardY = center.street - TOWN_LIBRARY_YARD_ROWS;
  return {
    x: center.x + center.w + TOWN_LIBRARY_GAP,
    y: yardY - TOWN_LIBRARY_HOUSE_ROWS,
    w: TOWN_LIBRARY_WIDTH,
    yardY,
  };
}

/** Tiles the lot keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townLibraryReserve(lot: TownLibraryLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y - 1,
    x1: lot.x + lot.w + 1,
    y1: lot.yardY + TOWN_LIBRARY_YARD_ROWS + 1,
  };
}

/** The lot of a laid-out town, wide or narrow. */
export function townLibraryLot(layout: {
  center: TownCenterLot;
}): TownLibraryLot {
  return townLibraryLotBeside(layout.center);
}
