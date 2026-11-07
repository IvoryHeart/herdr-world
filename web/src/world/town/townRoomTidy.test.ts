import { expect, test } from "bun:test";
import type { TownModel } from "./townModel";
import type { TownRendererHandle } from "./townRenderer";
import {
  TOWN_GLIDE_SECONDS,
  TOWN_GLIDE_STAGGER,
  townGlideProgress,
} from "./townRendererGlide";
import type { TownRoomActions } from "./townRoomActions";
import { townRoomMoves } from "./townRoomPins";
import {
  layoutTown,
  TOWN_SHAPES,
  townGeometryKey,
  type TownInput,
  type TownLayout,
  type TownShape,
} from "./townLayout";
import {
  townBuildingSpots,
  townRoomPlacement,
  townRoomRestore,
  townRoomTidy,
  type TownRoomPlacement,
} from "./townRoomPlace";

/** One building `a` with rooms of these desk counts, and a neighbour `b`. */
function town(counts: number[]): TownInput {
  const hosts = { a: counts, b: [3, 3] };
  return {
    hosts: Object.keys(hosts).map((key, displayOrder) => ({
      key,
      displayOrder,
    })),
    rooms: Object.entries(hosts).flatMap(([hostKey, list]) =>
      list.map((count, order) => ({
        key: `${hostKey}/room-${order}`,
        hostKey,
        order,
        deskKeys: Array.from(
          { length: count },
          (_, index) => `${hostKey}/room-${order}/tab-${index}`,
        ),
      })),
    ),
  };
}

/** The input with Herdr's workspace order following a placement. */
const ordered = (input: TownInput, order: readonly string[]): TownInput => ({
  ...input,
  rooms: input.rooms.map((room) =>
    order.includes(room.key)
      ? { ...room, order: order.indexOf(room.key) }
      : room,
  ),
});

/** Lay the town out as World shows it once a placement is saved. */
const saved = (
  input: TownInput,
  shape: TownShape,
  placement: TownRoomPlacement,
) => {
  const next = ordered(input, placement.order);
  return {
    input: next,
    layout: layoutTown(next, shape, new Map(), undefined, placement.spots)
      .layout,
  };
};

/** Rooms by key in a building, with their spot and size. */
const boxes = (layout: TownLayout, hostKey: string) => {
  const building = layout.buildings.find((b) => b.hostKey === hostKey)!;
  return building.rooms.map((room) => ({
    key: room.key,
    x: room.x - building.x,
    y: room.y - building.y,
    w: room.w,
    h: room.h,
  }));
};

/**
 * Scatter building `a`'s rooms by hand: the last room to the top left, the
 * first far down, as free movement (#691) allows.
 */
function scattered(input: TownInput, shape: TownShape) {
  const live = layoutTown(input, shape).layout;
  const building = live.buildings[0]!;
  const keys = building.rooms.map((room) => room.key);
  const placement = townRoomPlacement(
    live,
    "a",
    new Map([
      [keys[keys.length - 1]!, { x: 7, y: 15 }],
      [keys[0]!, { x: 4, y: building.h }],
    ]),
  )!;
  return saved(input, shape, placement);
}

const SIZES = [[3, 3, 3, 3, 3], [12, 2, 30, 5, 1, 9], [24, 1], [6]];

test("Tidy rooms packs a moved building's rooms without gaps or overlaps", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const counts of SIZES) {
      const moved = scattered(town(counts), shape);
      const placement = townRoomTidy(moved.layout, "a")!;
      const tidy = saved(moved.input, shape, placement);
      const rooms = boxes(tidy.layout, "a");
      // Rooms stand exactly where the placement put them.
      for (const room of rooms)
        expect(placement.spots.get(room.key)).toEqual({ x: room.x, y: room.y });
      // Columns from the left wall, the shape's count at most, the first
      // rooms along the top: no room floats with space above it.
      const columns = [...new Set(rooms.map((room) => room.x))].sort(
        (a, b) => a - b,
      );
      expect(columns[0]).toBe(2);
      expect(columns.length).toBeLessThanOrEqual(shape.roomColumns);
      for (const x of columns) {
        const column = rooms
          .filter((room) => room.x === x)
          .sort((a, b) => a.y - b.y);
        expect(column[0]!.y).toBe(9);
        // Each room stands the usual two tiles under the one above it.
        column.slice(1).forEach((room, index) => {
          const above = column[index]!;
          expect(room.y).toBe(above.y + above.h + 2);
        });
      }
      // Neighbouring columns stand two tiles apart, without overlap.
      columns.slice(1).forEach((x, index) => {
        const widest = Math.max(
          ...rooms.filter((r) => r.x === columns[index]).map((r) => r.w),
        );
        expect(x).toBe(columns[index]! + widest + 2);
      });
      // The neighbouring building's rooms keep their spots.
      expect(boxes(tidy.layout, "b")).toEqual(boxes(moved.layout, "b"));
    }
});

