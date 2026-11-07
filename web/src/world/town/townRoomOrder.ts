/**
 * Town's room order within a building: rooms stack into columns in Herdr's
 * workspace order (townLayout.ts), where a moved room lands, and whether a
 * layout change was a move.
 */

import type { TownLayout } from "./townLayout";

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
    heights[column]! += room.h + 2;
    return column;
  });
  const positions = rooms.map(() => ({ rx: 0, ry: 0 }));
  const spans: { x0: number; x1: number; bottom: number }[] = [];
  let x = 2;
  for (const stack of stacks) {
    let y = top;
    let widest = 0;
    for (const index of stack) {
      positions[index] = { rx: x, ry: y };
      y += rooms[index]!.h + 2;
      widest = Math.max(widest, rooms[index]!.w);
    }
    spans.push({ x0: x, x1: x + widest, bottom: y });
    if (stack.length) x += widest + 2;
  }
  return { columns, positions, spans, width: x };
}

/**
 * Where each room of a building would stand if room `roomKey` took room
 * `ontoKey`'s place in its building's order (tiles, absolute): a reordered
 * building is stacked afresh (townLayout.ts), so this is where a room move
 * lands. Null when either room is not in that building.
 */
export function townRoomMovePreview(
  layout: TownLayout,
  roomKey: string,
  ontoKey: string,
): Map<string, { x: number; y: number; w: number; h: number }> | null {
  const building = layout.buildings.find((b) =>
    b.rooms.some((room) => room.key === roomKey),
  );
  const order = building?.rooms.map((room) => room.key) ?? [];
  const from = order.indexOf(roomKey);
  const slot = order.indexOf(ontoKey);
  if (!building || from < 0 || slot < 0 || from === slot) return null;
  order.splice(from, 1);
  order.splice(slot, 0, roomKey);
  const byKey = new Map(building.rooms.map((room) => [room.key, room]));
  const rooms = order.map((key) => byKey.get(key)!);
  // A building's rooms start where its first room stands.
  const top = Math.min(...building.rooms.map((room) => room.y)) - building.y;
  const { positions } = townStackRooms(
    rooms,
    layout.shape.roomColumns,
    () => undefined,
    top,
  );
  return new Map(
    rooms.map((room, index) => [
      room.key,
      {
        x: building.x + positions[index]!.rx,
        y: building.y + positions[index]!.ry,
        w: room.w,
        h: room.h,
      },
    ]),
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
