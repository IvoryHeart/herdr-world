/**
 * Where Town's post office (#760) stands, as tiles: right beside the town
 * center, so the center, its billboard and the post office make one place
 * to act from at the top of the town. Pure geometry with no layout import,
 * so the layout can make room for the lot (townLayout.ts) and everything
 * else reads it from the laid-out center (townPost.ts).
 */

import { TOWN_CENTER_TOP, type TownCenterLot } from "./townCenter";

/** The lot's width in tiles: the building and its yard share it. */
export const TOWN_POST_WIDTH = 12;
/** The building's rows, its door on the bottom one. */
export const TOWN_POST_HOUSE_ROWS = 6;
/** The sorting yard's rows, in front of the door. */
export const TOWN_POST_YARD_ROWS = 4;
/** Lawn between the center's east wing and the post office. */
export const TOWN_POST_GAP = 2;
/**
 * The house's top row: a row under the center's, so the yard's front edge
 * meets the lawn kept above the first street (TOWN_BILLBOARD_VERGE) and never
 * enters it.
 */
const TOWN_POST_TOP = TOWN_CENTER_TOP + 1;

export type TownPostLot = {
  /** Left column and the building's top row, in tiles. */
  x: number;
  y: number;
  w: number;
  /** The sorting yard's top row, at the foot of the door. */
  yardY: number;
};

/**
 * The lot right of the town center's east wing. Nothing that stands today
 * moves for it: a town without lawn there grows wider to the right
 * (townLayout.ts), its park plaza kept where it was.
 */
export function townPostLotBeside(center: TownCenterLot): TownPostLot {
  const y = TOWN_POST_TOP;
  return {
    x: center.x + center.w + TOWN_POST_GAP,
    y,
    w: TOWN_POST_WIDTH,
    yardY: y + TOWN_POST_HOUSE_ROWS,
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