test("Tidy rooms keeps Herdr's order and gives the never-moved arrangement", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const counts of SIZES) {
      const input = town(counts);
      const fresh = layoutTown(input, shape).layout;
      const moved = scattered(input, shape);
      const placement = townRoomTidy(moved.layout, "a")!;
      // The reading order is Herdr's workspace order, so Spaces matches.
      expect(placement.order).toEqual(
        moved.layout.buildings[0]!.rooms.map((room) => room.key),
      );
      // In Herdr's original order, a tidy building is a never-moved one.
      const tidy = saved(input, shape, townRoomTidy(fresh, "a")!);
      expect(townGeometryKey(tidy.layout)).toBe(townGeometryKey(fresh));
    }
});

test("Tidy rooms twice gives the same result: the second changes nothing", () => {
  for (const shape of Object.values(TOWN_SHAPES))
    for (const counts of SIZES) {
      const moved = scattered(town(counts), shape);
      const first = townRoomTidy(moved.layout, "a")!;
      const once = saved(moved.input, shape, first);
      const second = townRoomTidy(once.layout, "a")!;
      expect(second.changed).toBe(false);
      expect(second.spots).toEqual(first.spots);
      expect(second.order).toEqual(first.order);
    }
});

test("Undo puts the rooms back where they stood before the tidy", () => {
  for (const shape of Object.values(TOWN_SHAPES)) {
    const moved = scattered(town([12, 2, 30, 5]), shape);
    const before = townBuildingSpots(moved.layout, "a");
    const tidy = saved(moved.input, shape, townRoomTidy(moved.layout, "a")!);
    const undo = townRoomRestore(tidy.layout, "a", before)!;
    expect(undo.changed).toBe(true);
    const back = saved(tidy.input, shape, undo);
    expect(townGeometryKey(back.layout)).toBe(townGeometryKey(moved.layout));
    expect(back.input.rooms.map((room) => room.order)).toEqual(
      moved.input.rooms.map((room) => room.order),
    );
  }
});

test("Undo skips rooms closed since and keeps rooms opened since clear", () => {
  const shape = TOWN_SHAPES.wide;
  const moved = scattered(town([3, 3, 3]), shape);
  const before = new Map([
    ...townBuildingSpots(moved.layout, "a"),
    ["a/closed", { x: 2, y: 9 }],
  ]);
  const grown = town([3, 3, 3, 4]);
  const tidy = saved(
    grown,
    shape,
    townRoomTidy(layoutTown(grown, shape).layout, "a")!,
  );
  const undo = townRoomRestore(tidy.layout, "a", before)!;
  expect(undo.spots.has("a/closed")).toBe(false);
  expect(undo.spots.size).toBe(4);
  const rooms = saved(tidy.input, shape, undo).layout.buildings[0]!.rooms;
  for (const room of rooms)
    for (const other of rooms)
      if (other !== room)
        expect(
          room.x < other.x + other.w &&
            other.x < room.x + room.w &&
            room.y < other.y + other.h &&
            other.y < room.y + room.h,
        ).toBe(false);
  expect(townRoomTidy(tidy.layout, "nobody")).toBeNull();
});

/**
 * The room actions TownCanvas fills in for the town shown; `shown.layout` is
 * the town an Undo sees later.
 */
