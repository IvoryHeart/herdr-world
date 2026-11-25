/**
 * Where Town's harbour (the Shipyard, #1028) stands, as tiles: the town's
 * right-most edge, on open sea. A wide town ends in a shore (the warehouse
 * on the first street, then a stone promenade the streets run into) and the
 * sea beyond it, which runs on off the map's right edge (townLandscape.ts,
 * townRendererTopology.ts). One shipping lane per project crosses the sea
 * from the promenade. Pure geometry with no layout import, so the layout
 * can size the town for it and everything else reads it from the layout.
 */

import type { TownCenterLot } from "./townCenter";

/** The warehouse's lot width in tiles: its house and its yard share it. */
export const TOWN_WAREHOUSE_WIDTH = 12;
/** The warehouse's rows, its loading door on the bottom one. */
export const TOWN_WAREHOUSE_HOUSE_ROWS = 6;
/** The warehouse yard's rows, in front of the door, on the first street. */
export const TOWN_WAREHOUSE_YARD_ROWS = 4;
/** The stone promenade along the water, in tiles. */
export const TOWN_PROMENADE = 2;
/** The shore: the warehouse lot and the promenade. */
export const TOWN_HARBOUR_SHORE = TOWN_WAREHOUSE_WIDTH + TOWN_PROMENADE;
/** The sea the town's own map keeps, past the promenade, in tiles. */
export const TOWN_HARBOUR_SEA = 23;
/** Columns a wide town adds at its right edge for the harbour. */
export const TOWN_HARBOUR_ROOM = TOWN_HARBOUR_SHORE + TOWN_HARBOUR_SEA;
/** The Shipyard sign's row, clear of the map's top edge where a wide
 * screen's home view cuts it. */
export const TOWN_HARBOUR_SIGN_ROW = 2;
/** The first lane's top row, below the sign at its largest, and the rows
 * each lane takes. */
export const TOWN_LANE_TOP = 7;
export const TOWN_LANE_PITCH = 6;
/** A lane's pier row, below the berths' rows where ships lie. */
export const TOWN_LANE_PIER_ROW = 4;

export type TownWarehouseLot = {
  /** Left column and the house's top row, in tiles. */
  x: number;
  y: number;
  w: number;
  /** The yard's top row, at the foot of the loading door. */
  yardY: number;
};

export type TownHarbourLot = {
  /** The shore's left column, in tiles. */
  x: number;
  /** The first sea column: the promenade's water edge. */
  coast: number;
  /** The map's right edge in tiles; the sea runs on past it. */
  right: number;
  /** Where the streets end: the promenade's first column. */
  streetEnd: number;
  /** The rows the harbour runs, top to bottom (exclusive). */
  top: number;
  bottom: number;
  warehouse: TownWarehouseLot;
  /** How many lanes the sea's height holds. */
  lanes: number;
  /**
   * Rows the sign and lanes move down from their top rows, so the drawn
   * lanes sit vertically centred on the sea (townHarbourPlaced); 0 until
   * placed.
   */
  shift: number;
};

/**
 * The harbour of a wide town `width` tiles wide (sea included) and `height`
 * tall, its warehouse yard's front edge on the first street's pavement.
 */
export function townHarbourGeometry(
  width: number,
  height: number,
  center: TownCenterLot,
): TownHarbourLot {
  const coast = width - TOWN_HARBOUR_SEA;
  const x = coast - TOWN_HARBOUR_SHORE;
  const yardY = center.street - TOWN_WAREHOUSE_YARD_ROWS;
  return {
    x,
    coast,
    right: width,
    streetEnd: coast - TOWN_PROMENADE,
    top: 0,
    bottom: height,
    warehouse: {
      x,
      y: yardY - TOWN_WAREHOUSE_HOUSE_ROWS,
      w: TOWN_WAREHOUSE_WIDTH,
      yardY,
    },
    lanes: Math.max(
      1,
      Math.floor((height - TOWN_LANE_TOP - 1) / TOWN_LANE_PITCH),
    ),
    shift: 0,
  };
}

/** Lane `index`'s pier row, in tiles. */
export const townLanePier = (index: number) =>
  TOWN_LANE_TOP + index * TOWN_LANE_PITCH + TOWN_LANE_PIER_ROW;

/** Tiles the warehouse keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townWarehouseReserve(lot: TownWarehouseLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y - 1,
    x1: lot.x + lot.w + 1,
    y1: lot.yardY + TOWN_WAREHOUSE_YARD_ROWS + 1,
  };
}

/** Tiles the whole harbour keeps from the land: the shore and the sea. */
export function townHarbourReserve(lot: TownHarbourLot) {
  return {
    x0: lot.streetEnd,
    y0: -Infinity,
    x1: Infinity,
    y1: Infinity,
  };
}
