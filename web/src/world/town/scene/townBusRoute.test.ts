import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../../shared/bin";
import { BUS_W } from "../townBusGeometry";
import { townBusStops } from "../townBusStop";
import { townBusScene } from "./townBus";
import {
  BUS_BRAKE,
  BUS_GAP,
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
const at = (id: string) => route.stops.find((s) => s.id === id)!.at;
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
  expect(remount.riders).toEqual(live.riders);
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

test("late joins keep home until it leaves, then use the next stop or the holding final", () => {
  const between = (slot("10:10").leaveMs + slot("10:36").arriveMs) / 2;
  const ahead = plan([rider("a", "30:36"), rider("late", "10:10", between)]);
  expect(ahead.riders.find((r) => r.entryId === "late")!.stop).toBe("10:36");
  const nearEnd = slot("30:36").arriveMs - timetable.rampMs / 2;
  const last = plan([rider("a", "30:36"), rider("late", "10:10", nearEnd)]);
  expect(last.riders.find((r) => r.entryId === "late")!.stop).toBe("30:36");
  for (const joined of [slot("10:36").leaveMs, slot("10:36").leaveMs + 500]) {
    const there = plan([rider("a", "10:36"), rider("late", "30:36", joined)]);
    expect(there.riders.find((r) => r.entryId === "late")!.stop).toBe("10:36");
  }
  const early = plan([rider("a", "10:10"), rider("late", "30:36", 1_000)]);
  expect(early.riders.find((r) => r.entryId === "late")!.stop).toBe("30:36");
});

test("late riders at or behind the final stop board throughout its final brake", () => {
  const final = "10:36";
  const founder = rider("a", final);
  const end = slot(final).arriveMs;
  for (const time of [
    end - timetable.rampMs,
    end - timetable.rampMs / 2,
    end - 0.001,
  ]) {
    expect(timetableAt(timetable, time).at).toBeLessThan(at(final));
    for (const home of [final, "10:10"]) {
      const p = plan([founder, rider("late", home, time)]);
      expect(p.riders.find((r) => r.entryId === "late")!.stop).toBe(final);
      expect(p.final!.id).toBe(final);
      expect(townBusPosition(p, time)).toEqual(
        townBusPosition(plan([founder]), time),
      );
    }
  }
});

test("an orphaned late rider returns to its home after the founder is put back", () => {
  const founder = rider("a", "10:36");
  const arrival = slot("10:36").leaveMs;
  const late = rider("c", "10:10", arrival + 500);
  expect(
    plan([founder, late]).riders.find((r) => r.entryId === "c")!.stop,
  ).toBe("10:36");
  const orphan = plan([late]);
  expect(orphan.riders[0]!.stop).toBe(late.home);
  const returned = townBusPosition(orphan, arrival + 2_500);
  expect(returned).toMatchObject({
    at: at(late.home),
    arrived: true,
    visible: true,
    atStop: late.home,
  });
  expect(
    townBusPosition(plan(structuredClone([late])), arrival + 2_500),
  ).toEqual(returned);
  // Accepted tradeoff: it returns home even if the old assigned stop was ahead.
  const farFounder = rider("a", "30:36");
  const between = (slot("10:10").leaveMs + slot("10:36").arriveMs) / 2;
  const ahead = rider("c", "10:10", between);
  expect(
    plan([farFounder, ahead]).riders.find((r) => r.entryId === "c")!.stop,
  ).toBe("10:36");
  expect(plan([ahead]).riders[0]!.stop).toBe(ahead.home);
  const next = rider("d", "10:36", arrival + 3_000);
  expect(plan([late, next]).riders.map((r) => r.stop)).toEqual([
    late.home,
    late.home,
  ]);
});

test("extending the final during its brake or normal dwell has zero position or speed jump", () => {
  const founder = rider("a", "10:36");
  const before = plan([founder]);
  const f = slot("10:36");
  for (const joined of [
    f.arriveMs - timetable.rampMs / 2,
    f.arriveMs,
    f.arriveMs + timetable.dwellMs / 2,
    f.leaveMs - 0.001,
  ]) {
    const after = plan([founder, rider("late", "30:36", joined)]);
    expect(after.final!.id).toBe("30:36");
    const a = townBusPosition(before, joined),
      b = townBusPosition(after, joined);
    expect([b.at, b.x, b.y, b.speed]).toEqual([a.at, a.x, a.y, a.speed]);
    expect(
      townBusPosition(after, f.leaveMs + timetable.rampMs / 2).at,
    ).toBeGreaterThan(at("10:36"));
  }
  const locked = plan([founder, rider("late", "30:36", f.leaveMs)]);
  expect(locked.final!.id).toBe("10:36");
});

test("after the final stop's riders are put back the bus waits at the earlier stop, exactly as a trip that always ended there", () => {
  const t = 18_000;
  const putBack = plan([rider("a", "10:36")]);
  const always = plan([rider("a", "10:36")]);
  const before = plan([rider("a", "10:36"), rider("b", "30:36")]);
  const was = townBusPosition(before, t);
  const now = townBusPosition(putBack, t);
  expect(now).toEqual(townBusPosition(always, t));
  expect(now.arrived).toBe(true);
  expect(now.at).toBe(at("10:36"));
  expect(now.visible).toBe(true);
  // It went back along the route (the layer drives the old one off and
  // fades this one in).
  expect(now.at).toBeLessThan(was.at);
});

test("no riders: no plan to drive, and the scene has no bus", () => {
  const empty = plan([]);
  expect(empty.final).toBeNull();
  expect(empty.occupied).toEqual([]);
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

test("every empty stop and street through F is visible, standing with doors open, and nothing after F is visited", () => {
  const p = plan([rider("a", "30:36")]);
  for (const stop of timetable.stops) {
    const position = townBusPosition(p, (stop.arriveMs + stop.leaveMs) / 2);
    expect(position.visible).toBe(true);
    expect(position.at).toBe(stop.at);
    expect(position.speed).toBe(0);
    expect(position.atStop).toBe(stop.id);
    expect(position.arrived).toBe(stop.id === "30:36");
  }
  const earlier = plan([rider("a", "10:36")]);
  for (const time of [
    slot("10:36").leaveMs,
    slot("30:10").arriveMs,
    DURATION,
  ]) {
    expect(townBusPosition(earlier, time)).toMatchObject({
      at: at("10:36"),
      arrived: true,
      atStop: "10:36",
      speed: 0,
      visible: true,
    });
  }
});

test("nine riders ride a convoy: the follower runs BUS_W + gap behind on the same clock", () => {
  const riders = Array.from({ length: 9 }, (_, i) =>
    rider(`r${i}`, i < 5 ? "10:36" : "30:36"),
  );
  const p = plan(riders);
  for (const t of [
    2_000,
    6_000,
    (slot("10:36").arriveMs + slot("10:36").leaveMs) / 2,
    DURATION,
  ]) {
    const lead = townBusPosition(p, t, 0);
    const follower = townBusPosition(p, t, 1);
    expect(follower.at).toBeCloseTo(lead.at - (BUS_W + BUS_GAP), 6);
    expect(follower.speed).toBe(lead.speed);
    expect(follower.atStop).toBe(lead.atStop);
  }
  const entries = riders.map(
    (r, i): BinEntry => ({
      id: r.entryId,
      label: `Agent ${i}`,
      trip: "t",
      view: "town",
      duration_ms: DURATION,
      departure_ms: BIN_DEPARTURE_MS,
      remaining_ms: DURATION + BIN_DEPARTURE_MS - 2_000,
      trip_duration_ms: DURATION,
      trip_elapsed_ms: 2_000,
      trip_joined_ms: 0,
      connection_id: "c",
      connection_generation: 1,
      workspace_id: "w",
      tab_id: "t",
      pane_id: `p${i}`,
      terminal_id: `x${i}`,
    }),
  );
  const scene = townBusScene({
    stops,
    width: WIDTH,
    entries,
    homeStop: (e) => riders.find((r) => r.entryId === e.id)!.home,
    remaining: (e) => e.remaining_ms,
    paused: false,
    reducedMotion: false,
  });
  expect(scene.buses.map((bus) => bus.key)).toEqual(["t#0", "t#1"]);
  expect(scene.buses[1]!.at).toBeCloseTo(
    scene.buses[0]!.at - (BUS_W + BUS_GAP),
    6,
  );
  expect(scene.stopOf.size).toBe(9);
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

test("a late rider boards its own intermediate stop throughout the remaining dwell, then uses the next stop at leave", () => {
  const home = slot("10:36"),
    founder = rider("a", "30:36");
  for (const joined of [
    home.arriveMs,
    (home.arriveMs + home.leaveMs) / 2,
    home.leaveMs - 0.001,
  ]) {
    const p = plan([founder, rider("late", home.id, joined)]);
    expect(p.riders.find((r) => r.entryId === "late")!.stop).toBe(home.id);
    expect(townBusPosition(p, joined).atStop).toBe(home.id);
    const behind = plan([founder, rider("late", "10:10", joined)]);
    expect(behind.riders.find((r) => r.entryId === "late")!.stop).toBe(home.id);
  }
  const after = plan([founder, rider("late", home.id, home.leaveMs)]);
  expect(after.riders.find((r) => r.entryId === "late")!.stop).toBe("30:10");
});
