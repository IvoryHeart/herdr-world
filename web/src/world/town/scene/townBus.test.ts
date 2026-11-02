import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../../shared/bin";
import { BUS_SEATS, BUS_W } from "../townBusGeometry";
import { layoutTown, TOWN_TILE as T, TownGround } from "../townLayout";
import {
  inTownBusDropZone,
  townBusAt,
  townBusLeaverAt,
  townBusLeavers,
  townBusRiderAt,
  townBusScene,
  townBusSeen,
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
      departure_ms: BIN_DEPARTURE_MS,
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

// Remaining time counts the 30 s wait and then the drive away.
const TOTAL = 30_000 + BIN_DEPARTURE_MS;
const HALF_GONE = BIN_DEPARTURE_MS / 2;

test("a bus drives in to stop at 0:10, waits, and leaves the map as the close commits", () => {
  const D = BIN_DEPARTURE_MS;
  // Remaining counts the 30 s countdown, then the 6 s drive away.
  const at = [
    TOTAL - 1_000,
    TOTAL - 12_000,
    D + 10_500,
    D + 10_000,
    D + 4_000,
    D,
    HALF_GONE,
    0,
  ];
  const scenes = at.map(
    (remaining) => scene([rider("trip-a", remaining).entry]).scene,
  );
  const xs = scenes.map((s) => s.buses[0]!);
  expect(xs.map((b) => b.phase)).toEqual([
    "arriving",
    "arriving",
    "arriving",
    "waiting",
    "waiting",
    "waiting",
    "departing",
    "departing",
  ]);
  // Driving in, ever nearer, and slowing: the last half second covers less
  // than the first second did.
  expect(xs[0]!.x).toBeLessThan(xs[1]!.x);
  expect(xs[1]!.x).toBeLessThan(xs[2]!.x);
  const slot = xs[3]!.home;
  expect(xs[2]!.x).toBeLessThan(slot);
  const first = scene([rider("trip-b0", TOTAL).entry]).scene.buses[0]!.x;
  expect(slot - xs[2]!.x).toBeLessThan(xs[0]!.x - first);
  // At the stop from 0:10 to 0:00, doors open, the clock showing the wait.
  expect([xs[3]!.x, xs[4]!.x, xs[5]!.x]).toEqual([slot, slot, slot]);
  expect(xs[3]!.doorsOpen && xs[5]!.doorsOpen).toBe(true);
  expect([xs[3]!.remaining, xs[5]!.remaining]).toEqual([10_000, 0]);
  // Pulling away, doors shut; off the map exactly when the close commits.
  const { layout } = scene([]);
  expect(xs[6]!.doorsOpen).toBe(false);
  expect(xs[6]!.x).toBeGreaterThan(slot);
  expect(xs[6]!.x).toBeLessThan(layout.width * T);
  expect(xs[7]!.x).toBe(layout.width * T);
  expect(scenes.map((s) => s.next?.leaving)).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    true,
    true,
  ]);
});

test("a short countdown's bus still pulls in, over its first 3 s", () => {
  const short = (remaining: number) =>
    scene([rider("trip-s", remaining, 10_000).entry]).scene.buses[0]!;
  const total = 10_000 + BIN_DEPARTURE_MS;
  expect(short(total - 1_000).phase).toBe("arriving");
  expect(short(total - 3_000).phase).toBe("waiting");
});

test("held while driving in, the bus stops where it is", () => {
  const moving = scene([rider("trip-h", TOTAL - 8_000).entry]).scene.buses[0]!;
  const held = scene([rider("trip-h2", TOTAL - 8_000).entry], { paused: true })
    .scene.buses[0]!;
  expect([held.phase, held.x, held.doorsOpen]).toEqual([
    "arriving",
    moving.x,
    true,
  ]);
  expect(held.x).toBeLessThan(held.home);
});

test("while a bus pulls in its riders wait at the stop with their box", () => {
  const { entry } = rider("trip-b", TOTAL - 500);
  const { scene: s } = scene([entry]);
  expect(s.buses[0]!.riders).toEqual([]);
  expect(s.waiting.map((r) => r.entryId)).toEqual([entry.id]);
  expect(townBusRiderAt(s, s.waiting[0]!.x, s.waiting[0]!.y - 6)).toBe(
    entry.id,
  );
});

