import { expect, test } from "bun:test";
import {
  layoutTown,
  TOWN_DEFAULT_RENDERED_DESKS,
  TOWN_ROOM_TIERS,
  townDeskSlots,
  townGeometryKey,
  townPinCell,
  townSeat,
  townRoomTiers,
  TOWN_SHAPES,
  townShapeFor,
  townTierFor,
  TownGround,
  type TownInput,
  type TownLayout,
} from "./townLayout";
import {
  TOWN_ADD_ROOM_SLOT,
  townRoomNeighbor,
  townRoomPlacement,
  townRoomsMoved,
  townRoomSpotAt,
  townRoomSwap,
} from "./townRoomPlace";

/** Tiles per desk cell, as townLayout draws them. */
const CELL_TILES = 5;
/** Lobby rows above the rooms, as townLayout draws them. */
const LOBBY_ROWS = 7;
/** A street's band: pavement, three lanes, pavement. */
const ROAD_BAND = 5;

const desks = (room: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${room}/tab-${index}`);

function town(hosts: Record<string, number[]>): TownInput {
  return {
    hosts: Object.keys(hosts).map((key, displayOrder) => ({
      key,
      displayOrder,
    })),
    rooms: Object.entries(hosts).flatMap(([hostKey, counts]) =>
      counts.map((count, order) => ({
        key: `${hostKey}/room-${order}`,
        hostKey,
        order,
        deskKeys: desks(`${hostKey}/room-${order}`, count),
      })),
    ),
  };
}

function cellOf(layout: TownLayout, deskKey: string) {
  for (const building of layout.buildings)
    for (const room of building.rooms)
      for (const cell of room.cells) if (cell.deskKey === deskKey) return cell;
  return null;
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("each capacity step contains the previous one", () => {
  for (let i = 1; i < TOWN_ROOM_TIERS.length; i += 1) {
    const [cols, rows] = TOWN_ROOM_TIERS[i]!;
    const [prevCols, prevRows] = TOWN_ROOM_TIERS[i - 1]!;
    expect(cols).toBeGreaterThanOrEqual(prevCols);
    expect(rows).toBeGreaterThanOrEqual(prevRows);
    expect(cols * rows).toBeGreaterThan(prevCols * prevRows);
  }
});

test("rooms always keep a free desk spot up to the rendered bound", () => {
  for (let count = 0; count <= TOWN_DEFAULT_RENDERED_DESKS; count += 1) {
    const [cols, rows] = TOWN_ROOM_TIERS[townTierFor(count)]!;
    expect(cols * rows).toBeGreaterThan(count);
  }
});

test("every host becomes one building with exactly its rooms and desks", () => {
  const { layout } = layoutTown(
    town({ a: [3, 15, 1], b: [7], c: [0, 2] }),
    "wide",
  );
  expect(layout.buildings.map((b) => b.hostKey)).toEqual(["a", "b", "c"]);
  for (const building of layout.buildings)
    for (const room of building.rooms) {
      expect(room.hostKey).toBe(building.hostKey);
      expect(room.key.startsWith(`${building.hostKey}/`)).toBe(true);
    }
  const placed = layout.buildings.flatMap((b) =>
    b.rooms.flatMap((r) =>
      r.cells.flatMap((c) => (c.deskKey ? [c.deskKey] : [])),
    ),
  );
  expect(placed.length).toBe(3 + 15 + 1 + 7 + 0 + 2);
  expect(new Set(placed).size).toBe(placed.length);
  expect(layout.deskCells.size).toBe(placed.length);
});

test("rooms and buildings never overlap and stay inside their building", () => {
  for (const formFactor of ["wide", "narrow"] as const) {
    const { layout } = layoutTown(
      town({ a: [15, 15, 15, 15, 15, 15, 15, 15], b: [4, 9], c: [1] }),
      formFactor,
    );
    layout.buildings.forEach((building, index) => {
      for (const other of layout.buildings.slice(index + 1))
        expect(overlaps(building, other)).toBe(false);
      building.rooms.forEach((room, roomIndex) => {
        expect(room.x).toBeGreaterThanOrEqual(building.x + 1);
        expect(room.x + room.w).toBeLessThanOrEqual(
          building.x + building.w - 1,
        );
        // Reception above the rooms; the bar in a bottom corner, clear of them.
        expect(room.y).toBeGreaterThanOrEqual(building.lobbyY + LOBBY_ROWS);
        expect(room.y + room.h).toBeLessThanOrEqual(building.y + building.h);
        for (const other of building.rooms.slice(roomIndex + 1))
          expect(overlaps(room, other)).toBe(false);
        expect(overlaps(room, building.lounge)).toBe(false);
      });
    });
    expect(layout.width * layout.height).toBe(layout.ground.length);
  }
});

test("wide towns place buildings in one row and narrow towns stack them", () => {
  const input = town({ a: [3], b: [3], c: [3] });
  const wide = layoutTown(input, "wide").layout;
  const narrow = layoutTown(input, "narrow").layout;
  expect(new Set(wide.buildings.map((b) => b.y + b.h)).size).toBe(1);
  expect(new Set(narrow.buildings.map((b) => b.x)).size).toBe(1);
  const ys = narrow.buildings.map((b) => b.y);
  expect([...ys].sort((p, q) => p - q)).toEqual(ys);
});

test("a new tab takes the first free spot and nothing else moves", () => {
  const first = layoutTown(town({ a: [5, 3] }), "wide");
  const before = new Map(
    desks("a/room-0", 5).map((key) => [key, cellOf(first.layout, key)]),
  );
  const grown = town({ a: [6, 3] });
  const second = layoutTown(grown, "wide", first.memory);
  for (const [key, cell] of before) {
    const after = cellOf(second.layout, key)!;
    expect([after.col, after.row]).toEqual([cell!.col, cell!.row]);
  }
  expect(cellOf(second.layout, "a/room-0/tab-5")).not.toBeNull();
});

test("a closed tab leaves no gap: later desks close up in order", () => {
  const first = layoutTown(town({ a: [5] }), "wide");
  const input = town({ a: [5] });
  const keys = [...input.rooms[0]!.deskKeys];
  const removed = keys.splice(2, 1)[0]!;
  const freed = cellOf(first.layout, removed)!;
  const second = layoutTown(
    { ...input, rooms: [{ ...input.rooms[0]!, deskKeys: keys }] },
    "wide",
    first.memory,
  );
  // Desks before the closed one keep their spots.
  for (const key of keys.slice(0, 2)) {
    const was = cellOf(first.layout, key)!;
    const now = cellOf(second.layout, key)!;
    expect([now.col, now.row]).toEqual([was.col, was.row]);
  }
  // The next desk takes the freed spot, and the rest follow in order.
  const next = cellOf(second.layout, keys[2]!)!;
  expect([next.col, next.row]).toEqual([freed.col, freed.row]);
  const room = second.layout.buildings[0]!.rooms[0]!;
  const occupied = room.cells.filter((cell) => cell.deskKey);
  expect(occupied.map((cell) => cell.deskKey)).toEqual(keys);
  expect(room.cells.indexOf(occupied[occupied.length - 1]!)).toBe(
    keys.length - 1,
  );
});

test("desk slots follow Herdr's tab order, so a reorder moves desks", () => {
  const first = layoutTown(town({ a: [6] }), "wide");
  const input = town({ a: [6] });
  const keys = [...input.rooms[0]!.deskKeys];
  // Herdr moved the last tab to the front.
  const reordered = [keys[5]!, ...keys.slice(0, 5)];
  const second = layoutTown(
    { ...input, rooms: [{ ...input.rooms[0]!, deskKeys: reordered }] },
    "wide",
    first.memory,
  );
  const room = second.layout.buildings[0]!.rooms[0]!;
  expect(
    room.cells.filter((cell) => cell.deskKey).map((cell) => cell.deskKey),
  ).toEqual(reordered);
  const was = cellOf(first.layout, keys[0]!)!;
  const now = cellOf(second.layout, keys[5]!)!;
  expect([now.col, now.row]).toEqual([was.col, was.row]);
});

test("at every capacity step, slot i is the i-th desk in reading order", () => {
  let result = layoutTown(town({ a: [1] }), "wide");
  for (let count = 2; count <= TOWN_DEFAULT_RENDERED_DESKS; count += 1) {
    result = layoutTown(town({ a: [count] }), "wide", result.memory);
    const room = result.layout.buildings[0]!.rooms[0]!;
    desks("a/room-0", count).forEach((key, index) => {
      const cell = cellOf(result.layout, key)!;
      expect([cell.col, cell.row]).toEqual([
        index % room.cols,
        Math.floor(index / room.cols),
      ]);
    });
  }
});

test("a live room shrinks to fit remaining desks, and a rebuild re-derives from native order", () => {
  const big = layoutTown(town({ a: [10] }), "wide");
  const liveResult = layoutTown(town({ a: [2] }), "wide", big.memory);
  const live = liveResult.layout;
  expect(live.buildings[0]!.rooms[0]!.h).toBeLessThan(
    big.layout.buildings[0]!.rooms[0]!.h,
  );
  expect([
    live.buildings[0]!.rooms[0]!.cols,
    live.buildings[0]!.rooms[0]!.rows,
  ]).toEqual([...TOWN_ROOM_TIERS[townTierFor(2)]!]);
  const rebuilt = layoutTown(town({ a: [2] }), "wide").layout;
  const room = rebuilt.buildings[0]!.rooms[0]!;
  expect([room.cols, room.rows]).toEqual([...TOWN_ROOM_TIERS[townTierFor(2)]!]);
  expect(room.cells.slice(0, 2).map((c) => c.deskKey)).toEqual(
    desks("a/room-0", 2),
  );
});

test("an expanded room shrinks after closures and stays expanded", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const expanded = town({ a: [130] });
    Object.assign(expanded.rooms[0]!, { deskFold: "expanded" });
    const first = layoutTown(expanded, shape);
    const closedInput = town({ a: [2] });
    Object.assign(closedInput.rooms[0]!, { deskFold: "expanded" });
    const closed = layoutTown(closedInput, shape, first.memory);
    const expandedRoom = first.layout.buildings[0]!.rooms[0]!;
    const closedRoom = closed.layout.buildings[0]!.rooms[0]!;
    expect(closedRoom.h).toBeLessThan(expandedRoom.h);
    expect(closedRoom.cells.filter((cell) => cell.deskKey)).toHaveLength(2);
    expect(closedRoom.foldActionCells).toBeDefined();

    const foldedInput = town({ a: [2] });
    Object.assign(foldedInput.rooms[0]!, { deskFold: "folded" });
    const folded = layoutTown(foldedInput, shape, closed.memory);
    expect([closedRoom.cols, closedRoom.rows]).toEqual([
      folded.layout.buildings[0]!.rooms[0]!.cols,
      folded.layout.buildings[0]!.rooms[0]!.rows,
    ]);
    expect(folded.layout.buildings[0]!.rooms[0]!.h).toBe(closedRoom.h);
    expect(folded.layout.deskCells.size).toBe(2);
  }
});

test("foldable rooms reserve adjacent bottom-right action tiles", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const input = town({ a: [26] });
    input.rooms[0]!.deskFold = "folded";
    const result = layoutTown(input, shape).layout;
    const room = result.buildings[0]!.rooms[0]!;
    const [seat, fold] = room.foldActionCells!;
    expect(seat.deskKey).toBeNull();
    expect(fold.deskKey).toBeNull();
    expect(seat.row).toBe(fold.row);
    expect(fold.col).toBe(seat.col + 1);
    expect(fold.row).toBe(room.rows - 1);
    expect(fold.col).toBe(room.cols - 1);
    expect(result.deskCells.size).toBe(26);
  }
});

test("saved pins cannot occupy either reserved fold action cell", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    for (const actionIndex of [0, 1]) {
      const input = town({ a: [26] });
      input.rooms[0]!.deskFold = "folded";
      const initial = layoutTown(input, shape).layout;
      const initialRoom = initial.buildings[0]!.rooms[0]!;
      const reserved = initialRoom.foldActionCells![actionIndex]!;
      const pinnedKey = input.rooms[0]!.deskKeys[0]!;
      const result = layoutTown(
        input,
        shape,
        new Map(),
        new Map([[pinnedKey, { col: reserved.col, row: reserved.row }]]),
      ).layout;
      const room = result.buildings[0]!.rooms[0]!;
      const [seat, fold] = room.foldActionCells!;
      expect([seat.deskKey, fold.deskKey]).toEqual([null, null]);
      expect(cellOf(result, pinnedKey)).toMatchObject({
        col: reserved.col,
        row: reserved.row,
      });
      expect(result.deskCells.size).toBe(26);
    }
  }
});

test("Fold preserves a protected pin's cell beyond the expanded target", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const expanded = town({ a: [260] });
    expanded.rooms[0]!.deskFold = "expanded";
    const first = layoutTown(expanded, shape);
    const pinnedKey = expanded.rooms[0]!.deskKeys[259]!;
    const cell = cellOf(first.layout, pinnedKey)!;
    const folded = town({ a: [24] });
    folded.rooms[0]!.deskFold = "folded";
    folded.rooms[0]!.deskKeys = [
      ...folded.rooms[0]!.deskKeys.slice(0, 23),
      pinnedKey,
    ];
    const next = layoutTown(
      folded,
      shape,
      first.memory,
      new Map([[pinnedKey, { col: cell.col, row: cell.row }]]),
    );
    const kept = cellOf(next.layout, pinnedKey)!;
    expect([kept.col, kept.row]).toEqual([cell.col, cell.row]);
    expect(next.layout.deskCells.size).toBe(24);
    expect(
      next.layout.buildings[0]!.rooms[0]!.cells.some(
        (candidate) => candidate.deskKey === null,
      ),
    ).toBe(true);
  }
});

test("every admitted desk beyond the normal target keeps a visible cell", () => {
  const { layout } = layoutTown(
    town({ a: [TOWN_DEFAULT_RENDERED_DESKS + 4] }),
    "wide",
  );
  const room = layout.buildings[0]!.rooms[0]!;
  expect(room.cells.filter((c) => c.deskKey).length).toBe(
    TOWN_DEFAULT_RENDERED_DESKS + 4,
  );
  expect(room.cells.some((c) => !c.deskKey)).toBe(true);
  expect(room.overflowDeskKeys).toEqual([]);
});

test("rooms extend to show every desk of real rooms, wide and narrow", () => {
  for (const formFactor of ["wide", "narrow"] as const)
    for (const count of [24, 50, 100, TOWN_DEFAULT_RENDERED_DESKS, 130, 260]) {
      const { layout } = layoutTown(town({ a: [count, 6, 3] }), formFactor);
      const building = layout.buildings[0]!;
      const room = building.rooms[0]!;
      expect(room.overflowDeskKeys).toEqual([]);
      // Every desk has a cell, in tab order, with a free spot left over.
      expect(room.cells.filter((c) => c.deskKey).map((c) => c.deskKey)).toEqual(
        desks("a/room-0", count),
      );
      expect(room.cells.some((c) => !c.deskKey)).toBe(true);
      // The building grows around its rooms, which never overlap, and the
      // town around its buildings.
      for (const placed of building.rooms) {
        expect(placed.x).toBeGreaterThanOrEqual(building.x);
        expect(placed.y).toBeGreaterThanOrEqual(building.y);
        expect(placed.x + placed.w).toBeLessThanOrEqual(
          building.x + building.w,
        );
        expect(placed.y).toBeGreaterThanOrEqual(building.lobbyY + LOBBY_ROWS);
        expect(overlaps(placed, building.lounge)).toBe(false);
        for (const cell of placed.cells) {
          expect(cell.x + CELL_TILES).toBeLessThanOrEqual(placed.x + placed.w);
          expect(cell.y + CELL_TILES).toBeLessThanOrEqual(placed.y + placed.h);
        }
        for (const other of building.rooms)
          if (other !== placed) expect(overlaps(placed, other)).toBe(false);
      }
      expect(layout.width).toBeGreaterThanOrEqual(building.x + building.w);
      expect(layout.height).toBeGreaterThanOrEqual(building.y + building.h);
    }
});

test("a room grows square to eight desks wide, then extends downward", () => {
  expect(TOWN_ROOM_TIERS[townTierFor(19)]).toEqual([5, 4]);
  expect(TOWN_ROOM_TIERS[townTierFor(24)]).toEqual([5, 5]);
  expect(TOWN_ROOM_TIERS[townTierFor(50)]).toEqual([8, 7]);
  expect(TOWN_ROOM_TIERS[townTierFor(100)]).toEqual([8, 13]);
  expect(TOWN_ROOM_TIERS[townTierFor(TOWN_DEFAULT_RENDERED_DESKS)]).toEqual([
    8, 16,
  ]);
});

test("reception queue and lounge spots sit on walkable building floor", () => {
  const { layout } = layoutTown(town({ a: [4, 4, 4, 4] }), "wide");
  const building = layout.buildings[0]!;
  for (const spot of [...building.queue, ...building.lounge.spots]) {
    expect(spot.x).toBeGreaterThan(building.x);
    expect(spot.x).toBeLessThan(building.x + building.w - 1);
    expect(spot.y).toBeGreaterThan(building.y + 1);
    expect(spot.y).toBeLessThan(building.y + building.h);
    expect(layout.ground[spot.y * layout.width + spot.x]).toBe(
      TownGround.building,
    );
  }
});

test("seat entries lie in an aisle beside the table", () => {
  const { layout } = layoutTown(town({ a: [6] }), "wide");
  const cell = layout.buildings[0]!.rooms[0]!.cells[0]!;
  for (let seat = 0; seat < 4; seat += 1) {
    const { entry } = townSeat(cell, seat);
    expect(entry.x === cell.x || entry.x === cell.x + 5).toBe(true);
  }
});

test("layout is deterministic for the same input", () => {
  const input = town({ a: [3, 9], b: [1, 1, 1, 1] });
  const one = layoutTown(input, "wide").layout;
  const two = layoutTown(input, "wide").layout;
  expect(one.trees).toEqual(two.trees);
  expect(Buffer.from(one.ground)).toEqual(Buffer.from(two.ground));
});

test("a desk's furniture follows its panes", () => {
  const { layout } = layoutTown(
    {
      hosts: [{ key: "host", displayOrder: 0 }],
      rooms: [
        {
          key: "room",
          hostKey: "host",
          order: 0,
          deskKeys: ["solo", "pair", "trio", "team"],
          deskSeats: [1, 2, 3, 4],
        },
      ],
    },
    "wide",
  );
  const cells = new Map(
    layout.buildings[0]!.rooms[0]!.cells.flatMap((cell) =>
      cell.deskKey ? [[cell.deskKey, cell] as const] : [],
    ),
  );
  expect([...cells.values()].map((cell) => cell.seats)).toEqual([1, 2, 3, 4]);
  const solo = townSeat(cells.get("solo")!, 0);
  const pair = [0, 1].map((seat) => townSeat(cells.get("pair")!, seat));
  // A solo desk and a face-to-face pair sit at the table's middle.
  expect(solo.cx - solo.tableX).toBe(32);
  expect(pair.map((seat) => [seat.cx - seat.tableX, seat.top])).toEqual([
    [32, true],
    [32, false],
  ]);
  expect(townDeskSlots(3).length).toBe(4);
});

test("a pinned desk keeps its cell through reflow and reorder; others fill around it", () => {
  const keys = desks("a/room-0", 3);
  // 3 desks: a 2×2 room; pin tab-2 at column 1, row 1 (its cell there).
  const pins = new Map([[keys[2]!, { col: 1, row: 1 }]]);
  const first = layoutTown(town({ a: [3] }), "wide", new Map(), pins);
  expect(cellOf(first.layout, keys[2]!)).toMatchObject({ col: 1, row: 1 });
  // The room reflows to 3 columns, and Herdr moves tab-2 to the front: the
  // pinned desk stays; the others take the free cells in tab order.
  const input = town({ a: [6] });
  const order = [
    keys[2]!,
    ...input.rooms[0]!.deskKeys.filter((k) => k !== keys[2]),
  ];
  const second = layoutTown(
    { ...input, rooms: [{ ...input.rooms[0]!, deskKeys: order }] },
    "wide",
    first.memory,
    pins,
  );
  const room = second.layout.buildings[0]!.rooms[0]!;
  expect(room.cols).toBe(3);
  expect(cellOf(second.layout, keys[2]!)).toMatchObject({ col: 1, row: 1 });
  const others = room.cells
    .filter((cell) => cell.deskKey && cell.deskKey !== keys[2])
    .map((cell) => cell.deskKey);
  expect(others).toEqual(order.slice(1));
  // Unpinned, it follows tab order again.
  const unpinned = layoutTown(
    { ...input, rooms: [{ ...input.rooms[0]!, deskKeys: order }] },
    "wide",
    second.memory,
  );
  expect(cellOf(unpinned.layout, keys[2]!)).toMatchObject({ col: 0, row: 0 });
});

test("a room grows to hold a pinned desk's cell, and a new pin keeps the cell it has", () => {
  const keys = desks("a/room-0", 2);
  const far = layoutTown(
    town({ a: [2] }),
    "wide",
    new Map(),
    new Map([[keys[0]!, { col: 3, row: 2 }]]),
  );
  const room = far.layout.buildings[0]!.rooms[0]!;
  expect(room.cols).toBeGreaterThan(3);
  expect(room.rows).toBeGreaterThan(2);
  expect(cellOf(far.layout, keys[0]!)).toMatchObject({ col: 3, row: 2 });
  // Just pinned (no saved cell): it keeps this scene's cell.
  const live = layoutTown(town({ a: [5] }), "wide");
  const at = cellOf(live.layout, "a/room-0/tab-4")!;
  const input = town({ a: [5] });
  const reordered = [...input.rooms[0]!.deskKeys].reverse();
  const next = layoutTown(
    { ...input, rooms: [{ ...input.rooms[0]!, deskKeys: reordered }] },
    "wide",
    live.memory,
    new Map([["a/room-0/tab-4", null]]),
  );
  expect(cellOf(next.layout, "a/room-0/tab-4")).toMatchObject({
    col: at.col,
    row: at.row,
  });
});

test("the container's size picks the shape, not one breakpoint", () => {
  expect(townShapeFor(390, 844)).toBe(TOWN_SHAPES.phone);
  expect(townShapeFor(1080, 1920)).toBe(TOWN_SHAPES.portrait);
  expect(townShapeFor(960, 1080)).toBe(TOWN_SHAPES.portrait);
  expect(townShapeFor(1100, 800)).toBe(TOWN_SHAPES.medium);
  expect(townShapeFor(1440, 900)).toBe(TOWN_SHAPES.wide);
  for (const shape of Object.values(TOWN_SHAPES)) {
    const tiers = townRoomTiers(shape.deskColumns);
    const [cols, rows] = tiers[tiers.length - 1]!;
    expect(cols).toBe(shape.deskColumns);
    expect(cols * rows).toBeGreaterThan(TOWN_DEFAULT_RENDERED_DESKS);
  }
});

/** The columns of a building's rooms, by their left edge, in room order. */
const columnsOf = (layout: TownLayout) => {
  const columns = new Map<number, string[]>();
  for (const room of layout.buildings[0]!.rooms)
    columns.set(room.x, [...(columns.get(room.x) ?? []), room.key]);
  return [...columns.values()];
};

test("a phone stacks rooms in one column and grows big rooms downward", () => {
  const { layout } = layoutTown(
    town({ a: [100, 50, 24], b: [3] }),
    TOWN_SHAPES.phone,
  );
  expect(layout.formFactor).toBe("narrow");
  expect(columnsOf(layout)).toHaveLength(1);
  const rooms = layout.buildings[0]!.rooms;
  for (const room of rooms) expect(room.cols).toBeLessThanOrEqual(4);
  for (let i = 1; i < rooms.length; i += 1)
    expect(rooms[i]!.y).toBeGreaterThan(rooms[i - 1]!.y + rooms[i - 1]!.h);
  // Buildings stack too.
  expect(layout.buildings[1]!.y).toBeGreaterThan(
    layout.buildings[0]!.y + layout.buildings[0]!.h,
  );
});

test("wide, medium and portrait shapes lay rooms out in columns", () => {
  const input = town({ a: [24, 6, 6, 3, 3, 3], b: [4] });
  const columns = (shape: (typeof TOWN_SHAPES)[keyof typeof TOWN_SHAPES]) =>
    columnsOf(layoutTown(input, shape).layout).length;
  expect(columns(TOWN_SHAPES.wide)).toBe(3);
  expect(columns(TOWN_SHAPES.medium)).toBe(2);
  expect(columns(TOWN_SHAPES.portrait)).toBe(2);
  expect(layoutTown(input, TOWN_SHAPES.portrait).layout.formFactor).toBe(
    "narrow",
  );
  const wide = layoutTown(input, TOWN_SHAPES.wide).layout;
  // Side by side on one street.
  expect(wide.buildings[1]!.y).toBe(
    wide.buildings[0]!.y + wide.buildings[0]!.h - wide.buildings[1]!.h,
  );
});

test("a room that grows moves only the rooms below it in its column", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const before = layoutTown(town({ a: [3, 3, 3, 3, 3, 3] }), shape);
    // The first room grows by many desks; it gains rows (and maybe columns).
    const after = layoutTown(
      town({ a: [60, 3, 3, 3, 3, 3] }),
      shape,
      before.memory,
    );
    const at = (layout: TownLayout) =>
      new Map(layout.buildings[0]!.rooms.map((room) => [room.key, room]));
    const was = at(before.layout);
    const now = at(after.layout);
    const grown = now.get("a/room-0")!;
    expect(grown.rows).toBeGreaterThan(was.get("a/room-0")!.rows);
    for (const [key, room] of now) {
      if (key === "a/room-0") continue;
      const old = was.get(key)!;
      const sameColumn = old.x === was.get("a/room-0")!.x;
      // Every room keeps its column; only rooms under the grown one move down.
      if (sameColumn)
        expect(room.y - old.y).toBe(grown.h - was.get("a/room-0")!.h);
      else expect(room.y).toBe(old.y);
    }
  }
});

test("reception, queue and bar stay on walkable floor in every shape", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const { layout } = layoutTown(town({ a: [100, 24, 4, 4] }), shape);
    const building = layout.buildings[0]!;
    const highest = Math.min(...building.rooms.map((room) => room.y));
    const lowest = Math.max(...building.rooms.map((room) => room.y + room.h));
    // Reception is at the top of the building and the bar at the bottom.
    expect(building.lobbyY).toBe(building.y + 2);
    expect(building.counter.y).toBeGreaterThan(building.lobbyY);
    for (const spot of building.queue) {
      expect(spot.y).toBeGreaterThan(building.counter.y);
      expect(spot.y).toBeLessThan(highest);
    }
    // The bar sits in a bottom corner, never across the whole bottom.
    expect(building.lounge.y + building.lounge.h).toBe(
      building.y + building.h - 1,
    );
    expect(building.lounge.w).toBeLessThan(building.w - 4);
    expect(lowest).toBeLessThanOrEqual(building.y + building.h);
    // The bar keeps at least the old lounge's twelve spots, all distinct.
    const spots = building.lounge.spots;
    expect(spots.length).toBeGreaterThanOrEqual(12);
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(spots.length);
    for (const spot of spots) {
      expect(spot.y).toBeGreaterThanOrEqual(building.lounge.y);
      expect(spot.y).toBeLessThan(building.lounge.y + building.lounge.h);
      expect(spot.x).toBeGreaterThanOrEqual(building.lounge.x);
      expect(spot.x).toBeLessThan(building.lounge.x + building.lounge.w);
      // No one stands on the bar counter.
      expect(
        spot.y === building.lounge.bar.y &&
          spot.x >= building.lounge.bar.x &&
          spot.x < building.lounge.bar.x + building.lounge.bar.w,
      ).toBe(false);
    }
    for (const spot of [...building.queue, ...building.lounge.spots]) {
      expect(layout.ground[spot.y * layout.width + spot.x]).toBe(
        TownGround.building,
      );
      for (const room of building.rooms)
        expect(
          spot.x >= room.x &&
            spot.x < room.x + room.w &&
            spot.y >= room.y &&
            spot.y < room.y + room.h,
        ).toBe(false);
    }
  }
});

test("a desk pinned during a held reflow keeps the cell the user sees", () => {
  const keys = desks("a/room-0", 3);
  // The visible (held) layout has tab-2 in tab order; the pending one has
  // moved it to column 1, row 1.
  const visible = layoutTown(town({ a: [3] }), "wide").layout;
  const pending = layoutTown(
    town({ a: [3] }),
    "wide",
    new Map(),
    new Map([[keys[2]!, { col: 1, row: 1 }]]),
  ).layout;
  const seen = cellOf(visible, keys[2]!)!;
  expect(cellOf(pending, keys[2]!)).toMatchObject({ col: 1, row: 1 });
  expect(seen.col === 1 && seen.row === 1).toBe(false);
  expect(townPinCell(visible, pending, keys[2]!)).toEqual({
    col: seen.col,
    row: seen.row,
  });
  // A desk the visible layout lacks takes its pending cell.
  const before = layoutTown(town({ a: [2] }), "wide").layout;
  expect(townPinCell(before, pending, keys[2]!)).toEqual({ col: 1, row: 1 });
  expect(townPinCell(before, before, keys[2]!)).toBeNull();
});

type Lot = { x: number; y: number; w: number; h: number };

/** Which sides of a lot touch a road: the street above or below, a side road. */
function roadSides(layout: TownLayout, lot: Lot, facade: number) {
  const bottom = lot.y + lot.h + facade;
  const above = layout.roads.some(
    (road) => road + ROAD_BAND <= lot.y && lot.y - (road + ROAD_BAND) <= 12,
  );
  const below = layout.roads.some(
    (road) => road >= bottom && road - bottom <= 4,
  );
  const spans = (v: TownLayout["verticalRoads"][number]) =>
    v.y0 <= lot.y && v.y1 >= bottom;
  const left = layout.verticalRoads.some(
    (v) => spans(v) && v.x + ROAD_BAND === lot.x,
  );
  const right = layout.verticalRoads.some(
    (v) => spans(v) && v.x === lot.x + lot.w,
  );
  return [above, below, left, right].filter(Boolean).length;
}

const HOST_SETS: Record<string, number[]>[] = [
  { a: [3] },
  { a: [3], b: [2] },
  { a: [3], b: [2], c: [5] },
  { a: [3], b: [2], c: [5], d: [1] },
  { a: [3], b: [2], c: [5], d: [1], e: [4], f: [2] },
  // Mixed widths: stacked lots narrower than the widest keep their road.
  { a: [24], b: [24, 24] },
  { a: [24, 24, 24], b: [3], c: [24, 24] },
  // A first lot far shorter than its neighbour still meets the street above.
  { a: [24, 4], b: [35] },
];

test("every building has roads on at least three sides", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const hosts of HOST_SETS) {
      const { layout } = layoutTown(town(hosts), shape);
      for (const building of layout.buildings)
        expect(roadSides(layout, building, 2)).toBeGreaterThanOrEqual(3);
      // Streets and side roads are road ground.
      for (const road of layout.roads)
        expect(layout.ground[(road + 2) * layout.width + 1]).toBe(
          TownGround.road,
        );
    }
});

test("the town center stands at the top, just across the first street", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const hosts of [...HOST_SETS, {}]) {
      const { layout } = layoutTown(town(hosts), shape);
      const { center, buildings } = layout;
      const first = Math.min(...layout.roads);
      expect(center.x).toBeGreaterThanOrEqual(3);
      expect(center.x + center.w).toBeLessThanOrEqual(layout.width - 3);
      // Above the first street, its forecourt meeting the pavement with no
      // lawn between: no building, road or plaza column beside it.
      expect(center.street).toBe(first);
      expect(first - (center.y + center.h)).toBeLessThanOrEqual(3);
      for (const building of buildings)
        expect(building.y).toBeGreaterThan(first + ROAD_BAND);
      for (const road of layout.verticalRoads)
        expect(road.y0).toBeGreaterThan(first);
      // Centred over the first row of buildings (the town's, without any).
      const row = buildings.filter((b) => b.y < layout.roads[1]!);
      if (row.length) {
        const axis =
          (Math.min(...row.map((b) => b.x)) +
            Math.max(...row.map((b) => b.x + b.w))) /
          2;
        expect(Math.abs(center.x + center.w / 2 - axis)).toBeLessThanOrEqual(1);
      }
      // A phone's center fits its one-column building's view.
      if (shape.roomColumns === 1)
        for (const building of buildings)
          expect(center.w).toBeLessThanOrEqual(building.w);
      // Its forecourt is paved down to the street; no tree stands on it.
      const middle = center.x + Math.floor(center.w / 2);
      for (let y = center.y + center.h; y < center.street; y += 1)
        expect(layout.ground[y * layout.width + middle]).toBe(TownGround.plaza);
      expect(layout.ground[center.street * layout.width + middle]).toBe(
        TownGround.walk,
      );
      for (const tree of layout.trees)
        expect(
          tree.x >= center.x - 1 &&
            tree.x <= center.x + center.w &&
            tree.y >= center.y - 1 &&
            tree.y <= center.street,
        ).toBe(false);
    }
});

test("wide buildings stand side by side, one street apart, under the center", () => {
  const shape = TOWN_SHAPES.wide;
  let previous: TownLayout | null = null;
  for (const count of [1, 2, 3, 4, 6, 9]) {
    const hosts = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`h${i}`, [4, 2]]),
    );
    const { layout } = layoutTown(town(hosts), shape);
    const { center } = layout;
    // Neighbours in a row are separated only by their side road.
    const row = layout.buildings
      .filter((b) => b.y < layout.roads[1]!)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i += 1)
      expect(row[i]!.x - (row[i - 1]!.x + row[i - 1]!.w)).toBe(ROAD_BAND);
    // The center faces the first row across one street and its yard.
    expect(center.street).toBe(layout.roads[0]!);
    expect(Math.min(...row.map((b) => b.y))).toBe(
      layout.roads[0]! + ROAD_BAND + 2,
    );
    // It stays put at the top whatever the town's size.
    if (previous) expect(center.y).toBe(previous.center.y);
    previous = layout;
  }
});

test("the first street runs above the first row and on past the last crossing", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const { layout } = layoutTown(town({ a: [3], b: [2] }), shape);
    const top = Math.min(...layout.roads);
    expect(top).toBeLessThan(Math.min(...layout.buildings.map((b) => b.y)));
    // Crossings meet the topmost street from below; the bus stop needs four
    // walkable pavement tiles right of the last one, before the margin.
    const crossings = layout.verticalRoads.filter(
      (v) => v.y1 === top || v.y0 === top + ROAD_BAND,
    );
    expect(crossings.length).toBeGreaterThan(0);
    const last = Math.max(...crossings.map((v) => v.x));
    for (let x = last + ROAD_BAND; x < last + ROAD_BAND + 4; x += 1)
      expect(layout.ground[top * layout.width + x]).toBe(TownGround.walk);
    expect(last + ROAD_BAND + 4).toBeLessThanOrEqual(layout.width - 3);
    // The street is open to the town's right edge.
    expect(layout.ground[(top + 2) * layout.width + layout.width - 1]).toBe(
      TownGround.road,
    );
  }
});

test("front doors open onto the street above and bar doors onto the one below", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const { layout } = layoutTown(town({ a: [3], b: [2] }), shape);
    for (const building of layout.buildings) {
      for (let y = building.y - 1; ; y -= 1) {
        const type = layout.ground[y * layout.width + building.entryX];
        expect(type).toBe(TownGround.walk);
        if (layout.roads.some((road) => y === road + ROAD_BAND - 1)) break;
      }
      expect(
        layout.ground[(building.roadY - 1) * layout.width + building.barDoorX],
      ).toBe(TownGround.walk);
    }
  }
});

test("rooms clear of the bar reach the bottom; the bar stays under its own column", () => {
  // Two columns: the tall left one runs down beside the bar, which sits
  // under the short right one without making the building taller.
  const { layout } = layoutTown(town({ a: [24, 4] }), TOWN_SHAPES.wide);
  const building = layout.buildings[0]!;
  const [tall, short] = building.rooms;
  const bottom = building.y + building.h;
  expect(tall!.x + tall!.w).toBeLessThanOrEqual(building.lounge.x);
  expect(tall!.y + tall!.h).toBe(bottom - 2);
  expect(short!.y + short!.h).toBeLessThanOrEqual(building.lounge.y);
  expect(building.lounge.y + building.lounge.h).toBe(bottom - 1);
  expect(
    building.barDoorX >= building.lounge.x &&
      building.barDoorX < building.lounge.x + building.lounge.w,
  ).toBe(true);
});

test("the bar sits beneath the last room column in every shape and size", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const rooms of [
      [],
      [1],
      [3],
      [9],
      [24],
      [35],
      [100],
      [24, 4],
      [4, 100],
      [4, 4, 4],
    ]) {
      const { layout } = layoutTown(town({ a: rooms }), shape);
      const building = layout.buildings[0]!;
      const { lounge } = building;
      // The Add room slot is the building's last room, so it counts too.
      const placed = [...building.rooms, building.addRoom];
      const wall = building.x + building.w - 2;
      expect(lounge.w).toBeGreaterThanOrEqual(12);
      expect(lounge.w).toBeLessThanOrEqual(20);
      expect(lounge.spots.length).toBeGreaterThanOrEqual(12);
      expect(lounge.spots.length).toBeLessThanOrEqual(15);
      const lastX = Math.max(...placed.map((room) => room.x));
      const column = placed.filter((room) => room.x === lastX);
      const columnRight = Math.max(...column.map((room) => room.x + room.w));
      // Under the column, not beside it, and below its lowest room; its right
      // end is the column's (the right wall when no floor is spare).
      expect(lounge.x).toBeLessThan(columnRight);
      expect(lounge.x + lounge.w).toBe(Math.min(columnRight + 1, wall));
      for (const room of column)
        expect(room.y + room.h).toBeLessThanOrEqual(lounge.y);
    }
});

test("rooms keep their place inside the building", () => {
  const { layout } = layoutTown(town({ a: [3, 9, 2] }), TOWN_SHAPES.wide);
  const building = layout.buildings[0]!;
  // Rooms start under the reception lobby, nine rows below the roof line.
  expect(Math.min(...building.rooms.map((room) => room.y))).toBe(
    building.y + 9,
  );
});

const roomsAt = (layout: TownLayout) =>
  new Map(
    layout.buildings
      .flatMap((building) => building.rooms)
      .map((room) => [
        room.key,
        { x: room.x, y: room.y, w: room.w, h: room.h },
      ]),
  );

/** The input with its rooms in this order (Herdr's, after a move). */
function ordered(input: TownInput, order: readonly string[]): TownInput {
  return {
    ...input,
    rooms: input.rooms.map((room) =>
      order.includes(room.key)
        ? { ...room, order: order.indexOf(room.key) }
        : room,
    ),
  };
}

/**
 * Every room of every building, and its + Add room slot, stands clear of the
 * others, inside its walls.
 */
function expectClear(layout: TownLayout) {
  for (const building of layout.buildings) {
    const rooms = [...building.rooms, building.addRoom];
    for (const room of rooms) {
      expect(room.x).toBeGreaterThanOrEqual(building.x + 2);
      expect(room.y).toBeGreaterThanOrEqual(building.y + 9);
      expect(room.x + room.w).toBeLessThanOrEqual(building.x + building.w - 2);
      expect(room.y + room.h).toBeLessThanOrEqual(building.y + building.h - 2);
      // The bar stays clear of every room.
      expect(overlaps(room, building.lounge)).toBe(false);
      for (const other of rooms)
        if (other !== room)
          expect(
            overlaps(
              { x: room.x - 1, y: room.y - 1, w: room.w + 2, h: room.h + 2 },
              other,
            ),
          ).toBe(false);
    }
  }
}

test("a dropped room lands where the preview showed, as a reload lays it out", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const input = town({ a: [3, 3, 3, 3, 3, 3], b: [24, 1] });
    const live = layoutTown(input, shape);
    const building = live.layout.buildings[0]!;
    // Every spot in the building, a few tiles apart, for the first room.
    for (let ty = building.y; ty < building.y + building.h; ty += 4)
      for (let tx = building.x; tx < building.x + building.w; tx += 5) {
        const spot = townRoomSpotAt(live.layout, "a/room-0", tx, ty)!;
        const placement = townRoomPlacement(
          live.layout,
          "a",
          new Map([["a/room-0", spot]]),
        )!;
        // Herdr's order follows the rooms' reading order.
        const moved = ordered(input, placement.order);
        const after = layoutTown(
          moved,
          shape,
          live.memory,
          undefined,
          placement.spots,
        );
        expect(roomsAt(after.layout)).toEqual(placement.rooms);
        // The room stands exactly where it was dropped.
        const placed = after.layout.buildings[0]!.rooms.find(
          (room) => room.key === "a/room-0",
        )!;
        const lot = after.layout.buildings[0]!;
        expect({ x: placed.x - lot.x, y: placed.y - lot.y }).toEqual(spot);
        expectClear(after.layout);
        // A reload (no memory) shows the same; so does a device that has
        // not seen Herdr's new order yet.
        const reload = layoutTown(
          moved,
          shape,
          new Map(),
          undefined,
          placement.spots,
        );
        expect(townGeometryKey(reload.layout)).toBe(
          townGeometryKey(after.layout),
        );
        const stale = layoutTown(
          input,
          shape,
          live.memory,
          undefined,
          placement.spots,
        );
        expect(roomsAt(stale.layout)).toEqual(placement.rooms);
      }
  }
});

test("a room moved onto others pushes them down, and the building grows to fit", () => {
  const input = town({ a: [3, 3, 3, 3] });
  const live = layoutTown(input, TOWN_SHAPES.wide);
  const at = roomsAt(live.layout);
  const building = live.layout.buildings[0]!;
  // Room 3 dropped onto room 0's spot: room 0 makes way below it.
  const was = at.get("a/room-0")!;
  const placement = townRoomPlacement(
    live.layout,
    "a",
    new Map([["a/room-3", { x: was.x - building.x, y: was.y - building.y }]]),
  )!;
  expect(placement.changed).toBe(true);
  const now = placement.rooms;
  expect(now.get("a/room-3")).toMatchObject({ x: was.x, y: was.y });
  expect(now.get("a/room-0")!.y).toBeGreaterThan(was.y);
  expect(placement.order[0]).toBe("a/room-3");
  const after = layoutTown(
    ordered(input, placement.order),
    TOWN_SHAPES.wide,
    live.memory,
    undefined,
    placement.spots,
  );
  expectClear(after.layout);
  // Dropped back on its own spot, nothing changes.
  const own = at.get("a/room-1")!;
  expect(
    townRoomPlacement(
      live.layout,
      "a",
      new Map([["a/room-1", { x: own.x - building.x, y: own.y - building.y }]]),
    )!.changed,
  ).toBe(false);
});

test("placed rooms stay clear when a room grows or a new one opens", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const input = town({ a: [3, 3, 3] });
    const live = layoutTown(input, shape);
    const building = live.layout.buildings[0]!;
    const placement = townRoomPlacement(
      live.layout,
      "a",
      new Map([["a/room-2", { x: 2, y: building.h - 2 - 6 }]]),
    )!;
    // Room 0 grows under its saved spot, and a fourth room opens unsaved.
    const grown = town({ a: [40, 3, 3, 3] });
    const after = layoutTown(
      grown,
      shape,
      live.memory,
      undefined,
      placement.spots,
    );
    expectClear(after.layout);
    expect(after.layout.buildings[0]!.rooms).toHaveLength(4);
  }
});

test("Move before and after swap a room with its reading-order neighbour", () => {
  const input = town({ a: [3, 3, 3], b: [3, 3] });
  const live = layoutTown(input, TOWN_SHAPES.wide).layout;
  const at = roomsAt(live);
  expect(townRoomNeighbor(live, "a/room-0", -1)).toBeNull();
  expect(townRoomNeighbor(live, "a/room-0", 1)!.key).toBe("a/room-1");
  const swapped = townRoomSwap(live, "a/room-1", -1)!;
  expect(swapped.rooms.get("a/room-1")).toMatchObject({
    x: at.get("a/room-0")!.x,
    y: at.get("a/room-0")!.y,
  });
  expect(swapped.order.slice(0, 2)).toEqual(["a/room-1", "a/room-0"]);
  // The last room of a building has nothing after it.
  expect(townRoomSwap(live, "b/room-1", 1)).toBeNull();
});

test("a carried room's spot stays inside its own building", () => {
  // Four rooms leave the first one room to move down as well as across.
  const live = layoutTown(
    town({ a: [3, 3, 3, 3], b: [3] }),
    TOWN_SHAPES.wide,
  ).layout;
  const building = live.buildings[0]!;
  const room = building.rooms[0]!;
  expect(townRoomSpotAt(live, room.key, -50, -50)).toEqual({ x: 2, y: 9 });
  expect(townRoomSpotAt(live, room.key, 9999, 9999)).toEqual({
    x: building.w - 2 - room.w,
    y: building.h - 2 - room.h,
  });
  // Spots are whole tiles from the building's corner.
  expect(
    townRoomSpotAt(live, room.key, building.x + 10.4, building.y + 9.6),
  ).toEqual({ x: 10, y: 10 });
  // A room is placed only in its own host's building.
  expect(
    townRoomPlacement(live, "b", new Map([[room.key, { x: 2, y: 9 }]])),
  ).toBeNull();
});

test("a move, not a reflow: saved spots or the workspace order changed", () => {
  const input = town({ a: [3, 3, 3], b: [2] });
  const before = layoutTown(input, TOWN_SHAPES.wide);
  const grown = layoutTown(
    town({ a: [30, 3, 3, 3], b: [2] }),
    TOWN_SHAPES.wide,
    before.memory,
  );
  expect(townRoomsMoved(before.layout, grown.layout)).toBe(false);
  const reordered = layoutTown(
    ordered(input, ["a/room-2", "a/room-0", "a/room-1"]),
    TOWN_SHAPES.wide,
    before.memory,
  );
  expect(townRoomsMoved(before.layout, reordered.layout)).toBe(true);
  const spots = new Map([["a/room-0", { x: 2, y: 30 }]]);
  const placed = layoutTown(
    input,
    TOWN_SHAPES.wide,
    before.memory,
    undefined,
    spots,
  );
  expect(townRoomsMoved(before.layout, placed.layout)).toBe(true);
  // The same saved spots again are no move.
  const again = layoutTown(
    input,
    TOWN_SHAPES.wide,
    placed.memory,
    undefined,
    spots,
  );
  expect(townRoomsMoved(placed.layout, again.layout)).toBe(false);
});

/** The input with one more room on `hostKey`: a new workspace, one tab. */
function withNewRoom(input: TownInput, hostKey: string, key: string) {
  const order = input.rooms.filter((room) => room.hostKey === hostKey).length;
  return {
    ...input,
    rooms: [...input.rooms, { key, hostKey, order, deskKeys: [`${key}/t`] }],
  };
}

test("a new room is as wide as the Add room slot, and no shorter", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const { layout } = layoutTown(town({ a: [1] }), shape);
    const room = layout.buildings[0]!.rooms[0]!;
    expect(room.w).toBe(TOWN_ADD_ROOM_SLOT.w);
    expect(room.h).toBeGreaterThanOrEqual(TOWN_ADD_ROOM_SLOT.h);
  }
});

test("every building's Add room slot is where its next room opens", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    let input = town({ a: [3, 15, 1], b: [], c: [24, 2, 2, 2, 7] });
    let live = layoutTown(input, shape);
    for (let added = 0; added < 4; added += 1)
      for (const hostKey of ["a", "b", "c"]) {
        expectClear(live.layout);
        const before = live.layout.buildings.find(
          (b) => b.hostKey === hostKey,
        )!;
        const slot = {
          x: before.addRoom.x - before.x,
          y: before.addRoom.y - before.y,
          w: before.addRoom.w,
        };
        const key = `${hostKey}/new-${added}`;
        input = withNewRoom(input, hostKey, key);
        live = layoutTown(input, shape, live.memory);
        const after = live.layout.buildings.find((b) => b.hostKey === hostKey)!;
        const room = after.rooms.find((r) => r.key === key)!;
        // The new room stands where the slot was, in its building (which
        // may itself move on the street), and the slot moves on.
        expect({
          x: room.x - after.x,
          y: room.y - after.y,
          w: room.w,
        }).toEqual(slot);
        expect(overlaps(after.addRoom, room)).toBe(false);
      }
    expectClear(live.layout);
  }
});
