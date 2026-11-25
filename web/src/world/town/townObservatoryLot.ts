/**
 * Where Town's observatory (#1029) stands, as tiles: right of the library,
 * which stands right of the town center (townLibraryLot.ts), its door on the
 * first street as theirs are, so the post office, the center, the library
 * and the observatory make one civic row at the top of the town. Pure
 * geometry with no runtime imports, so the lots can keep room for it
 * (townLots.ts) and the scene (landscape, painter, renderer) reads it
 * without the read model.
 */

import type { TownCenterLot } from "./townCenter";
import type { TownLayout } from "./townLayout";
import { TOWN_LIBRARY_ROOM } from "./townLibraryLot";

/** The observatory's width in tiles. */
export const TOWN_OBSERVATORY_WIDTH = 10;
/** Its rows, the dome on top and the door on the bottom one. */
export const TOWN_OBSERVATORY_ROWS = 12;
/** Lawn between the library's lot and the observatory. */
export const TOWN_OBSERVATORY_GAP = 2;
/** Columns a wide town keeps right of the library for the lot and its verge. */
export const TOWN_OBSERVATORY_ROOM =
  TOWN_OBSERVATORY_GAP + TOWN_OBSERVATORY_WIDTH + 1;

export type TownObservatoryLot = {
  /** Left column and top row, in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * The lot right of the library's, standing on the first street's pavement.
 * A wide town grows rightwards to keep it (townLots.ts), so it never makes
 * anything already standing move.
 */
export function townObservatoryLotBeside(
  center: TownCenterLot,
): TownObservatoryLot {
  return {
    x: center.x + center.w + TOWN_LIBRARY_ROOM + TOWN_OBSERVATORY_GAP,
    y: center.street - TOWN_OBSERVATORY_ROWS,
    w: TOWN_OBSERVATORY_WIDTH,
    h: TOWN_OBSERVATORY_ROWS,
  };
}

/** Tiles the lot keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townObservatoryReserve(lot: TownObservatoryLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y - 1,
    x1: lot.x + lot.w + 1,
    y1: lot.y + lot.h,
  };
}

/**
 * The observatory's lot: right of the library on the first street, on a
 * narrow (phone) town too (#1351).
 */
export function townObservatoryLot(layout: TownLayout): TownObservatoryLot {
  return townObservatoryLotBeside(layout.center);
}

/**
 * The windows that light for agents at work, in pixels from the lot's
 * top-left: the tower's six, top down, then the two wings'. The painter
 * paints them dark; the DOM layer lights one per agent at work.
 */
export const TOWN_OBSERVATORY_WINDOWS: readonly {
  x: number;
  y: number;
}[] = [
  { x: 54, y: 76 },
  { x: 94, y: 76 },
  { x: 54, y: 100 },
  { x: 94, y: 100 },
  { x: 54, y: 124 },
  { x: 94, y: 124 },
  { x: 14, y: 144 },
  { x: 134, y: 144 },
];
export const TOWN_OBSERVATORY_WINDOW = { w: 12, h: 16 } as const;
