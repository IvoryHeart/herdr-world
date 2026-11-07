/**
 * Where Town's rooms stand in their building. Without a saved spot, rooms
 * stack into columns in Herdr's workspace order; once the user moves a room,
 * every room of that building keeps the spot World saved for it (Board's
 * layout `room_pins`), clear of the others. Pure: townLayout.ts lays the town
 * out with these, and a carried room's preview uses the same rules, so it
 * lands exactly where the outlines show.
 */

import type { TownLayout, TownRoom } from "./townLayout";
import {
  ROOM_TOP,
  townFloor,
  townPlaceLots,
  type TownColumnSpan,
} from "./townLots";

/** A room's top-left in its building: tiles from the building's corner. */
export type TownRoomSpot = { x: number; y: number };
/** Saved spots by room key (townRoomSpots in townModel.ts). */
export type TownRoomSpots = ReadonlyMap<string, TownRoomSpot>;
export const NO_ROOM_SPOTS: TownRoomSpots = new Map();

/** Tiles kept clear between rooms, and between a room and the side walls. */
const GAP = 2;

type Box = TownRoomSpot & { w: number; h: number };

/** Whether two rooms stand too close: closer than GAP, or overlapping. */
const clash = (a: Box, b: Box) =>
  a.x < b.x + b.w + GAP &&
  b.x < a.x + a.w + GAP &&
  a.y < b.y + b.h + GAP &&
  b.y < a.y + a.h + GAP;

/** Whether the ranks rooms had (in their new order) are out of order. */
export function townRanksOutOfOrder(ranks: readonly (number | undefined)[]) {
  const known = ranks.filter((rank) => rank !== undefined);
  return known.some((rank, index) => index > 0 && rank < known[index - 1]!);
}

/**
 * Stack rooms, in order, into at most `maxColumns` columns: each room joins
 * the column it keeps (`kept`) or else the shortest. Returns each room's
 * column and position in the building (tiles from its corner), each column's
 * span, and the width the columns take.
 */
