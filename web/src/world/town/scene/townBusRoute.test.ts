import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../../shared/bin";
import { BUS_W } from "../townBusGeometry";
import { townBusStops } from "../townBusStop";
import { townBusScene } from "./townBus";
import {
  BUS_BRAKE,
  BUS_RAMP,
  BUS_STOP_MS,
  BUS_STOP_SHARE,
  busApproachMs,
  townBusAt as timetableAt,
  townBusTimetable,
  townBusPlan,
  townBusPosition,
  townBusRoute,
  type TownBusRiderInput,
} from "./townBusRoute";

// Two streets (rows 10 and 30), two crossings each: stops 10:10, 10:36,
// 30:10, 30:36 in road order.
const stops = townBusStops(
  [10, 30],
  [
    { x: 4, y0: 15, y1: 30 },
    { x: 30, y0: 15, y1: 30 },
  ],
  { width: 80, height: 40 },
  3,
);
const WIDTH = 80 * 16;
const route = townBusRoute(stops, WIDTH);
const DURATION = 30_000;
const timetable = townBusTimetable(route, DURATION);
const slot = (id: string) => timetable.stops.find((s) => s.id === id)!;
const plan = (riders: TownBusRiderInput[]) =>
  townBusPlan({ route, tripDurationMs: DURATION, riders });
const rider = (
  entryId: string,
  home: string,
  joinedMs = 0,
): TownBusRiderInput => ({ entryId, home, joinedMs });

test("the canonical route runs every street with a stop, left to right, in road order", () => {
  expect(route.legs.map((leg) => leg.road)).toEqual([10, 30]);
  expect(route.legLength).toBe(WIDTH + BUS_W);
  expect(route.length).toBe(2 * (WIDTH + BUS_W));
  expect(route.stops.map((s) => s.id)).toEqual([
    "10:10",
    "10:36",
    "30:10",
    "30:36",
  ]);
  const ats = route.stops.map((s) => s.at);
  expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  expect(route.stops[2]!.leg).toBe(1);
});

test("the speed is fixed by the trip's countdown alone: joins and Put backs never change it", () => {
  const speed = timetable.speed;
  const founders = plan([rider("a", "10:36"), rider("b", "30:36")]);
  const joined = plan([
    rider("a", "10:36"),
    rider("b", "30:36"),
    rider("c", "30:10", 12_000),
  ]);
  const putBack = plan([rider("b", "30:36")]);
  for (const p of [founders, joined, putBack]) {
    expect(p.speed).toBe(speed);
    expect(p.timetable).toEqual(timetable);
  }
  // Mid-cruise the bus stands at the same place in all three.
  const t = 4_000;
  expect(townBusPosition(joined, t).at).toBe(townBusPosition(founders, t).at);
  expect(townBusPosition(putBack, t).at).toBe(townBusPosition(founders, t).at);
});

test("a remount replays the same plan and position, whatever order the entries arrive in", () => {
  const riders = [
    rider("a", "10:10"),
    rider("b", "30:36"),
    rider("c", "10:10", 9_000),
    rider("d", "30:10", 9_000),
  ];
  const live = plan(riders);
  const remount = plan([...riders].reverse());
  expect([...remount.riders].reverse()).toEqual(live.riders);
  expect(remount.final?.id).toBe(live.final!.id);
  for (const t of [0, 5_000, 15_000, 25_000])
    expect(townBusPosition(remount, t)).toEqual(townBusPosition(live, t));
});

test("a rider without a join time (older service) counts as a set-off rider", () => {
  const entry = {
    id: "a",
    label: "Agent A",
    trip: "t",
    view: "town",
    duration_ms: DURATION,
    departure_ms: BIN_DEPARTURE_MS,
    remaining_ms: DURATION + BIN_DEPARTURE_MS,
    trip_duration_ms: DURATION,
    trip_elapsed_ms: 0,
    connection_id: "c",
    connection_generation: 1,
    workspace_id: "w",
    tab_id: "t",
    pane_id: "p",
    terminal_id: "x",
  } satisfies BinEntry;
  const scene = townBusScene({
    stops,
    width: WIDTH,
    entries: [entry],
    homeStop: () => "10:10",
    remaining: (e) => e.remaining_ms,
    paused: false,
    reducedMotion: false,
  });
  expect(scene.stopOf.get("a")).toBe("10:10");
});

