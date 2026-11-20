/**
 * Where Town's apartment building (#1011) stands, as tiles: in the park
 * beside the plaza, its door on the plaza's walk, so finished agents live on
 * at the edge of the town they worked in. Pure geometry: the scene paints
 * the house (townApartmentsPaint.ts), the landscape keeps it clear and the
 * DOM layer hangs its sign (TownApartments.tsx).
 */

import type { TownLayout, TownPoint } from "./townLayout";
import { MARGIN } from "./townLots";

/** World pixels a tile (townLayout's TOWN_TILE, which imports this file). */
const T = 16;

/** The house's width in tiles. */
export const TOWN_APARTMENTS_WIDTH = 8;
/** Its rows, the door on the bottom one. */
export const TOWN_APARTMENTS_ROWS = 6;
/** Lawn between the house and the plaza's widest point. */
const GAP = 1;

export type TownApartmentsLot = {
  /** Left column and top row, in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * Left of the plaza, or right of it where the left has no room; null when
 * neither side fits (Apartments then opens from the town center).
 */
export function townApartmentsLot(
  layout: Pick<TownLayout, "plaza" | "width">,
): TownApartmentsLot | null {
  const { plaza, width } = layout;
  const w = TOWN_APARTMENTS_WIDTH;
  const h = TOWN_APARTMENTS_ROWS;
  // The plaza's walk runs along its middle row: the door opens onto it.
  const y = plaza.y - h;
  const left = plaza.x - 8 - GAP - w;
  if (left >= MARGIN) return { x: left, y, w, h };
  const right = plaza.x + 9 + GAP;
  if (right + w <= width - MARGIN) return { x: right, y, w, h };
  return null;
}

/** Tiles the house keeps clear (x1, y1 exclusive), with a tile of verge. */
export function townApartmentsReserve(lot: TownApartmentsLot) {
  return {
    x0: lot.x - 1,
    y0: lot.y,
    x1: lot.x + lot.w + 1,
    y1: lot.y + lot.h,
  };
}

/**
 * The footpath's column (layoutTown paints it), on the house's plaza side:
 * from the bus's stop on the street above down its lawn to the plaza's walk.
 */
export function townApartmentsPathColumn(
  lot: TownApartmentsLot,
  plaza: TownPoint,
) {
  return lot.x < plaza.x ? lot.x + lot.w : lot.x - 1;
}

/** Where an agent goes in at the front door, in world pixels. */
export function townApartmentsDoor(lot: TownApartmentsLot): TownPoint {
  return { x: (lot.x + lot.w / 2) * T, y: (lot.y + lot.h) * T - 4 };
}
