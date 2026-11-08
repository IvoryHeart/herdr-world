/**
 * A building's floor (its size and bar, from its room columns) and where the
 * buildings stand on the town's streets. Pure: townLayout.ts lays the town
 * out with them, and a room move's preview (townRoomOrder.ts) re-places a
 * building whose floor the move changes.
 */

import {
  TOWN_CENTER_HEIGHT,
  townCenterStreet,
  townCenterTop,
  townCenterWidth,
  type TownCenterLot,
} from "./townCenter";
import type { TownShape } from "./townLayout";
import { TOWN_POST_ROOM } from "./townPostLot";

export const ROOM_TOP = 9;
/** The bar's height with the wall row under it, and the lobby's height. */
export const LOBBY_HEIGHT = 7;
/** The bar's sofa corner: its first twelve tiles keep the old lounge's spots. */
export const SOFA_CORNER = 12;
/** The bar's widest: the sofa corner, then a short counter with three stools. */
const BAR_WIDTH = SOFA_CORNER + 8;
/**
 * Every building's + Add room doorway: this many tiles wide, one tile left of
 * the bar, in the bar's rows. Its place follows only the bar, never the rooms.
 */
export const ADD_ROOM_WIDTH = 5;
/** Tiles between the Add room doorway and the bar. */
const ADD_ROOM_GAP = 1;
/** The bar's leftmost x: the doorway still fits inside the left wall. */
const MIN_BAR_X = 2 + ADD_ROOM_WIDTH + ADD_ROOM_GAP;
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
 * A side road from the street above a row of lots (y0, the row under that
 * street) to the street below (y1, that street's row), `x` its left
 * pavement. Every lot has one on its right; the town's `edge` roads run down
 * the left of each row's first lot and have no bus stop.
 */
export type TownVerticalRoad = {
  x: number;
  y0: number;
  y1: number;
  edge?: true;
};

/** A room column: its left and right edge and the row under its last room. */
export type TownColumnSpan = { x0: number; x1: number; bottom: number };

/** The narrowest building of a shape. */
const minWidthOf = (shape: TownShape) =>
  shape.formFactor === "narrow" && shape.roomColumns === 1
    ? MIN_PHONE_BUILDING_WIDTH
    : MIN_BUILDING_WIDTH;

/**
 * A building's size, bar and + Add room doorway from its room columns
 * (`width`: the tiles the columns take). The bar sits in the bottom corner
 * under the last room column, 12-20 tiles back from its right end, and the
 * doorway just left of it: a bar too near the left wall for the doorway
 * gives up stools, down to its sofa corner, then moves right. Columns over
 * the bar or the doorway end above them; other columns may run down to the
 * bottom wall.
 */
export function townFloor(
  spans: readonly TownColumnSpan[],
  width: number,
  shape: TownShape,
) {
  const w = Math.max(width, minWidthOf(shape));
  const last = spans.filter((span) => span.x1 > span.x0).pop();
  const right = last ? Math.min(last.x1 + 1, w - 2) : w - 2;
  const left = Math.max(MIN_BAR_X, last ? last.x0 - 1 : 2);
  const barWidth = Math.min(BAR_WIDTH, Math.max(SOFA_CORNER, right - left));
  // Every shape's narrowest floor holds the doorway and a sofa corner.
  const barX = Math.max(MIN_BAR_X, right - barWidth);
  const addRoomX = barX - ADD_ROOM_GAP - ADD_ROOM_WIDTH;
  const bottomOf = (over: boolean) =>
    Math.max(
      ROOM_TOP,
      ...spans
        .filter(
          (span) => (span.x0 < barX + barWidth && span.x1 > addRoomX) === over,
        )
        .map((span) => span.bottom),
    );
  const h = Math.max(bottomOf(true) + LOBBY_HEIGHT, bottomOf(false));
  return { w, h, barX, barWidth, addRoomX };
}

/**
 * Where the buildings (floors, in host order) and the town center stand.
 * Up to four buildings share one street; larger towns wrap into a grid of
 * streets. Every row of lots has a street above and below it (neighbouring
 * rows share one), and a road right of every lot from street to street; a
 * matching road down the left of each row's first lot (`edge`) bounds the
 * town on that side too.
 *
 * The center stands at the top of the town, just across the first street
 * from the buildings and centred over the first row, facing down onto the
 * street: its short forecourt meets the pavement, so it is one short move
 * from every building. A phone opens on it and the first building together.
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
      ? floors.length
      : Math.ceil(Math.sqrt(floors.length * 1.6));
  const placed: {
    x: number;
    y: number;
    w: number;
    h: number;
    roadY: number;
    topRoadY: number;
  }[] = [];
  const verticalRoads: TownVerticalRoad[] = [];
  const widestLot = Math.max(0, ...floors.map((lot) => lot.w));
  let road = townCenterStreet(!narrow);
  const roads: number[] = [road];
  /** Every row's left edge: right of the road down the town's left side. */
  const left = MARGIN + ROAD_GAP;
  let width = MARGIN;
  /** The right edge of the first row's last building. */
  let firstRowRight = left + widestLot;
  for (let i = 0; i < floors.length; i += perRow) {
    const row = floors.slice(i, i + perRow);
    const tallest = Math.max(...row.map((lot) => lot.h));
    const top = road + ROAD_GAP + YARD + (narrow ? TOWN_PHONE_BOARD_ROWS : 0);
    const roadY = top + tallest + TOWN_FACADE + YARD;
    let x = left;
    for (const lot of row) {
      // A single stacked lot is centred on its street so every floor plan
      // shares one vertical axis on phones; its side roads run beside it.
      const lx =
        row.length === 1 ? left + Math.floor((widestLot - lot.w) / 2) : x;
      if (lot === row[0])
        verticalRoads.push({
          x: lx - ROAD_GAP,
          y0: road + ROAD_GAP,
          y1: roadY,
          edge: true,
        });
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
    if (i === 0 && row.length > 1) firstRowRight = x - ROAD_GAP;
    width = Math.max(width, x);
    roads.push(roadY);
    road = roadY;
  }
  // Centred over the first row (a stacked town's shared axis), facing it
  // across the first street.
  const axis = left + Math.max(firstRowRight - left, centerW) / 2;
  const center: TownCenterLot = {
    x: Math.max(MARGIN, Math.round(axis - centerW / 2)),
    y: townCenterTop(!narrow),
    w: centerW,
    h: TOWN_CENTER_HEIGHT,
    street: roads[0]!,
  };
  // The post office stands left of the center (townPostLot.ts): a wide town
  // keeps lawn for it by standing everything that many columns right. The
  // shift is the same for every wide town, so a town that grows (and its
  // center with it) never moves what already stands. A narrow town folds
  // the post office to a sign instead.
  const shift = narrow ? 0 : TOWN_POST_ROOM;
  if (shift) {
    for (const lot of placed) lot.x += shift;
    for (const road of verticalRoads) road.x += shift;
    center.x += shift;
    width += shift;
  }
  return { buildings: placed, verticalRoads, roads, width, center, shift };
}