export function townStackRooms<R extends { w: number; h: number }>(
  rooms: readonly R[],
  maxColumns: number,
  kept: (room: R) => number | undefined,
  /** The first room's top, in tiles from the building's corner. */
  top: number,
) {
  const columnCount = Math.max(1, Math.min(maxColumns, rooms.length));
  const stacks: number[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array<number>(columnCount).fill(0);
  const columns = rooms.map((room, index) => {
    const keep = kept(room);
    const column =
      keep !== undefined && keep < columnCount
        ? keep
        : heights.indexOf(Math.min(...heights));
    stacks[column]!.push(index);
    heights[column]! += room.h + GAP;
    return column;
  });
  const positions = rooms.map(() => ({ rx: 0, ry: 0 }));
  const spans: TownColumnSpan[] = [];
  let x = GAP;
  for (const stack of stacks) {
    let y = top;
    let widest = 0;
    for (const index of stack) {
      positions[index] = { rx: x, ry: y };
      y += rooms[index]!.h + GAP;
      widest = Math.max(widest, rooms[index]!.w);
    }
    spans.push({ x0: x, x1: x + widest, bottom: y });
    if (stack.length) x += widest + GAP;
  }
  return { columns, positions, spans, width: x };
}

/**
 * Place rooms (in workspace order) at their spots, each clear of the rooms
 * placed before it: a room that would overlap moves down until it is clear.
 * The `first` rooms (the one just dropped) keep their spots; the others go
 * in reading order of their spots. A room without a spot (one opened since)
 * takes the first free place, reading from the top, within the width the
 * placed rooms already take, or else below them.
 */
export function townArrangeRooms<
  R extends { key: string; w: number; h: number },
>(
  rooms: readonly R[],
  spots: TownRoomSpots,
  first: readonly string[] = [],
): Map<string, TownRoomSpot> {
  const placed: Box[] = [];
  const out = new Map<string, TownRoomSpot>();
  const put = (room: R, x: number, y: number) => {
    const box = { x, y, w: room.w, h: room.h };
    for (;;) {
      const hits = placed.filter((other) => clash(box, other));
      if (!hits.length) break;
      box.y = Math.max(...hits.map((other) => other.y + other.h + GAP));
    }
    placed.push(box);
    out.set(room.key, { x: box.x, y: box.y });
  };
  const rank = (key: string) => {
    const at = first.indexOf(key);
    return at < 0 ? first.length : at;
  };
  const order = new Map(rooms.map((room, index) => [room.key, index]));
  const pinned = rooms
    .filter((room) => spots.has(room.key))
    .sort((a, b) => {
      const sa = spots.get(a.key)!;
      const sb = spots.get(b.key)!;
      return (
        rank(a.key) - rank(b.key) ||
        sa.y - sb.y ||
        sa.x - sb.x ||
        order.get(a.key)! - order.get(b.key)!
      );
    });
  for (const room of pinned) {
    const spot = spots.get(room.key)!;
    put(room, Math.max(GAP, spot.x), Math.max(ROOM_TOP, spot.y));
  }
  for (const room of rooms) {
    if (spots.has(room.key)) continue;
    const right = Math.max(0, ...placed.map((box) => box.x + box.w));
    const xs = [GAP, ...placed.map((box) => box.x + box.w + GAP)];
    const ys = [ROOM_TOP, ...placed.map((box) => box.y + box.h + GAP)];
    const free = ys
      .flatMap((y) => xs.map((x) => ({ x, y, w: room.w, h: room.h })))
      .filter(
        (box) =>
          box.x + box.w <= right && !placed.some((other) => clash(box, other)),
      )
      .sort((a, b) => a.y - b.y || a.x - b.x)[0];
    put(room, free?.x ?? GAP, free?.y ?? ROOM_TOP);
  }
  return out;
}

/**
 * The floor spans of rooms at their spots (townFloor): one per room, the
 * rightmost last, so the bar sits under it. Also the width they take.
 */
export function townRoomSpans(
  rooms: readonly { w: number; h: number; key: string }[],
  spots: ReadonlyMap<string, TownRoomSpot>,
) {
  const spans = rooms
    .map((room) => {
      const spot = spots.get(room.key)!;
      return {
        x0: spot.x,
        x1: spot.x + room.w,
        bottom: spot.y + room.h + GAP,
      };
    })
    .sort((a, b) => a.x1 - b.x1 || a.x0 - b.x0);
  return {
    spans,
    width: Math.max(0, ...spans.map((span) => span.x1)) + GAP,
  };
}

/** Room keys in reading order of their spots: top to bottom, left to right. */
export function townReadingOrder(
  spots: ReadonlyMap<string, TownRoomSpot>,
): string[] {
  return [...spots]
    .sort(([ka, a], [kb, b]) => a.y - b.y || a.x - b.x || ka.localeCompare(kb))
    .map(([key]) => key);
}

/** Where a building's rooms would stand after a move, and what it changes. */
export type TownRoomPlacement = {
  hostKey: string;
  /** Every room of the building: its spot, tiles from the building's corner. */
  spots: Map<string, TownRoomSpot>;
  /** The building's rooms in reading order, which Herdr's order follows. */
  order: string[];
  /** Every room in town, in tiles, where it would stand. */
  rooms: Map<string, { x: number; y: number; w: number; h: number }>;
  /** Whether any room of the building would stand somewhere else. */
  changed: boolean;
};

const spotOf = (
  room: TownRoom,
  building: { x: number; y: number },
): TownRoomSpot => ({ x: room.x - building.x, y: room.y - building.y });

/**
 * Where every room would stand if the rooms in `moves` went to those spots
 * in their building (the rest keeping theirs), as layoutTown lays it out
 * once the spots are saved: the moved rooms first, the others moving down
 * out of their way, the building's floor fitted to its rooms, and the
 * buildings placed on their streets again. Null when a room is not in that
 * host's building.
 */
export function townRoomPlacement(
  layout: TownLayout,
  hostKey: string,
  moves: ReadonlyMap<string, TownRoomSpot>,
): TownRoomPlacement | null {
  const index = layout.buildings.findIndex((b) => b.hostKey === hostKey);
  const building = layout.buildings[index];
  if (
    !building ||
    [...moves.keys()].some(
      (key) => !building.rooms.some((room) => room.key === key),
    )
  )
    return null;
  const current = new Map(
    building.rooms.map((room) => [room.key, spotOf(room, building)]),
  );
  const spots = townArrangeRooms(
    building.rooms,
    new Map([...current, ...moves]),
    [...moves.keys()],
  );
  const { spans, width } = townRoomSpans(building.rooms, spots);
  const floors = layout.buildings.map((b, i) =>
    i === index
      ? townFloor(spans, width, layout.shape)
      : { w: b.w, h: b.floorH },
  );
  const lots = townPlaceLots(floors, layout.shape).buildings;
  const rooms = new Map<
    string,
    { x: number; y: number; w: number; h: number }
  >();
  layout.buildings.forEach((b, i) => {
    const lot = lots[i]!;
    for (const room of b.rooms) {
      const spot = i === index ? spots.get(room.key)! : spotOf(room, b);
      rooms.set(room.key, {
        x: lot.x + spot.x,
        y: lot.y + spot.y,
        w: room.w,
        h: room.h,
      });
    }
  });
  return {
    hostKey,
    spots,
    order: townReadingOrder(spots),
    rooms,
    changed: [...spots].some(([key, spot]) => {
      const was = current.get(key)!;
      return was.x !== spot.x || was.y !== spot.y;
    }),
  };
}

/** Where a host's rooms stand now: spots from its building's corner. */
export function townBuildingSpots(
  layout: TownLayout,
  hostKey: string,
): Map<string, TownRoomSpot> {
  const building = layout.buildings.find((b) => b.hostKey === hostKey);
  return new Map(
    building?.rooms.map((room) => [room.key, spotOf(room, building)]) ?? [],
  );
}

/**
 * Tidy rooms: a building's rooms as a building whose rooms were never moved
 * stacks them. In Herdr's workspace order, each room joins the shortest of
 * the shape's columns, the usual gap apart, so nothing overlaps and no
 * column stands taller than it must. That order is also the result's reading
 * order, so Herdr's order keeps it and tidying again changes nothing. Null
 * when the host has no building.
 */
export function townRoomTidy(
  layout: TownLayout,
  hostKey: string,
): TownRoomPlacement | null {
  const building = layout.buildings.find((b) => b.hostKey === hostKey);
  if (!building) return null;
  const { positions } = townStackRooms(
    building.rooms,
    layout.shape.roomColumns,
    () => undefined,
    ROOM_TOP,
  );
  return townRoomPlacement(
    layout,
    hostKey,
    new Map(
      building.rooms.map((room, index) => [
        room.key,
        { x: positions[index]!.rx, y: positions[index]!.ry },
      ]),
    ),
  );
}

/**
 * Undo a tidy: the host's rooms back at the spots they had (`spots`, from
 * townBuildingSpots), rooms closed since left out and rooms opened since
 * kept where they stand, clear of the others.
 */
export function townRoomRestore(
  layout: TownLayout,
  hostKey: string,
  spots: TownRoomSpots,
): TownRoomPlacement | null {
  const building = layout.buildings.find((b) => b.hostKey === hostKey);
  if (!building) return null;
  const present = new Set(building.rooms.map((room) => room.key));
  return townRoomPlacement(
    layout,
    hostKey,
    new Map(
      townReadingOrder(spots)
        .filter((key) => present.has(key))
        .map((key) => [key, spots.get(key)!]),
    ),
  );
}

/**
 * The building's room a room changes places with when moved one place
 * earlier (-1) or later (1) in reading order, or null at either end.
 */
export function townRoomNeighbor(
  layout: TownLayout,
  roomKey: string,
  step: -1 | 1,
): TownRoom | null {
  const building = layout.buildings.find((b) =>
    b.rooms.some((room) => room.key === roomKey),
  );
  if (!building) return null;
  const order = townReadingOrder(
    new Map(building.rooms.map((room) => [room.key, spotOf(room, building)])),
  );
  const key = order[order.indexOf(roomKey) + step];
  return building.rooms.find((room) => room.key === key) ?? null;
}

/**
 * A room and its neighbour in reading order change places (the keyboard's
 * Move before and Move after): each takes the other's spot.
 */
export function townRoomSwap(
  layout: TownLayout,
  roomKey: string,
  step: -1 | 1,
): TownRoomPlacement | null {
  const building = layout.buildings.find((b) =>
    b.rooms.some((room) => room.key === roomKey),
  );
  const room = building?.rooms.find((r) => r.key === roomKey);
  const other = townRoomNeighbor(layout, roomKey, step);
  if (!building || !room || !other) return null;
  return townRoomPlacement(
    layout,
    building.hostKey,
    new Map([
      [room.key, spotOf(other, building)],
      [other.key, spotOf(room, building)],
    ]),
  );
}

/**
 * Where a room carried with its top-left at world tile (x, y) would stand in
 * its building: whole tiles, kept inside the building's walls.
 */
export function townRoomSpotAt(
  layout: TownLayout,
  roomKey: string,
  x: number,
  y: number,
): TownRoomSpot | null {
  const building = layout.buildings.find((b) =>
    b.rooms.some((room) => room.key === roomKey),
  );
  const room = building?.rooms.find((r) => r.key === roomKey);
  if (!building || !room) return null;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high));
  return {
    x: clamp(Math.round(x - building.x), GAP, building.w - GAP - room.w),
    y: clamp(Math.round(y - building.y), ROOM_TOP, building.h - GAP - room.h),
  };
}

/**
 * Whether the rooms stand where the user put them differently between two
 * layouts: a room was moved (saved spots changed) or the workspace order
 * changed under stacked rooms. The change is the user's, not a reflow.
 */
export function townRoomsMoved(previous: TownLayout, next: TownLayout) {
  return (
    (previous.roomSpots ?? NO_ROOM_SPOTS) !==
      (next.roomSpots ?? NO_ROOM_SPOTS) || townRoomsReordered(previous, next)
  );
}

/**
 * Whether any building's rooms that both layouts show stand in a different
 * order: a room was moved, so the change is the user's, not a reflow.
 */
export function townRoomsReordered(
  previous: TownLayout,
  next: TownLayout,
): boolean {
  for (const building of next.buildings) {
    const before = previous.buildings.find(
      (b) => b.hostKey === building.hostKey,
    );
    if (!before) continue;
    const now = new Set(building.rooms.map((room) => room.key));
    const was = before.rooms
      .map((room) => room.key)
      .filter((key) => now.has(key));
    const shared = new Set(was);
    const is = building.rooms
      .map((room) => room.key)
      .filter((key) => shared.has(key));
    if (was.some((key, index) => key !== is[index])) return true;
  }
  return false;
}
