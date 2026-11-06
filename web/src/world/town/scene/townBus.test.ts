import { describe, expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../../shared/bin";
import { BUS_SEATS, BUS_W } from "../townBusGeometry";
import { layoutTown, TOWN_TILE as T, TownGround } from "../townLayout";
import { townBusRoute, townBusTimetable } from "./townBusRoute";
import {
  inTownBusDropZone,
  townBusHitAt,
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

test("the main stop is the central road stop and all stops stand on clear pavement", () => {
  for (const [hosts, shape] of [
    [1, "wide"],
    [3, "wide"],
    [2, "narrow"],
  ] as const) {
    const { layout } = layoutTown(town(hosts), shape);
    const { busStop, busStops, width, height } = layout;
    const distance = (s: (typeof busStops)[number]) =>
      (s.x - width / 2) ** 2 + (s.y - height / 2) ** 2;
    expect(busStop).toBe(
      [...busStops].sort(
        (a, b) => distance(a) - distance(b) || a.order - b.order,
      )[0]!,
    );
    expect(busStops.filter((s) => s.main)).toEqual([busStop]);
    for (const stop of busStops) {
      expect(layout.ground[stop.y * width + stop.x]).toBe(TownGround.walk);
      expect(
        layout.lamps.some(
          (lamp) =>
            Math.abs(lamp.x - stop.x) <= 2 && Math.abs(lamp.y - stop.y) <= 1,
        ),
      ).toBe(false);
    }
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
      // Isolate one occupied street for these timing/seat consumers. The
      // full multi-road plan is covered by townBusRoute.test.ts.
      stops: [layout.busStop],
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
const arrivalMs = (duration = 30_000) => {
  const { layout } = scene([]);
  return townBusTimetable(
    townBusRoute([layout.busStop], layout.width * T),
    duration,
  ).stops[0]!.arriveMs;
};

test("a bus follows its fixed route clock, waits at the occupied stop and leaves by close", () => {
  const D = BIN_DEPARTURE_MS;
  const arrival = arrivalMs();
  expect(arrival).toBeGreaterThan(1_000);
  expect(arrival).toBeLessThanOrEqual(20_000);
  // Remaining counts the 30 s countdown, then the 6 s drive away.
  const at = [
    TOTAL - 500,
    TOTAL - arrival / 2,
    TOTAL - arrival + 500,
    TOTAL - arrival - 0.001,
    D + 4_000,
    D,
    HALF_GONE,
    0,
  ];
  const scenes = at.map(
    (remaining) => scene([rider("trip-a", remaining).entry]).scene,
  );
  const xs = scenes.slice(0, -1).map((s) => s.buses[0]!);
  expect(xs.map((b) => b.phase)).toEqual([
    "arriving",
    "arriving",
    "arriving",
    "waiting",
    "waiting",
    "waiting",
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
  // At the stop from its actual arrival to 0:00, doors open, clock still shared.
  expect([xs[3]!.x, xs[4]!.x, xs[5]!.x]).toEqual([slot, slot, slot]);
  expect(xs[3]!.doorsOpen && xs[5]!.doorsOpen).toBe(true);
  expect(xs[3]!.remaining).toBeCloseTo(30_000 - arrival, 2);
  expect(xs[5]!.remaining).toBe(0);
  // Pulling away, doors shut; off the map exactly when the close commits.
  const { layout } = scene([]);
  expect(xs[6]!.doorsOpen).toBe(false);
  expect(xs[6]!.x).toBeGreaterThan(slot);
  expect(xs[6]!.x).toBeLessThan(layout.width * T);
  expect(scenes[7]!.buses).toEqual([]);
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

test("a short countdown's bus still completes its approach within 3 s", () => {
  const short = (remaining: number) =>
    scene([rider("trip-s", remaining, 10_000).entry]).scene.buses[0]!;
  const total = 10_000 + BIN_DEPARTURE_MS;
  expect(arrivalMs(10_000)).toBeLessThanOrEqual(3_000);
  expect(short(total - arrivalMs(10_000) / 2).phase).toBe("arriving");
  expect(short(total - 3_000).phase).toBe("waiting");
});

test("held while driving in, the bus stops where it is", () => {
  const remaining = TOTAL - arrivalMs() / 2;
  const moving = scene([rider("trip-h", remaining).entry]).scene.buses[0]!;
  const held = scene([rider("trip-h2", remaining).entry], { paused: true })
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

test("with every stop, reduced motion parks the bus at the terminus whoever rides", () => {
  const { layout } = layoutTown(town(3), "wide");
  const terminus = townBusRoute(layout.busStops, layout.width * T).stops.slice(
    -1,
  )[0]!;
  for (const home of [layout.busStops[0]!.id, layout.busStop.id]) {
    const s = townBusScene({
      stops: layout.busStops,
      width: layout.width * T,
      entries: [rider("trip-rm", TOTAL - 100).entry],
      homeStop: () => home,
      remaining: (entry) => entry.remaining_ms,
      paused: false,
      reducedMotion: true,
    });
    expect([s.buses[0]!.x, s.buses[0]!.y]).toEqual([
      terminus.busX,
      terminus.busY,
    ]);
  }
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

test("a crowded bus seats eight, counts the rest as +N, and is found under the pointer", () => {
  const entries = [
    // All at the stop (inside the last 10 s of their countdowns).
    ...Array.from({ length: 41 }, () => rider("trip-big", 14_000).entry),
  ];
  const { scene: s, layout } = scene(entries, {}, 2);
  // One departure, one bus.
  expect(s.buses).toHaveLength(1);
  const seated = s.buses[0]!.riders;
  expect(seated).toHaveLength(BUS_SEATS.length);
  expect(s.buses[0]!.extra).toBe(entries.length - BUS_SEATS.length);
  for (const bus of s.buses) {
    expect(bus.x).toBeGreaterThanOrEqual(0);
    expect(bus.x + BUS_W).toBeLessThanOrEqual(layout.width * T);
  }
  for (const r of seated)
    expect(townBusRiderAt(s, r.x + 4, r.y + 4)).toBe(r.entryId);
  for (const bus of s.buses) {
    expect(townBusHitAt(s, bus.x + 30, bus.y + 20)).toBe(bus);
    expect(inTownBusDropZone(s, bus.x + 30, bus.y + 20)).toBe(true);
  }
  expect(inTownBusDropZone(s, s.stop.x + 5, s.stop.y + 20)).toBe(true);
});

test("the edge chip reads the soonest departure's wait", () => {
  const a = rider("trip-e", 12_000 + BIN_DEPARTURE_MS).entry;
  const b = rider("trip-e", 12_000 + BIN_DEPARTURE_MS).entry;
  const c = rider("trip-f", 25_000).entry;
  const { layout, scene: s } = scene([c, a, b]);
  expect(s.next).toEqual({
    remaining: 12_000,
    leaving: false,
    riders: 2,
    // Where its bus waits: the terminus.
    stop: { x: layout.busStop.x * T + T / 2, y: layout.busStop.y * T + T },
  });
  expect(scene([]).scene.next).toBeNull();
});

test("a boarding reset preserves the original approach speed and arrival", () => {
  const elapsed = arrivalMs() / 2;
  const entry: BinEntry = rider("trip-r", TOTAL - elapsed).entry;
  entry.trip_duration_ms = 30_000;
  entry.trip_elapsed_ms = elapsed;
  const before = scene([entry]).scene.buses[0]!;
  expect(before.phase).toBe("arriving");
  const at = (ms: number) =>
    scene([
      {
        ...entry,
        remaining_ms: TOTAL - ms,
        trip_elapsed_ms: elapsed + ms,
      },
    ]).scene.buses[0]!;
  // The clock is full again: it is where it was, not back at the map's edge.
  expect(at(0).x).toBeCloseTo(before.x, 6);
  expect(at(0).speed).toBeCloseTo(before.speed, 6);
  expect(at(0).phase).toBe("arriving");
  const original = scene([
    {
      ...entry,
      remaining_ms: TOTAL - elapsed - 1_000,
      trip_elapsed_ms: elapsed + 1_000,
    },
  ]).scene.buses[0]!;
  expect(at(1_000).x).toBeCloseTo(original.x, 6);
  const arrived = at(arrivalMs() - elapsed + 0.001);
  expect(arrived.x).toBeCloseTo(before.home, 6);
  expect(arrived.phase).toBe("waiting");
  // A bus already at the stop just keeps waiting.
  const waiting = scene([
    { ...entry, remaining_ms: TOTAL, trip_elapsed_ms: arrivalMs() + 1 },
  ]).scene.buses[0]!;
  expect([waiting.phase, waiting.x]).toEqual(["waiting", before.home]);
});

test("reset at 0:01 while one second out arrives in one second and waits 29 seconds", () => {
  // A second reset has extended the wait: this bus is still one second out
  // even though the departure clock currently shows 0:01.
  const entry = {
    ...rider("trip-near", BIN_DEPARTURE_MS + 1_000).entry,
    trip_duration_ms: 30_000,
    trip_elapsed_ms: arrivalMs() - 1_000,
  };
  const near = scene([entry]).scene.buses[0]!;
  const at = (ms: number) =>
    scene([
      {
        ...entry,
        remaining_ms: TOTAL - ms,
        trip_elapsed_ms: entry.trip_elapsed_ms + ms,
      },
    ]).scene.buses[0]!;
  const reset = at(0);
  expect(reset.x).toBeCloseTo(near.x, 6);
  expect(reset.speed).toBeCloseTo(near.speed, 6);
  expect(at(999).phase).toBe("arriving");
  for (const ms of [1_001, 15_000, 29_999, 30_000]) {
    expect(at(ms).phase).toBe("waiting");
    expect(at(ms).x).toBe(near.home);
  }
  expect(at(30_001).phase).toBe("departing");
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
  expect(on!.run.speedAt(0) * 1000).toBeGreaterThanOrEqual(
    leaving.speed - 1e-6,
  );
});

test("buses still riding, off the map, or under reduced motion never become leavers", () => {
  const { layout, scene: s } = scene([rider("trip-k", TOTAL - 20_000).entry]);
  const width = layout.width * T;
  const seen = townBusSeen(s.buses);
  expect(townBusLeavers(seen, s.buses, width, 0, false)).toEqual([]);
  expect(townBusLeavers(seen, [], width, 0, true)).toEqual([]);
  const gone = scene([rider("trip-g", 0).entry]).scene.buses;
  expect(gone).toEqual([]);
  expect(townBusLeavers(townBusSeen(gone), [], width, 0, false)).toEqual([]);
  const offLeft = scene([rider("trip-o", TOTAL).entry]).scene.buses;
  expect(offLeft[0]!.x + BUS_W).toBeLessThanOrEqual(0);
  expect(townBusLeavers(townBusSeen(offLeft), [], width, 0, false)).toEqual([]);
});

// Late riders (owner try 2026-11-06): every rider waits at its own stop until
// the bus stands there; the bus laps again for anyone it has passed.
describe("late riders wait at their own stop and the bus comes round", () => {
  const D = 30_000;
  const { layout } = layoutTown(town(3), "wide");
  const width = layout.width * T;
  const route = townBusRoute(layout.busStops, width);
  const table = townBusTimetable(route, D);
  const lap = table.durationMs;
  const slot = (k: number) => table.stops[k]!;
  const terminus = table.stops[table.stops.length - 1]!;
  type Ride = { id: string; stop: number; joined: number };
  /** The scene `e` ms into the trip, as the service would publish it. */
  const at = (
    e: number,
    rides: Ride[],
    extra: Partial<TownBusInput> & { resetMs?: number } = {},
  ) => {
    const reset = Math.max(extra.resetMs ?? 0, ...rides.map((r) => r.joined));
    return townBusScene({
      stops: layout.busStops,
      width,
      entries: rides.map(
        (r): BinEntry => ({
          id: r.id,
          connection_id: "studio",
          connection_generation: 1,
          workspace_id: `w-${r.stop}`,
          tab_id: r.id,
          pane_id: r.id,
          terminal_id: `term-${r.id}`,
          label: r.id,
          view: "town",
          duration_ms: D,
          departure_ms: BIN_DEPARTURE_MS,
          // Every join restarts the shared countdown (the service's rule).
          remaining_ms: D + BIN_DEPARTURE_MS - (e - reset),
          trip: "trip",
          trip_duration_ms: D,
          trip_elapsed_ms: e,
          trip_joined_ms: r.joined,
        }),
      ),
      homeStop: (entry) => route.stops[Number(entry.workspace_id.slice(2))]!.id,
      remaining: (entry) => entry.remaining_ms,
      paused: false,
      reducedMotion: false,
      ...extra,
    });
  };
  const waitingAt = (scene: ReturnType<typeof at>, k: number) =>
    scene.stops[k]!.waiting.map((r) => r.entryId);
  const aboard = (scene: ReturnType<typeof at>) =>
    scene.buses.flatMap((bus) => bus.riders.map((r) => r.entryId));
  const standingAt = (scene: ReturnType<typeof at>, k: number) =>
    scene.buses[0]?.x === route.stops[k]!.busX &&
    scene.buses[0]?.y === route.stops[k]!.busY;

  test("1: B, put at stop 3 after the bus passed it, stands there until the bus laps back for it", () => {
    expect(route.stops.length).toBeGreaterThanOrEqual(4);
    const joined = slot(3).leaveMs + 50;
    const rides = [
      { id: "A", stop: 1, joined: 0 },
      { id: "B", stop: 3, joined },
    ];
    // Right after joining, B stands at stop 3: it never vanishes into the bus.
    expect(waitingAt(at(joined + 1, rides), 3)).toEqual(["B"]);
    expect(aboard(at(joined + 1, rides))).toEqual(["A"]);
    // The bus does not pull away at the terminus: it laps back to stop 3.
    const pickup = lap + slot(3).arriveMs + 1;
    expect(at(lap - 1, rides).buses[0]?.phase).not.toBe("departing");
    const there = at(pickup, rides);
    expect(standingAt(there, 3)).toBe(true);
    expect(aboard(there).sort()).toEqual(["A", "B"]);
    expect(waitingAt(there, 3)).toEqual([]);
    // Picked up before 0:00, which the join restarted.
    expect(pickup).toBeLessThan(joined + D);
  });

  test("2: B, put at stop 3 while the bus waits at the terminus, makes the bus pull away and come round", () => {
    const joined = terminus.arriveMs + 2_000;
    const rides = [
      { id: "A", stop: 1, joined: 0 },
      { id: "B", stop: 3, joined },
    ];
    // Until then the bus waits at the terminus; at the join it is still there.
    const before = at(joined - 1, [rides[0]!]).buses[0]!;
    const atJoin = at(joined, rides).buses[0]!;
    expect(atJoin.y).toBe(before.y);
    expect(Math.abs(atJoin.x - before.x)).toBeLessThan(0.01);
    expect(waitingAt(at(joined + 1, rides), 3)).toEqual(["B"]);
    // It pulls away now, comes round and stands at stop 3 for B.
    const lapStart = joined + lap - terminus.leaveMs;
    const pickup = lapStart + slot(3).arriveMs + 1;
    const there = at(pickup, rides);
    expect(standingAt(there, 3)).toBe(true);
    expect(aboard(there).sort()).toEqual(["A", "B"]);
    expect(pickup).toBeLessThan(joined + D);
  });

  test("3: three riders at three stops at three times all board within one countdown", () => {
    const tB = slot(2).leaveMs + 10; // passed stop 2 on lap 0
    const tC = lap + slot(1).leaveMs + 10; // passed stop 1 on lap 1
    const rides = [
      { id: "A", stop: 0, joined: 0 },
      { id: "B", stop: 2, joined: tB },
      { id: "C", stop: 1, joined: tC },
    ];
    expect(waitingAt(at(tC + 1, rides), 1)).toEqual(["C"]);
    // B rides from lap 1; C from lap 2.
    expect(aboard(at(lap + slot(2).arriveMs + 1, rides)).sort()).toEqual([
      "A",
      "B",
    ]);
    const end = tC + D;
    const last = 2 * lap + slot(1).arriveMs + 1;
    expect(last).toBeLessThan(end);
    expect(aboard(at(last, rides)).sort()).toEqual(["A", "B", "C"]);
    // At 0:00 everyone is aboard as it pulls away; nobody is left waiting.
    const leaving = at(end + 1, rides);
    expect(leaving.buses[0]?.phase).toBe("departing");
    expect(aboard(leaving).sort()).toEqual(["A", "B", "C"]);
    expect(leaving.waiting).toEqual([]);
  });

  test("4: a rider put back during a lap: the bus keeps its lap and only makes its usual pause there", () => {
    const joined = slot(3).leaveMs + 50;
    const both = [
      { id: "A", stop: 1, joined: 0 },
      { id: "B", stop: 3, joined },
    ];
    const onlyA = [both[0]!];
    // B is put back during the lap; the countdown's reset stays.
    for (let e = lap; e <= lap + slot(3).leaveMs + 500; e += 50) {
      const kept = at(e, onlyA, { resetMs: joined }).buses[0];
      const ridden = at(e, both).buses[0];
      expect([kept?.x, kept?.y]).toEqual([ridden?.x, ridden?.y]);
    }
    // At stop 3 it stands only its usual dwell, empty.
    const stood = [];
    for (let e = lap; e <= lap + slot(3).leaveMs + 500; e += 10)
      if (standingAt(at(e, onlyA, { resetMs: joined }), 3)) stood.push(e);
    expect(stood.length * 10).toBeLessThanOrEqual(table.dwellMs + 20);
    expect(stood.length * 10).toBeGreaterThanOrEqual(table.dwellMs - 20);
  });

  test("5: under reduced motion riders show at their stops and the bus parks", () => {
    const rides = [
      { id: "A", stop: 1, joined: 0 },
      { id: "B", stop: 3, joined: slot(3).leaveMs + 50 },
    ];
    const s = at(slot(3).leaveMs + 100, rides, { reducedMotion: true });
    expect(waitingAt(s, 1)).toEqual(["A"]);
    expect(waitingAt(s, 3)).toEqual(["B"]);
    const terminusStop = route.stops[route.stops.length - 1]!;
    expect([s.buses[0]?.x, s.buses[0]?.y]).toEqual([
      terminusStop.busX,
      terminusStop.busY,
    ]);
  });
});