test("held while driving away, the bus stops where it is with its doors open", () => {
  const moving = scene([rider("trip-c", HALF_GONE).entry]).scene.buses[0]!;
  const held = scene([rider("trip-c2", HALF_GONE).entry], { paused: true })
    .scene.buses[0]!;
  // Time is frozen, so it stays put mid road, and its riders can get off.
  expect([held.phase, held.doorsOpen, held.x]).toEqual([
    "departing",
    true,
    moving.x,
  ]);
  expect(held.riders).toHaveLength(1);
});

test("under reduced motion the bus stays parked through the countdown and the departure", () => {
  const parked = scene([rider("trip-p", BIN_DEPARTURE_MS + 5_000).entry]).scene
    .buses[0]!;
  const arriving = scene([rider("trip-d", TOTAL - 100).entry], {
    reducedMotion: true,
  }).scene.buses[0]!;
  expect([arriving.phase, arriving.x]).toEqual(["waiting", parked.x]);
  const leaving = scene([rider("trip-q", 1).entry], { reducedMotion: true })
    .scene.buses[0]!;
  expect([leaving.phase, leaving.x, leaving.doorsOpen]).toEqual([
    "departing",
    parked.x,
    false,
  ]);
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
    // All at the stop (inside the last 10 s of their countdowns).
    ...Array.from({ length: 11 }, () => rider("trip-big", 14_000).entry),
    ...Array.from({ length: 30 }, (_, i) => rider("", 11_000 + i * 10).entry),
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

test("the edge chip reads the soonest departure's wait", () => {
  const a = rider("trip-e", 12_000 + BIN_DEPARTURE_MS).entry;
  const b = rider("trip-e", 12_000 + BIN_DEPARTURE_MS).entry;
  const c = rider("trip-f", 25_000).entry;
  expect(scene([c, a, b]).scene.next).toEqual({
    remaining: 12_000,
    leaving: false,
    riders: 2,
  });
  expect(scene([]).scene.next).toBeNull();
});

test("a boarding reset preserves the original approach speed and arrival", () => {
  const before = scene([rider("trip-r", TOTAL - 10_000).entry]).scene.buses[0]!;
  expect(before.phase).toBe("arriving");
  const starts = new Map([[before.key, before.approach]]);
  const at = (remaining: number) =>
    scene([rider("trip-r", remaining).entry], { starts }).scene.buses[0]!;
  // The clock is full again: it is where it was, not back at the map's edge.
  expect(at(TOTAL).x).toBeCloseTo(before.x, 6);
  expect(at(TOTAL).phase).toBe("arriving");
  // The original run still arrives ten seconds later, then waits twenty.
  const original = scene([rider("trip-r", TOTAL - 11_000).entry]).scene
    .buses[0]!;
  expect(at(TOTAL - 1_000).x).toBeCloseTo(original.x, 6);
  expect(at(TOTAL - 10_000).x).toBe(before.home);
  expect(at(TOTAL - 10_000).phase).toBe("waiting");
  // A bus already at the stop just keeps waiting.
  const parkedBus = at(TOTAL - 10_000);
  const parked = new Map([[before.key, parkedBus.approach]]);
  const waiting = scene([rider("trip-r", TOTAL).entry], { starts: parked })
    .scene.buses[0]!;
  expect([waiting.phase, waiting.x]).toEqual(["waiting", before.home]);
});

test("reset at 0:01 while one second out arrives in one second and waits 29 seconds", () => {
  // A second reset has extended the wait: this bus is still one second out
  // even though the departure clock currently shows 0:01.
  const near = scene([rider("trip-near", TOTAL - 19_000).entry]).scene
    .buses[0]!;
  const starts = new Map([[near.key, near.approach]]);
  const at = (ms: number) =>
    scene([rider("trip-near", TOTAL - ms).entry], { starts }).scene.buses[0]!;
  const reset = at(0);
  expect(reset.x).toBeCloseTo(near.x, 6);
  expect(reset.approach.run).toBe(near.approach.run);
  expect(reset.approach.run.speedAt(reset.approach.elapsed)).toBeCloseTo(
    near.approach.run.speedAt(near.approach.elapsed),
    6,
  );
  expect(at(999).phase).toBe("arriving");
  for (const ms of [1_000, 15_000, 29_999, 30_000]) {
    expect(at(ms).phase).toBe("waiting");
    expect(at(ms).x).toBe(near.home);
  }
  expect(at(30_001).phase).toBe("departing");
});

test("a restarted clock and an arrival are told apart; holding is neither", async () => {
  const { townBusChanges, townBusSeen } = await import("./townBus");
  const coming = scene([rider("trip-c", BIN_DEPARTURE_MS + 10_100).entry]).scene
    .buses;
  const arrived = scene([rider("trip-c", BIN_DEPARTURE_MS + 9_900).entry]).scene
    .buses;
  const seen = townBusSeen(coming);
  expect(townBusChanges(seen, arrived, false)).toEqual({
    restarts: new Map(),
    arrivals: 1,
  });
  // Held, the horn waits.
  expect(townBusChanges(seen, arrived, true).arrivals).toBe(0);
  // Boarding: the clock goes back to full.
  const reset = scene([rider("trip-c", TOTAL).entry]).scene.buses;
  expect(townBusChanges(seen, reset, false)).toEqual({
    restarts: new Map([[coming[0]!.key, coming[0]!.approach]]),
    arrivals: 0,
  });
});

test("a bus emptied at the stop pulls away from rest and leaves the map; it never vanishes", () => {
  const { layout, scene: full } = scene([
    rider("trip-e", TOTAL - 20_000).entry,
  ]);
  const bus = full.buses[0]!;
  expect([bus.phase, bus.speed]).toEqual(["waiting", 0]);
  const empty = scene([]).scene;
  const width = layout.width * T;
  const [leaver, ...rest] = townBusLeavers(
    townBusSeen(full.buses),
    empty.buses,
    width,
    1_000,
    false,
  );
  expect(rest).toEqual([]);
  expect(leaver!.key).toBe(bus.key);
  // Still where it stood at the moment it emptied, then slow, then faster.
  const at = (t: number) => townBusLeaverAt(leaver!, 1_000 + t)!;
  expect(at(0).x).toBe(bus.x);
  const early = at(500).x - at(0).x;
  const later = at(1_500).x - at(1_000).x;
  expect(early).toBeGreaterThan(0);
  expect(later).toBeGreaterThan(early);
  // Off the map in the trip's pull-away time, then gone for good.
  expect(leaver!.run.duration).toBe(BIN_DEPARTURE_MS);
  expect(townBusLeaverAt(leaver!, 1_000 + BIN_DEPARTURE_MS)).toBeNull();
});

test("a bus emptied while held or driving keeps going at its own speed", () => {
  const { layout, scene: held } = scene(
    [rider("trip-hd", TOTAL - 8_000).entry],
    { paused: true },
  );
  const width = layout.width * T;
  // Held: it was standing, so it pulls away from rest.
  const fromHeld = townBusLeavers(townBusSeen(held.buses), [], width, 0, false);
  expect(fromHeld[0]!.run.speedAt(0)).toBe(0);
  // Already leaving fast: it never slows down to pull away again.
  const leaving = scene([rider("trip-lv", HALF_GONE / 2).entry]).scene
    .buses[0]!;
  expect(leaving.speed).toBeGreaterThan(0);
  const [on] = townBusLeavers(townBusSeen([leaving]), [], width, 0, false);
  expect(on!.run.speedAt(0)).toBeGreaterThanOrEqual(leaving.speed - 1e-6);
});

test("buses still riding, off the map, or under reduced motion never become leavers", () => {
  const { layout, scene: s } = scene([rider("trip-k", TOTAL - 20_000).entry]);
  const width = layout.width * T;
  const seen = townBusSeen(s.buses);
  expect(townBusLeavers(seen, s.buses, width, 0, false)).toEqual([]);
  expect(townBusLeavers(seen, [], width, 0, true)).toEqual([]);
  const gone = scene([rider("trip-g", 0).entry]).scene.buses;
  expect(gone[0]!.x).toBe(width);
  expect(townBusLeavers(townBusSeen(gone), [], width, 0, false)).toEqual([]);
  const offLeft = scene([rider("trip-o", TOTAL).entry]).scene.buses;
  expect(offLeft[0]!.x + BUS_W).toBeLessThanOrEqual(0);
  expect(townBusLeavers(townBusSeen(offLeft), [], width, 0, false)).toEqual([]);
});
