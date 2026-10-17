import { expect, test } from "bun:test";
import {
  layoutTown,
  TOWN_MAX_RENDERED_DESKS,
  TOWN_ROOM_TIERS,
  townDeskSlots,
  townSeat,
  townTierFor,
  TownGround,
  type TownInput,
  type TownLayout,
} from "./townLayout";

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
  for (let count = 0; count <= TOWN_MAX_RENDERED_DESKS; count += 1) {
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
        expect(room.y + room.h).toBeLessThanOrEqual(building.lobbyY);
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

test("a closed tab frees its spot without moving its neighbours", () => {
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
  for (const key of keys) {
    const was = cellOf(first.layout, key)!;
    const now = cellOf(second.layout, key)!;
    expect([now.col, now.row]).toEqual([was.col, was.row]);
  }
  const room = second.layout.buildings[0]!.rooms[0]!;
  expect(
    room.cells.find((c) => c.col === freed.col && c.row === freed.row)!.deskKey,
  ).toBeNull();
});

test("growing a capacity step keeps every desk's grid coordinate", () => {
  let result = layoutTown(town({ a: [1] }), "wide");
  for (let count = 2; count <= TOWN_MAX_RENDERED_DESKS; count += 1) {
    const previous = new Map(
      desks("a/room-0", count - 1).map((key) => {
        const cell = cellOf(result.layout, key)!;
        return [key, [cell.col, cell.row]];
      }),
    );
    result = layoutTown(town({ a: [count] }), "wide", result.memory);
    for (const [key, at] of previous) {
      const cell = cellOf(result.layout, key)!;
      expect([cell.col, cell.row]).toEqual(at);
    }
  }
});

test("a live room does not shrink, and a rebuild re-derives from native order", () => {
  const big = layoutTown(town({ a: [10] }), "wide");
  const live = layoutTown(town({ a: [2] }), "wide", big.memory).layout;
  expect(live.buildings[0]!.rooms[0]!.cols).toBe(
    big.layout.buildings[0]!.rooms[0]!.cols,
  );
  const rebuilt = layoutTown(town({ a: [2] }), "wide").layout;
  const room = rebuilt.buildings[0]!.rooms[0]!;
  expect([room.cols, room.rows]).toEqual([...TOWN_ROOM_TIERS[townTierFor(2)]!]);
  expect(room.cells.slice(0, 2).map((c) => c.deskKey)).toEqual(
    desks("a/room-0", 2),
  );
});

test("desks beyond the rendered bound stay reachable as overflow", () => {
  const { layout } = layoutTown(
    town({ a: [TOWN_MAX_RENDERED_DESKS + 4] }),
    "wide",
  );
  const room = layout.buildings[0]!.rooms[0]!;
  expect(room.cells.filter((c) => c.deskKey).length).toBe(
    TOWN_MAX_RENDERED_DESKS,
  );
  expect(room.cells.some((c) => !c.deskKey)).toBe(true);
  expect(room.overflowDeskKeys.length).toBe(4);
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