function roomMoves(layout: TownLayout, calls: unknown[][]) {
  const rooms = new Map(
    layout.buildings.flatMap((b) =>
      b.rooms.map((room) => [
        room.key,
        { key: room.key, hostKey: b.hostKey, canOpenInSpaces: true },
      ]),
    ),
  );
  const model = {
    rooms,
    hosts: new Map([["a", { displayLabel: "Alpha" }]]),
  } as unknown as TownModel;
  const roomActions = {
    onPlaceRooms: async (
      roomKey: string,
      placement: TownRoomPlacement,
      label?: string,
    ) => {
      calls.push(["place", roomKey, placement, label]);
      return "moved" as const;
    },
    onRoomsTidied: (label: string, undo: unknown) =>
      calls.push(["tidied", label, undo]),
  } as unknown as TownRoomActions;
  const renderer = {
    current: {
      beginGlide: (hostKey: string) => calls.push(["begin", hostKey]),
      finishGlide: (result: string) => calls.push(["finish", result]),
    } as unknown as TownRendererHandle,
  };
  const shown = { current: { roomActions, layout } };
  return {
    actions: townRoomMoves(roomActions, model, layout, shown, renderer),
    shown: shown.current,
  };
}

test("Tidy rooms glides, saves like a room move and offers Undo", async () => {
  const shape = TOWN_SHAPES.wide;
  const moved = scattered(town([12, 2, 30, 5]), shape);
  const calls: unknown[][] = [];
  const { actions, shown } = roomMoves(moved.layout, calls);
  expect(actions.canTidyRooms!("a")).toBe(true);
  actions.onTidyRooms!("a");
  await Bun.sleep(0);
  const tidy = townRoomTidy(moved.layout, "a")!;
  expect(calls.map((call) => call[0])).toEqual([
    "begin",
    "place",
    "finish",
    "tidied",
  ]);
  const [, roomKey, placement, label] = calls[1]!;
  expect(roomKey).toBe(tidy.order[0]);
  expect((placement as TownRoomPlacement).spots).toEqual(tidy.spots);
  expect(label).toBe("Alpha's rooms");
  expect(calls[3]![1]).toBe("Alpha");
  // By the time of Undo the town shows the tidy rooms.
  shown.layout = saved(moved.input, shape, tidy).layout;
  // Undo glides the rooms back to where they stood before the tidy.
  const undo = calls[3]![2] as () => Promise<string>;
  calls.length = 0;
  expect(await undo()).toBe("moved");
  const back = calls[1]![2] as TownRoomPlacement;
  expect(back.spots).toEqual(townBuildingSpots(moved.layout, "a"));
  expect(calls.map((call) => call[0])).toEqual(["begin", "place", "finish"]);
});

test("Tidy rooms on a tidy building saves nothing and says so", () => {
  const live = layoutTown(town([3, 3, 3]), TOWN_SHAPES.wide).layout;
  const calls: unknown[][] = [];
  const { actions } = roomMoves(live, calls);
  actions.onTidyRooms!("a");
  expect(calls).toEqual([["tidied", "Alpha", null]]);
  // A building with one room has nothing to tidy.
  const single = layoutTown(town([3]), TOWN_SHAPES.wide).layout;
  const { actions: alone } = roomMoves(
    {
      ...single,
      buildings: single.buildings.filter((b) => b.hostKey === "a"),
    },
    calls,
  );
  expect(alone.canTidyRooms!("a")).toBe(false);
});

test("a glide eases each room along in turn and lands it", () => {
  expect(townGlideProgress(0, 0)).toMatchObject({ along: 0, landed: false });
  const mid = townGlideProgress(TOWN_GLIDE_SECONDS / 2, 0);
  expect(mid.along).toBeCloseTo(0.5);
  expect(mid.lift).toBeCloseTo(1);
  // The next room starts a little later.
  expect(townGlideProgress(TOWN_GLIDE_STAGGER / 2, 1).along).toBe(0);
  expect(townGlideProgress(TOWN_GLIDE_SECONDS, 0)).toMatchObject({
    along: 1,
    landed: true,
  });
  expect(townGlideProgress(TOWN_GLIDE_SECONDS, 1).landed).toBe(false);
});
