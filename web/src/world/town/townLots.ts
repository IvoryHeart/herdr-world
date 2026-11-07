/**
 * A building's floor (its size and bar, from its room columns) and where the
 * buildings stand on the town's streets. Pure: townLayout.ts lays the town
 * out with them, and a room move's preview (townRoomOrder.ts) re-places a
 * building whose floor the move changes.
 */

import type { TownShape } from "./townLayout";

export const ROOM_TOP = 9;
/** The bar's height with the wall row under it, and the lobby's height. */
export const LOBBY_HEIGHT = 7;
/** The bar's sofa corner: its first twelve tiles keep the old lounge's spots. */
export const SOFA_CORNER = 12;
/** The bar's widest: the sofa corner, then a short counter with three stools. */
const BAR_WIDTH = SOFA_CORNER + 8;
const MIN_BUILDING_WIDTH = 38;
/** A phone's one-column building: the bar, counter and queue still fit. */
const MIN_PHONE_BUILDING_WIDTH = 26;
export const MARGIN = 3;
export const ROAD_GAP = 5;
/** The reserved town-hall lot's height; its width is a minimum building's. */
const TOWN_HALL_HEIGHT = 18;
/** Phones keep the reception board in the yard above each building. */
export const TOWN_PHONE_BOARD_ROWS = 8;
export const TOWN_FACADE = 2;
export const YARD = 2;
/** The most rows a building sits below the street above its row. */
const FRONT_YARD = 12;

/** A room column: its left and right edge and the row under its last room. */
export type TownColumnSpan = { x0: number; x1: number; bottom: number };

/** The narrowest building of a shape (the town hall's lot is one). */
const minWidthOf = (shape: TownShape) =>
  shape.formFactor === "narrow" && shape.roomColumns === 1
    ? MIN_PHONE_BUILDING_WIDTH
    : MIN_BUILDING_WIDTH;

/**
 * A building's size and bar from its room columns (`width`: the tiles the
 * columns take). The bar sits in the bottom corner under the last room
 * column, 12-20 tiles back from its right end; other columns may run down to
 * the bottom wall.
 */
export function townFloor(
  spans: readonly TownColumnSpan[],
  width: number,
  shape: TownShape,
) {
  const w = Math.max(width, minWidthOf(shape));
  const last = spans.filter((span) => span.x1 > span.x0).pop();
  const right = last ? Math.min(last.x1 + 1, w - 2) : w - 2;
  const left = Math.max(2, last ? last.x0 - 1 : 2);
  const barWidth = Math.min(BAR_WIDTH, Math.max(SOFA_CORNER, right - left));
  const barX = right - barWidth;
  const bottomOf = (over: boolean) =>
    Math.max(
      ROOM_TOP,
      ...spans
        .filter(
          (span) => (span.x0 < barX + barWidth && span.x1 > barX) === over,
        )
        .map((span) => span.bottom),
    );
  const h = Math.max(bottomOf(true) + LOBBY_HEIGHT, bottomOf(false));
  return { w, h, barX, barWidth };
}

/**
 * Where the buildings (floors, in host order) stand, then the reserved town
 * hall. Up to four lots share one street; larger towns wrap into a grid of
 * streets. Every row of lots has a street above and below it (neighbouring
 * rows share one), and a road right of every lot from street to street.
 */
export function townPlaceLots(
  floors: readonly { w: number; h: number }[],
  shape: TownShape,
) {
  const narrow = shape.formFactor === "narrow";
  const lots = [...floors, { w: minWidthOf(shape), h: TOWN_HALL_HEIGHT }];
  const perRow = narrow
    ? 1
    : lots.length <= 4
      ? lots.length
      : Math.ceil(Math.sqrt(lots.length * 1.6));
  const placed: {
    x: number;
    y: number;
    w: number;
    h: number;
    roadY: number;
    topRoadY: number;
  }[] = [];
  const verticalRoads: { x: number; y0: number; y1: number }[] = [];
  const widestLot = Math.max(...lots.map((lot) => lot.w));
  let road = MARGIN + 2;
  const roads: number[] = [road];
  let width = MARGIN;
  for (let i = 0; i < lots.length; i += perRow) {
    const row = lots.slice(i, i + perRow);
    const tallest = Math.max(...row.map((lot) => lot.h));
    const top = road + ROAD_GAP + YARD + (narrow ? TOWN_PHONE_BOARD_ROWS : 0);
    const roadY = top + tallest + TOWN_FACADE + YARD;
    let x = MARGIN;
    for (const lot of row) {
      // A single stacked lot is centred on its street so every floor plan
      // shares one vertical axis on phones; its side road runs beside it.
      const lx =
        row.length === 1 ? MARGIN + Math.floor((widestLot - lot.w) / 2) : x;
      // A lot far shorter than its row grows (a building gains floor above
      // its bar), so it sits at most FRONT_YARD rows below the street above.
      const h = Math.max(lot.h, tallest + YARD - FRONT_YARD);
      placed.push({
        x: lx,
        y: top + tallest - h,
        w: lot.w,
        h,
        roadY,
        topRoadY: road,
      });
      x = lx + lot.w;
      verticalRoads.push({ x, y0: road + ROAD_GAP, y1: roadY });
      x += ROAD_GAP;
    }
    width = Math.max(width, x);
    roads.push(roadY);
    road = roadY;
  }
  const { x, y, w, h } = placed.pop()!;
  return {
    buildings: placed,
    townHall: { x, y, w, h },
    verticalRoads,
    roads,
    width,
  };
}
