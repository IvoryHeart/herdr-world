/**
 * Where a desk joining a team sits (townTeamActions.ts). Joining moves no
 * other desk: the dropped desk takes a free cell touching the desk it was
 * dropped on, on the side it came from where possible, and every other desk
 * of the rooms it leaves and joins keeps the cell it is drawn in.
 *
 * Desk slots otherwise follow Herdr's tab order (townLayout.ts), so these
 * cells are held in the page, like the placement memory: in the town's shape,
 * until the room's tab order changes (a reorder in Town, Spaces or Herdr lays
 * the room out by tab order again) or the page reloads.
 */

import type { TownInput, TownLayout, TownPinnedCells } from "./townLayout";

type Cell = { col: number; row: number };

export type TownJoinRequest = {
  /** The joining desk, by its key in the team's room (a moved tab's new key). */
  deskKey: string;
  /** The desk it was dropped on. */
  targetKey: string;
  /** The desk's key and room before it joined: the side it came from. */
  fromDeskKey: string;
  fromRoomKey: string;
};

/** A request that has not shown up in the team's room by then is dropped. */
export const TOWN_JOIN_WAIT_MS = 30_000;

/** Right, below, left, above: the order without a side to prefer. */
const SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * The cells to hold for one join, by room key, from the layout drawn now:
 * every desk where it is, and the joining desk beside its teammate. The
 * joining desk keeps its cell when it already touches its teammate, and when
 * no cell beside it is free (then a moved desk takes the room's next free one).
 */
export function townJoinCells(
  shown: TownLayout,
  request: TownJoinRequest,
  deskColumns: number,
): Map<string, Map<string, Cell>> | null {
  const rooms = shown.buildings.flatMap((building) => building.rooms);
  const room = rooms.find((entry) =>
    entry.cells.some((cell) => cell.deskKey === request.targetKey),
  );
  if (!room) return null;
  const at = new Map<string, Cell>();
  for (const cell of room.cells)
    if (cell.deskKey) at.set(cell.deskKey, { col: cell.col, row: cell.row });
  const target = at.get(request.targetKey)!;
  const own = at.get(request.fromDeskKey) ?? at.get(request.deskKey);
  at.delete(request.fromDeskKey);
  at.delete(request.deskKey);
  const held = new Map([[room.key, at]]);
  // The room it left keeps its other desks where they are, too.
  const left = rooms.find(
    (entry) => entry.key === request.fromRoomKey && entry.key !== room.key,
  );
  if (left) {
    const stay = new Map<string, Cell>();
    for (const cell of left.cells)
      if (cell.deskKey && cell.deskKey !== request.fromDeskKey)
        stay.set(cell.deskKey, { col: cell.col, row: cell.row });
    held.set(left.key, stay);
  }
  if (
    own &&
    Math.abs(own.col - target.col) + Math.abs(own.row - target.row) === 1
  ) {
    at.set(request.deskKey, own);
    return held;
  }
  // The side it came from: its own cell in this room, else its old room.
  let toward = { x: 0, y: 0 };
  if (own) toward = { x: own.col - target.col, y: own.row - target.row };
  else if (left) {
    const tcell = room.cells.find(
      (cell) => cell.deskKey === request.targetKey,
    )!;
    toward = {
      x: left.x + left.w / 2 - (tcell.x + 2.5),
      y: left.y + left.h / 2 - (tcell.y + 2.5),
    };
  }
  const taken = new Set(
    [...at.values()].map(({ col, row }) => `${col},${row}`),
  );
  for (const cell of room.foldActionCells ?? [])
    taken.add(`${cell.col},${cell.row}`);
  const free = SIDES.map(([dx, dy]) => ({
    col: target.col + dx,
    row: target.row + dy,
    score: dx * toward.x + dy * toward.y,
  }))
    .filter(
      ({ col, row }) =>
        col >= 0 &&
        row >= 0 &&
        col < deskColumns &&
        !taken.has(`${col},${row}`),
    )
    // Stable: equal scores keep the default order.
    .sort((a, b) => b.score - a.score);
  const seat = free[0] ?? own;
  if (seat) at.set(request.deskKey, { col: seat.col, row: seat.row });
  return held;
}

type Held = { shape: string; order: string[]; cells: Map<string, Cell> };

/** Join requests and the cells they hold, kept while the page is open. */
export class TownJoinSeats {
  private pending: { request: TownJoinRequest; at: number }[] = [];
  private readonly held = new Map<string, Held>();
  private cells: TownPinnedCells = new Map();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Seat a desk that just joined a team once Town shows it in the team's room. */
  request(request: TownJoinRequest) {
    this.pending = [
      ...this.pending.filter(
        (entry) => entry.request.deskKey !== request.deskKey,
      ),
      { request, at: this.now() },
    ];
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Changes when a request arrives, so the scene derives again. */
  getVersion = () => this.version;

  /**
   * The cells to keep fixed in this layout pass: seat any join `input` now
   * shows, from the layout `shown` (what the user sees, in this shape), and
   * release rooms whose tab order changed. The same cells keep the same map.
   */
  heldCells(
    input: TownInput,
    shown: TownLayout | null,
    shape: string,
    deskColumns: number,
  ): TownPinnedCells {
    const rooms = new Map(input.rooms.map((room) => [room.key, room.deskKeys]));
    const roomOf = new Map<string, string>();
    for (const room of input.rooms)
      for (const key of room.deskKeys) roomOf.set(key, room.key);
    const now = this.now();
    this.pending = this.pending.filter(({ request, at }) => {
      const room = roomOf.get(request.targetKey);
      if (!room || now - at > TOWN_JOIN_WAIT_MS) return false;
      if (roomOf.get(request.deskKey) !== room) return true;
      if (!shown) return false;
      const cells = townJoinCells(shown, request, deskColumns);
      for (const [roomKey, held] of cells ?? [])
        this.held.set(roomKey, {
          shape,
          order: rooms.get(roomKey) ? [...rooms.get(roomKey)!] : [],
          cells: held,
        });
      return false;
    });
    const next = new Map<string, Cell>();
    for (const [roomKey, held] of this.held) {
      const keys = rooms.get(roomKey);
      const kept = keys?.filter((key) => held.cells.has(key)) ?? [];
      const present = new Set(kept);
      const was = held.order.filter((key) => present.has(key));
      if (
        !keys ||
        held.shape !== shape ||
        kept.some((key, index) => key !== was[index])
      ) {
        this.held.delete(roomKey);
        continue;
      }
      for (const key of kept) next.set(key, held.cells.get(key)!);
    }
    const last = this.cells;
    if (
      next.size !== last.size ||
      [...next].some(([key, cell]) => {
        const was = last.get(key);
        return was?.col !== cell.col || was?.row !== cell.row;
      })
    )
      this.cells = next;
    return this.cells;
  }
}

let shared: TownJoinSeats | null = null;

/** The page's join seats: Town's team actions and its canvas share them. */
export function sharedTownJoinSeats() {
  shared ??= new TownJoinSeats();
  return shared;
}
