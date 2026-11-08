/**
 * Where Town's post office (#760) stands, as tiles: left of the town center,
 * fronting the first street as the center does, so the center, its billboard
 * and the post office make one place to act from at the top of the town.
 * Pure geometry with no layout import, so the lots can make room for it
 * (townLots.ts) and everything else reads it from the laid-out center
 * (townPost.ts).
 */

import type { TownCenterLot } from "./townCenter";

/** The lot's width in tiles: the building and its yard share it. */
export const TOWN_POST_WIDTH = 12;
/** The building's rows, its door on the bottom one. */
export const TOWN_POST_HOUSE_ROWS = 6;
/** The sorting yard's rows, in front of the door. */
export const TOWN_POST_YARD_ROWS = 4;
/** Lawn between the post office and the center's west wing. */
export const TOWN_POST_GAP = 2;
/** Columns a wide town keeps left of its center for the lot and its lawn. */
export const TOWN_POST_ROOM = TOWN_POST_WIDTH + TOWN_POST_GAP;

export type TownPostLot = {
  /** Left column and the building's top row, in tiles. */
  x: number;
  y: number;
  w: number;
  /** The sorting yard's top row, at the foot of the door. */
  yardY: number;
};

/**
 * The lot left of the town center's west wing, its yard's front edge on the
 * first street's pavement, so parcels go straight from the yard to the road.
 * Every wide town stands that much further right to keep lawn there
 * (townLots.ts), so the lot never makes anything move as the town grows.
 */
export function townPostLotBeside(center: TownCenterLot): TownPostLot {
  const yardY = center.street - TOWN_POST_YARD_ROWS;
  return {
    x: center.x - TOWN_POST_ROOM,
    y: yardY - TOWN_POST_HOUSE_ROWS,
    w: TOWN_POST_WIDTH,
    yardY,
  };
}

/** Tiles the lot keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townPostReserve(lot: TownPostLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y - 1,
    x1: lot.x + lot.w + 1,
    y1: lot.yardY + TOWN_POST_YARD_ROWS + 1,
  };
}
