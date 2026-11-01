import { expect, test } from "bun:test";
import type { BinEntry } from "../../../../../shared/bin";
import { BUS_SEATS, BUS_W } from "../townBusGeometry";
import { layoutTown, TOWN_TILE as T, TownGround } from "../townLayout";
import {
  inTownBusDropZone,
  townBusAt,
  townBusRiderAt,
  townBusScene,
  type TownBusInput,
} from "./townBus";

const town = (hosts: number) => ({
  hosts: Array.from({ length: hosts }, (_, i) => ({
    key: `host-${i}`,
    displayOrder: i,
  })),
  rooms: Array.from({ length: hosts }, (_, i) => ({
    key: `host-${i}/room`,
    hostKey: `host-${i}`,
    order: 0,
    deskKeys: [`host-${i}/room/tab-0`, `host-${i}/room/tab-1`],
  })),
});

test("the stop stands on the topmost street's pavement, right of its last crossing", () => {
  for (const [hosts, shape] of [
    [1, "wide"],
    [3, "wide"],
    [2, "narrow"],
  ] as const) {
    const { layout } = layoutTown(town(hosts), shape);
    const { busStop, roads, verticalRoads, width } = layout;
    expect(busStop.road).toBe(Math.min(...roads));
    expect(layout.ground[busStop.y * width + busStop.x]).toBe(TownGround.walk);
    const crossings = verticalRoads.filter(
      (v) => v.y1 === busStop.road || v.y0 === busStop.road + 5,
    );
    if (crossings.length)
      expect(busStop.x).toBeGreaterThan(Math.max(...crossings.map((v) => v.x)));
    expect(
      layout.lamps.some(
        (lamp) =>
          Math.abs(lamp.x - busStop.x) <= 2 &&
          Math.abs(lamp.y - busStop.y) <= 1,
      ),
    ).toBe(false);
  }
});

let next = 0;
const rider = (trip: string, remaining: number, duration = 30_000) => {
  const id = `bin-run-${++next}`;
  return {
    entry: {
      id,
      connection_id: "studio",
      connection_generation: 1,
      workspace_id: "w1",
      tab_id: "t1",
      pane_id: id,
      terminal_id: `term-${id}`,
      label: id,
      view: "town",
      duration_ms: duration,
      remaining_ms: remaining,
      trip: trip || id,
    } satisfies BinEntry,
  };
};

function scene(
  entries: BinEntry[],
  extra: Partial<TownBusInput> = {},
  hosts = 1,
) {
  const { layout } = layoutTown(town(hosts), "wide");
  return {
    layout,
    scene: townBusScene({
      stop: layout.busStop,
      width: layout.width * T,
      entries,
      remaining: (entry) => entry.remaining_ms,
      paused: false,
      reducedMotion: false,
      ...extra,
    }),
  };
}

test("a bus drives in, waits doors open, and leaves by the right edge on time", () => {
  const xs = [29_000, 27_500, 20_000, 2_000, 0].map((remaining) => {
    const { entry } = rider("trip-a", remaining);
    return scene([entry]).scene.buses[0]!;
  });
  expect(xs.map((b) => b.phase)).toEqual([
    "arriving",
    "arriving",
    "waiting",
    "departing",
    "departing",
  ]);
  expect(xs[0]!.x).toBeLessThan(xs[1]!.x);
  expect(xs[1]!.x).toBeLessThan(xs[2]!.x);
  expect(xs[2]!.doorsOpen).toBe(true);
  expect(xs[3]!.doorsOpen).toBe(false);
  const { layout } = scene([]);
  expect(xs[4]!.x).toBe(layout.width * T);
});

test("while a bus pulls in its riders wait at the stop with their box", () => {
  const { entry } = rider("trip-b", 29_500);
  const { scene: s } = scene([entry]);
  expect(s.buses[0]!.riders).toEqual([]);
  expect(s.waiting.map((r) => r.entryId)).toEqual([entry.id]);
  expect(townBusRiderAt(s, s.waiting[0]!.x, s.waiting[0]!.y - 6)).toBe(
    entry.id,
  );
});

test("held or under reduced motion, the bus stands still with its doors open", () => {
  const parked = scene([rider("trip-p", 20_000).entry]).scene.buses[0]!;
  const held = scene([rider("trip-c", 1_000).entry], { paused: true }).scene
    .buses[0]!;
  // Held mid pull-away: time is frozen, so it stays put, doors open.
  expect([held.phase, held.doorsOpen]).toEqual(["departing", true]);
  const still = scene([rider("trip-d", 29_900).entry], {
    reducedMotion: true,
  }).scene.buses[0]!;
  expect([still.phase, still.x]).toEqual(["waiting", parked.x]);
});

test("a crossing meeting the street from above or from below both count", async () => {
  const { townBusStop } = await import("../townBusStop");
  // Today's grid: the vertical road ends on the street.
  expect(townBusStop([10], [{ x: 20, y0: 2, y1: 10 }], 60, 3)).toMatchObject({
    road: 10,
    x: 26,
    y: 10,
  });
  // The top-road grid: the vertical road starts below the street's band.
  expect(townBusStop([10], [{ x: 20, y0: 15, y1: 40 }], 60, 3)).toMatchObject({
    road: 10,
    x: 26,
    y: 10,
  });
  // A vertical road elsewhere is not a crossing of this street.
  expect(townBusStop([10], [{ x: 20, y0: 30, y1: 40 }], 60, 3).x).toBe(54);
});

test("every rider of a crowded town has a seat on the map and is found under the pointer", () => {
  const entries = [
    ...Array.from({ length: 11 }, () => rider("trip-big", 20_000).entry),
    ...Array.from({ length: 30 }, (_, i) => rider("", 15_000 + i * 10).entry),
  ];
  const { scene: s, layout } = scene(entries, {}, 2);
  const seated = s.buses.flatMap((bus) => bus.riders);
  expect(seated).toHaveLength(entries.length);
  // A trip bigger than one bus takes two.
  expect(s.buses.filter((b) => b.trip === "trip-big")).toHaveLength(2);
  expect(Math.max(...s.buses.map((b) => b.riders.length))).toBeLessThanOrEqual(
    BUS_SEATS.length,
  );
  for (const bus of s.buses) {
    expect(bus.x).toBeGreaterThanOrEqual(0);
    expect(bus.x + BUS_W).toBeLessThanOrEqual(layout.width * T);
  }
  for (const r of seated)
    expect(townBusRiderAt(s, r.x + 4, r.y + 4)).toBe(r.entryId);
  for (const bus of s.buses) {
    expect(townBusAt(s, bus.x + 30, bus.y + 20)).toBe(bus);
    expect(inTownBusDropZone(s, bus.x + 30, bus.y + 20)).toBe(true);
  }
  expect(inTownBusDropZone(s, s.stop.x + 5, s.stop.y + 20)).toBe(true);
});

test("the edge chip reads the soonest departure", () => {
  const a = rider("trip-e", 12_000).entry;
  const b = rider("trip-e", 12_000).entry;
  const c = rider("trip-f", 25_000).entry;
  expect(scene([c, a, b]).scene.next).toEqual({ remaining: 12_000, riders: 2 });
  expect(scene([]).scene.next).toBeNull();
});