test("riders who need no second lap never change the bus's place; a Put back keeps a lap it bought", () => {
  // Set-off riders, and joins before the bus leaves the first stop, all
  // ride one lap: the bus is where the timetable alone puts it.
  const early = slot("10:10").leaveMs - 1;
  const sets = [
    [rider("a", "10:10")],
    [rider("a", "30:36")],
    [rider("a", "10:36"), rider("b", "30:10", early)],
  ].map(plan);
  for (let t = 0; t <= DURATION + 1; t += 250) {
    const first = townBusPosition(sets[0]!, t);
    for (const p of sets) expect(townBusPosition(p, t)).toEqual(first);
  }
  // A join after the first stop buys a second lap; putting that rider back
  // keeps it (the trip's countdown reset outlives the rider), so the bus
  // does not move.
  const late = slot("10:36").leaveMs + 1;
  const joined = townBusPlan({
    route,
    tripDurationMs: DURATION,
    riders: [rider("a", "30:36"), rider("b", "10:10", late)],
    resetMs: late,
  });
  const putBack = townBusPlan({
    route,
    tripDurationMs: DURATION,
    riders: [rider("a", "30:36")],
    resetMs: late,
  });
  expect(joined.laps).toHaveLength(2);
  expect(putBack.laps).toEqual(joined.laps);
  for (let t = late; t <= late + 2 * timetable.durationMs; t += 250)
    expect(townBusPosition(putBack, t)).toEqual(townBusPosition(joined, t));
});

test("every rider waits at its own stop and boards the bus's first stand there after it joined", () => {
  const home = slot("10:36");
  const T = timetable.durationMs;
  for (const joined of [
    0,
    home.arriveMs - 1,
    home.arriveMs,
    home.leaveMs - 1,
  ]) {
    const p = plan([rider("late", "10:36", joined)]);
    expect(p.riders[0]!.stop).toBe("10:36");
    expect(p.riders[0]!.boardMs).toBe(Math.max(home.arriveMs, joined));
  }
  // Passed: it still waits at home, and the next lap picks it up.
  for (const joined of [
    home.leaveMs,
    home.leaveMs + 1,
    slot("30:36").arriveMs,
  ]) {
    const p = plan([rider("late", "10:36", joined)]);
    expect(p.riders[0]!.stop).toBe("10:36");
    expect(p.laps).toEqual([0, T]);
    expect(p.riders[0]!.boardMs).toBe(T + home.arriveMs);
    expect(townBusPosition(p, T + home.arriveMs + 1)).toMatchObject({
      at: home.at,
      atStop: "10:36",
    });
  }
  // An unknown home is the main stop.
  const main = route.stops.find((stop) => stop.main)!.id;
  expect(plan([rider("x", "nowhere")]).riders[0]!.stop).toBe(main);
});

test("no riders: the scene has no bus", () => {
  const scene = townBusScene({
    stops,
    width: WIDTH,
    entries: [],
    remaining: () => 0,
    paused: false,
    reducedMotion: false,
  });
  expect(scene.buses).toEqual([]);
  expect(scene.waiting).toEqual([]);
  expect(scene.stops.every((stop) => stop.riders === 0)).toBe(true);
});

test("the bus stands at every stop, empty or not, and never passes the terminus before 0:00", () => {
  const p = plan([rider("a", "10:10")]);
  for (const stop of timetable.stops) {
    const position = townBusPosition(p, (stop.arriveMs + stop.leaveMs) / 2);
    expect(position.visible).toBe(true);
    expect(position.at).toBe(stop.at);
    expect(position.speed).toBe(0);
    expect(position.atStop).toBe(stop.id);
  }
  const terminus = timetable.stops.slice(-1)[0]!;
  // It reaches the terminus within the approach, then waits there.
  expect(terminus.arriveMs).toBeLessThanOrEqual(busApproachMs(DURATION));
  let last = 0;
  for (let t = 0; t <= DURATION; t += 100) {
    const position = townBusPosition(p, t);
    expect(position.at).toBeGreaterThanOrEqual(last);
    expect(position.at).toBeLessThanOrEqual(terminus.at);
    last = position.at;
  }
  for (const t of [terminus.leaveMs, busApproachMs(DURATION), DURATION])
    expect(townBusPosition(p, t)).toMatchObject({
      at: terminus.at,
      arrived: true,
      atStop: terminus.id,
      speed: 0,
      visible: true,
    });
});

