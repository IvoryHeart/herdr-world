/**
 * Where Town's harbour (the Shipyard, #1028) stands, as tiles: right of the
 * town center, mirroring the post office on its left, its quay fronting the
 * first street as the center does. Center, post office and harbour make one
 * row of places to act from at the top of the town. Pure geometry with no
 * layout import, so the layout can keep lawn for it and everything else
 * reads it from the laid-out center (townHarbour.ts).
 */

import { TOWN_CENTER_FRIEZE_Y, type TownCenterLot } from "./townCenter";

/** The lot's width in tiles: basin and quay share it. */
export const TOWN_HARBOUR_WIDTH = 16;
/** The basin's rows, where releases moor as ships. */
export const TOWN_HARBOUR_BASIN_ROWS = 7;
/** The quay's rows, between the basin and the street: waiting cargo. */
export const TOWN_HARBOUR_QUAY_ROWS = 3;
/** Lawn between the center's east wing and the harbour. */
export const TOWN_HARBOUR_GAP = 2;
/** Columns a wide town keeps right of its center for the lot and its lawn. */
export const TOWN_HARBOUR_ROOM = TOWN_HARBOUR_GAP + TOWN_HARBOUR_WIDTH;

export type TownHarbourLot = {
  /** Left column and the basin's top row, in tiles. */
  x: number;
  y: number;
  w: number;
  /** The quay's top row, at the basin's foot. */
  quayY: number;
};

/**
 * The lot right of the town center's east wing, the quay's front edge on
 * the first street's pavement. The town is laid out wide enough to keep
 * lawn there (townLayout.ts), so the lot never moves what already stands.
 */
export function townHarbourLotBeside(center: TownCenterLot): TownHarbourLot {
  const quayY = center.street - TOWN_HARBOUR_QUAY_ROWS;
  return {
    x: center.x + center.w + TOWN_HARBOUR_GAP,
    y: quayY - TOWN_HARBOUR_BASIN_ROWS,
    w: TOWN_HARBOUR_WIDTH,
    quayY,
  };
}

/** Tiles the lot keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townHarbourReserve(lot: TownHarbourLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y - 1,
    x1: lot.x + lot.w + 1,
    y1: lot.quayY + TOWN_HARBOUR_QUAY_ROWS + 1,
  };
}

/**
 * Where a narrow town's folded harbour sign hangs, in world pixels: on the
 * town center's left wing, level with the post office's folded sign on its
 * right wing, inside a phone's home view.
 */
export function townHarbourFoldAt(center: TownCenterLot, tile: number) {
  return {
    x: center.x * tile + 60,
    y: center.y * tile + TOWN_CENTER_FRIEZE_Y + 40,
  };
}
