/**
 * A building's floor (its size and bar, from its room columns) and where the
 * buildings stand on the town's streets. Pure: townLayout.ts lays the town
 * out with them, and a room move's preview (townRoomOrder.ts) re-places a
 * building whose floor the move changes.
 */

import {
  TOWN_CENTER_HEIGHT,
  TOWN_CENTER_STREET,
  TOWN_CENTER_TOP,
  townCenterWidth,
  type TownCenterLot,
} from "./townCenter";
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
/** Phones keep the reception board in the yard above each building. */
export const TOWN_PHONE_BOARD_ROWS = 8;
export const TOWN_FACADE = 2;
export const YARD = 2;
/** The most rows a building sits below the street above its row. */
const FRONT_YARD = 12;
/**
 * The first street's top row where the town center stands among the
 * buildings: room above it for the reception boards over the front doors.
 */
const WIDE_FIRST_STREET = 7;

/** A room column: its left and right edge and the row under its last room. */
export type TownColumnSpan = { x0: number; x1: number; bottom: number };

/** The narrowest building of a shape. */
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
 * Where the buildings (floors, in host order) and the town center stand.
 * Up to four buildings share one street; larger towns wrap into a grid of
 * streets. Every row of lots has a street above and below it (neighbouring
 * rows share one), and a road right of every lot from street to street.
 *
 * Side by side, the center is a lot in the middle of the first row, among
 * the buildings and under the first street, with a bus stop at its corner:
 * a short move from every building at any zoom. Its front steps open onto a
 * paved square running down to the street below. Stacked, it stands above
 * the first street, over the first building, so a phone opens on both.
 */
export function townPlaceLots(
  floors: readonly { w: number; h: number }[],
  shape: TownShape,
) {
  const narrow = shape.formFactor === "narrow";
  const centerW = townCenterWidth(shape.roomColumns === 1);
  const perRow = narrow
    ? 1
    : floors.length <= 4
      ? Math.max(1, floors.length)
      : Math.ceil(Math.sqrt(floors.length * 1.6));
  const placed: {
    x: number;
    y: number;
    w: number;
    h: number;
    roadY: number;
    topRoadY: number;
  }[] = [];
  const verticalRoads: { x: number; y0: number; y1: number }[] = [];
  const widestLot = Math.max(...floors.map((lot) => lot.w));
  let road = narrow ? TOWN_CENTER_STREET : WIDE_FIRST_STREET;
  const roads: number[] = [road];
  let width = MARGIN;
  let center: TownCenterLot | null = null;
  const CENTER = { w: centerW, h: TOWN_CENTER_HEIGHT };
  for (let i = 0; i < floors.length || (!narrow && i === 0); i += perRow) {
    const row: { w: number; h: number }[] = floors.slice(i, i + perRow);
    if (!narrow && i === 0) row.splice(Math.ceil(row.length / 2), 0, CENTER);
    const tallest = Math.max(...row.map((lot) => lot.h));
    const top = road + ROAD_GAP + YARD + (narrow ? TOWN_PHONE_BOARD_ROWS : 0);
    const roadY = top + tallest + TOWN_FACADE + YARD;
    let x = MARGIN;
    for (const lot of row) {
      if (lot === CENTER) {
        // Its dome under the street, level with the receptions.
        center = { x, y: top, w: lot.w, h: lot.h, street: roadY };
      } else {
        // A single stacked lot is centred on its street so every floor
        // plan shares one vertical axis on phones; its side road runs
        // beside it.
        const lx =
          row.length === 1 ? MARGIN + Math.floor((widestLot - lot.w) / 2) : x;
        // A lot far shorter than its row grows (a building gains floor
        // above its bar), so it sits at most FRONT_YARD rows below the
        // street above.
        const h = Math.max(lot.h, tallest + YARD - FRONT_YARD);
        placed.push({
          x: lx,
          y: top + tallest - h,
          w: lot.w,
          h,
          roadY,
          topRoadY: road,
        });
        x = lx;
      }
      x += lot.w;
      verticalRoads.push({ x, y0: road + ROAD_GAP, y1: roadY });
      x += ROAD_GAP;
    }
    width = Math.max(width, x);
    roads.push(roadY);
    road = roadY;
  }
  if (!center) {
    // Stacked: on the buildings' shared axis, above the first street.
    const axis = MARGIN + Math.max(widestLot, centerW) / 2;
    center = {
      x: Math.max(MARGIN, Math.round(axis - centerW / 2)),
      y: TOWN_CENTER_TOP,
      w: centerW,
      h: TOWN_CENTER_HEIGHT,
      street: roads[0]!,
    };
  }
  return { buildings: placed, verticalRoads, roads, width, center };
}
