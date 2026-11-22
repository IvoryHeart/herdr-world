/**
 * Town's shape: how the town fits its container, and how many rooms per row
 * each building takes (the Rooms per row setting, #1188). Pure; townLayout.ts
 * lays the town out with it.
 */

import type { TownRoomsPerRow } from "../officePreferences";
import type { TownFormFactor } from "./townLayout";
import { ROOM_TOP, TOWN_PHONE_DESK_COLUMNS, townFloor } from "./townLots";
import { townStackRooms } from "./townRoomPlace";

/**
 * How the town fits its container: how many columns of rooms a building has,
 * how wide a room may grow before it extends downward, and whether buildings
 * stand side by side on one street (`wide`) or stack (`narrow`).
 */
export type TownShape = {
  formFactor: TownFormFactor;
  /** Rooms per row: the count, or with `autoRooms` the most a building takes. */
  roomColumns: number;
  deskColumns: number;
  /**
   * Each building takes the rooms per row, up to `roomColumns`, that keep
   * its floor about square (townRoomColumnsFor): the Rooms per row setting
   * on Auto, outside phones.
   */
  autoRooms?: boolean;
};

/**
 * CSS pixels a room column needs on Auto: the most rooms per row a building
 * takes is the view's width over this, two to five, so a building fitted to
 * the view keeps readable rooms (about 1100 px, the chat docked, takes 4).
 */
const AUTO_COLUMN_PX = 240;

export const TOWN_SHAPES = {
  /**
   * Phones: three columns of compact rooms, four desks wide, buildings
   * stacked. The first view fits a building's width, so its rooms show as
   * cards spread across the floor rather than one long column (#889).
   */
  phone: {
    formFactor: "narrow",
    roomColumns: 3,
    deskColumns: TOWN_PHONE_DESK_COLUMNS,
  },
  /** Portrait monitors and half-width windows: two columns, stacked. */
  portrait: { formFactor: "narrow", roomColumns: 2, deskColumns: 6 },
  /** Mid-width landscape windows: buildings on one street, two columns. */
  medium: { formFactor: "wide", roomColumns: 2, deskColumns: 6 },
  /** Wide screens: three columns of rooms up to eight desks wide. */
  wide: { formFactor: "wide", roomColumns: 3, deskColumns: 8 },
} as const satisfies Record<string, TownShape>;

/**
 * The shape for a container of this size in CSS pixels. Rooms per row on
 * Auto (the default) is chosen per building, up to what fits the width;
 * phones keep their three compact columns unless a count is chosen.
 */
export function townShapeFor(
  width: number,
  height: number,
  roomsPerRow: TownRoomsPerRow = "auto",
): TownShape {
  const base =
    width < 640
      ? TOWN_SHAPES.phone
      : height > width * 1.05
        ? TOWN_SHAPES.portrait
        : width < 1200
          ? TOWN_SHAPES.medium
          : TOWN_SHAPES.wide;
  if (roomsPerRow !== "auto")
    return sameShape({ ...base, roomColumns: roomsPerRow });
  if (base === TOWN_SHAPES.phone) return base;
  const most = Math.min(5, Math.max(2, Math.floor(width / AUTO_COLUMN_PX)));
  return sameShape({ ...base, roomColumns: most, autoRooms: true });
}

/** One object per shape, so the same shape is the same input to a layout. */
const shapes = new Map<string, TownShape>();
const sameShape = (shape: TownShape) => {
  const key = townShapeKey(shape);
  const known = shapes.get(key);
  if (known) return known;
  shapes.set(key, shape);
  return shape;
};

/** Score of a floor's width over height: 0 from 1:1 to 4:3, more further. */
const squareness = (w: number, h: number) => {
  const ratio = w / Math.max(1, h);
  return ratio < 1 ? Math.log(1 / ratio) : Math.max(0, Math.log(ratio * 0.75));
};

/**
 * How many rooms per row a building takes: the shape's count, or on Auto
 * the count, up to the shape's, whose floor (rooms stacked in workspace
 * order, with lobby and bar) is closest to square, a little wider than
 * tall; fewer columns on a tie, so small buildings stay compact.
 */
export function townRoomColumnsFor(
  rooms: readonly { w: number; h: number }[],
  shape: TownShape,
): number {
  if (!shape.autoRooms) return shape.roomColumns;
  let best = 1;
  let bestScore = Number.POSITIVE_INFINITY;
  const most = Math.max(1, Math.min(shape.roomColumns, rooms.length));
  for (let columns = 1; columns <= most; columns += 1) {
    const { spans, width } = townStackRooms(
      rooms,
      columns,
      () => undefined,
      ROOM_TOP,
    );
    const floor = townFloor(spans, width, shape);
    const score = squareness(floor.w, floor.h);
    if (score < bestScore - 1e-9) {
      best = columns;
      bestScore = score;
    }
  }
  return best;
}

/** A shape's identity: placement memory is kept per shape. */
export const townShapeKey = (shape: TownShape) =>
  `${shape.formFactor}:${shape.roomColumns}:${shape.deskColumns}${shape.autoRooms ? ":auto" : ""}`;
