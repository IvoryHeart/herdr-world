/**
 * Where Town's observatory (#1029) stands, as tiles: right of the town
 * center, its door on the first street as the center's is, so the center,
 * the post office on its left and the observatory on its right make one
 * place to act from at the top of the town. Pure geometry with no runtime
 * imports, so the layout can keep room for it (townLayout.ts) and the scene
 * (landscape, painter, renderer) reads it without the read model.
 */

import type { TownCenterLot } from "./townCenter";
import type { TownLayout } from "./townLayout";

/** The observatory's width in tiles. */
export const TOWN_OBSERVATORY_WIDTH = 10;
/** Its rows, the dome on top and the door on the bottom one. */
export const TOWN_OBSERVATORY_ROWS = 12;
/** Lawn between the center's east wing and the observatory. */
export const TOWN_OBSERVATORY_GAP = 2;
/** Columns a wide town keeps right of its center for the lot and its verge. */
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
 * The lot right of the center's east wing, standing on the first street's
 * pavement. The layout grows rightwards to keep it (townLayout.ts), so it
 * never makes anything already standing move.
 */
export function townObservatoryLotBeside(
  center: TownCenterLot,
): TownObservatoryLot {
  return {
    x: center.x + center.w + TOWN_OBSERVATORY_GAP,
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
 * The observatory's lot: right of the town center on the first street. A
 * narrow (stacked) town folds it to a sign on the center's left wing.
 */
export function townObservatoryLot(
  layout: TownLayout,
): TownObservatoryLot | null {
  if (layout.formFactor === "narrow") return null;
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