test("every stop gets a positive bounded dwell and the whole timetable fits exactly its original approach", () => {
  expect(BUS_STOP_MS).toBe(1_000);
  expect(BUS_STOP_SHARE).toBe(0.5);
  expect(BUS_RAMP).toBe(96);
  expect(BUS_BRAKE).toBe(2 * BUS_RAMP);
  const many = townBusRoute(
    Array.from({ length: 19 }, (_, i) => ({
      id: `10:${12 + i * 16}`,
      order: i,
      main: i === 9,
      x: 12 + i * 16,
      y: 10,
      road: 10,
      queueStart: 1,
    })),
    5_120,
  );
  const tight = townBusRoute(
    [
      {
        id: "10:0",
        order: 0,
        main: true,
        x: 0,
        y: 10,
        road: 10,
        queueStart: 1,
      },
      {
        id: "10:1",
        order: 1,
        main: false,
        x: 1,
        y: 10,
        road: 10,
        queueStart: 1,
      },
    ],
    64,
  );
  for (const r of [route, many, tight])
    for (const duration of [10_000, 30_000, 60_000, 120_000]) {
      const clock = townBusTimetable(r, duration);
      const n = r.stops.length,
        window = busApproachMs(duration);
      expect(clock.durationMs).toBe(window);
      expect(clock.stops.map((s) => s.id)).toEqual(r.stops.map((s) => s.id));
      expect(clock.dwellMs).toBe(Math.min(1_000, (0.5 * window) / n));
      expect(clock.dwellMs).toBeGreaterThan(0);
      expect(n * clock.dwellMs).toBeLessThanOrEqual(window / 2);
      expect(clock.speed).toBe(
        (r.length + 2 * clock.ramp * n) / (window - n * clock.dwellMs),
      );
      expect(clock.ramp).toBeGreaterThan(0);
      expect(clock.ramp).toBeLessThanOrEqual(BUS_RAMP);
      expect(clock.rampMs).toBe((2 * clock.ramp) / clock.speed);
      for (const stop of clock.stops) {
        expect(stop.leaveMs - stop.arriveMs).toBeCloseTo(clock.dwellMs, 8);
        expect(stop.arriveMs).toBeLessThan(window);
        expect(timetableAt(clock, (stop.arriveMs + stop.leaveMs) / 2)).toEqual({
          at: stop.at,
          speed: 0,
          standing: stop.id,
        });
      }
      const last = clock.stops[clock.stops.length - 1]!;
      expect(
        last.leaveMs +
          clock.rampMs +
          (r.length - last.at - clock.ramp) / clock.speed,
      ).toBeCloseTo(window, 8);
      expect(timetableAt(clock, window).at).toBeCloseTo(r.length, 8);
    }
  expect(townBusTimetable(many, 10_000).dwellMs).toBeCloseTo(78.947368421, 8);
  expect(townBusTimetable(many, 30_000).dwellMs).toBeCloseTo(526.315789474, 8);
  expect(townBusTimetable(many, 60_000).dwellMs).toBe(1_000);
  expect(townBusTimetable(tight, DURATION).ramp).toBe(4);
});

test("every slot is continuous and monotone, with actual brake and pull-away ramps", () => {
  const { rampMs: tau, speed: v, ramp: r } = timetable;
  const epsilon = 0.001;
  let previous = -Infinity;
  const samples = [
    0,
    timetable.durationMs,
    ...timetable.stops.flatMap((s) => [
      s.arriveMs - tau,
      s.arriveMs - tau / 2,
      s.arriveMs,
      s.leaveMs,
      s.leaveMs + tau / 2,
      s.leaveMs + tau,
    ]),
  ].sort((a, b) => a - b);
  for (const time of samples) {
    const pose = timetableAt(timetable, time);
    expect(pose.at).toBeGreaterThanOrEqual(previous - 1e-9);
    expect(pose.speed).toBeGreaterThanOrEqual(0);
    expect(pose.speed).toBeLessThanOrEqual(v + 1e-9);
    previous = pose.at;
    expect(
      Math.abs(
        timetableAt(timetable, time + epsilon).at -
          timetableAt(timetable, Math.max(0, time - epsilon)).at,
      ),
    ).toBeLessThanOrEqual(2 * epsilon * v + 1e-8);
  }
  for (const s of timetable.stops) {
    const braking = timetableAt(timetable, s.arriveMs - tau / 2);
    expect(braking.at).toBeCloseTo(s.at - r / 4, 8);
    expect(braking.speed).toBeCloseTo(v / 2, 8);
    const leaving = timetableAt(timetable, s.leaveMs + tau / 2);
    expect(leaving.at).toBeCloseTo(s.at + r / 4, 8);
    expect(leaving.speed).toBeCloseTo(v / 2, 8);
  }
  expect(timetableAt(timetable, -1)).toEqual(timetableAt(timetable, 0));
});
