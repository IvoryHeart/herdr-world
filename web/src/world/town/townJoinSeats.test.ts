import { expect, test } from "bun:test";
import {
  layoutTown,
  TOWN_SHAPES,
  townShapeKey,
  type TownInput,
  type TownLayout,
  type TownPlacementMemory,
} from "./townLayout";
import {
  TOWN_JOIN_WAIT_MS,
  TownJoinSeats,
  type TownJoinRequest,
} from "./townJoinSeats";

const WIDE = townShapeKey(TOWN_SHAPES.wide);

function town(rooms: Record<string, string[]>): TownInput {
  return {
    hosts: [{ key: "studio", displayOrder: 0 }],
    rooms: Object.entries(rooms).map(([key, deskKeys], order) => ({
      key,
      hostKey: "studio",
      order,
      deskKeys,
    })),
  };
}

/** Each desk's cell as "col,row", by room. */
function cells(layout: TownLayout) {
  return Object.fromEntries(
    layout.buildings
      .flatMap((building) => building.rooms)
      .map((room) => [
        room.key,
        Object.fromEntries(
          room.cells.flatMap((cell) =>
            cell.deskKey ? [[cell.deskKey, `${cell.col},${cell.row}`]] : [],
          ),
        ),
      ]),
  );
}

/** A live scene: lays out again after each join, as Town's scene does. */
function scene(input: TownInput, now = () => 0) {
  const seats = new TownJoinSeats(now);
  let memory: TownPlacementMemory = new Map();
  let shown: TownLayout | null = null;
  const place = (next: TownInput = input) => {
    input = next;
    const held = seats.heldCells(input, shown, WIDE, 8);
    const result = layoutTown(input, "wide", memory, held);
    memory = result.memory;
    shown = result.layout;
    return cells(shown);
  };
  const join = (deskKey: string, targetKey: string, fromRoomKey = "room") => {
    seats.request({ deskKey, targetKey, fromDeskKey: deskKey, fromRoomKey });
    return place();
  };
  return { seats, place, join };
}

test("joining seats the desk beside its teammate and moves no other desk", () => {
  // a b c
  // d e .
  const { place, join } = scene(town({ room: ["a", "b", "c", "d", "e"] }));
  expect(place().room).toEqual({
    a: "0,0",
    b: "1,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
  });
  // a touches nothing free but sits up-left of e: it takes e's free right.
  expect(join("a", "e").room).toEqual({
    b: "1,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
    a: "2,1",
  });
});

test("the L built top to bottom is the L Town shows, around a foreign desk", () => {
  const { place, join } = scene(town({ room: ["a", "b", "c", "d", "e"] }));
  place();
  // a already touches d: it stays, and so does everyone else.
  expect(join("a", "d").room).toEqual({
    a: "0,0",
    b: "1,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
  });
  // b comes down under d; its old cell stays empty.
  expect(join("b", "d").room).toEqual({
    a: "0,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
    b: "0,2",
  });
  // c comes from the right: it takes b's right, closing the L around e.
  expect(join("c", "b").room).toEqual({
    a: "0,0",
    d: "0,1",
    e: "1,1",
    b: "0,2",
    c: "1,2",
  });
});

test("a desk from another room sits beside its teammate; both rooms stay put", () => {
  const before = town({
    room: ["a", "b", "c", "d", "e"],
    other: ["x", "y", "z"],
  });
  const { seats, place } = scene(before);
  const first = place();
  expect(first.other).toEqual({ x: "0,0", y: "1,0", z: "0,1" });
  const request: TownJoinRequest = {
    deskKey: "y2",
    targetKey: "e",
    fromDeskKey: "y",
    fromRoomKey: "other",
  };
  seats.request(request);
  // Until Town sees the moved tab, nothing is held.
  expect(place()).toEqual(first);
  const after = place(
    town({ room: ["a", "b", "c", "d", "e", "y2"], other: ["x", "z"] }),
  );
  expect(after.other).toEqual({ x: "0,0", z: "0,1" });
  const { y2, ...stayed } = after.room!;
  expect(stayed).toEqual(first.room);
  expect(["2,1", "1,2"]).toContain(y2);
});

test("a reorder lays the room out by tab order again", () => {
  const { place, join } = scene(town({ room: ["a", "b", "c", "d", "e"] }));
  place();
  join("a", "e");
  expect(place(town({ room: ["b", "a", "c", "d", "e"] })).room).toEqual({
    b: "0,0",
    a: "1,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
  });
});

test("a desk with no free cell beside its teammate keeps its own", () => {
  const { place, join } = scene(town({ room: ["a", "b", "c", "d", "e"] }));
  place();
  // a's neighbours b and d are taken, and it has no left or above.
  expect(join("e", "a").room).toEqual({
    a: "0,0",
    b: "1,0",
    c: "2,0",
    d: "0,1",
    e: "1,1",
  });
});

test("a join that never reaches the team's room is dropped", () => {
  let now = 0;
  const { seats, place } = scene(
    town({ room: ["a", "b"], other: ["x"] }),
    () => now,
  );
  place();
  seats.request({
    deskKey: "x2",
    targetKey: "a",
    fromDeskKey: "x",
    fromRoomKey: "other",
  });
  place();
  now = TOWN_JOIN_WAIT_MS + 1;
  place();
  // Arriving late, it takes the room's next free cell by tab order.
  expect(place(town({ room: ["a", "b", "x2"], other: [] })).room).toEqual({
    a: "0,0",
    b: "1,0",
    x2: "0,1",
  });
});
