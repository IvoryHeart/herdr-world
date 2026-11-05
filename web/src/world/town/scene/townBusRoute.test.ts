import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../../../shared/bin";
import { BUS_W } from "../townBusGeometry";
import { townBusStops } from "../townBusStop";
import { townBusScene } from "./townBus";
import {
  BUS_BRAKE,
  BUS_GAP,
  busApproachMs,
  townBusEase,
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
  const speed = route.length / busApproachMs(DURATION);
  const founders = plan([rider("a", "10:36"), rider("b", "30:36")]);
  const joined = plan([
    rider("a", "10:36"),
    rider("b", "30:36"),
    rider("c", "30:10", 12_000),
  ]);
  const putBack = plan([rider("b", "30:36")]);
  for (const p of [founders, joined, putBack]) expect(p.speed).toBe(speed);
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

test("a late rider whose stop the bus has passed waits at the next stop ahead, else the final stop", () => {
  const speed = plan([]).speed;
  // The bus has passed 10:10 but not 10:36 at this join.
  const between = (at("10:10") + at("10:36")) / 2 / speed;
  const ahead = plan([rider("a", "30:36"), rider("late", "10:10", between)]);
  expect(ahead.riders.find((r) => r.entryId === "late")?.stop).toBe("10:36");
  // Passed every stop but still cruising to the final one: the next stop
  // ahead is the final one.
  const nearEnd = (at("30:36") - BUS_BRAKE) / speed;
  const last = plan([rider("a", "30:36"), rider("late", "10:10", nearEnd)]);
  expect(last.riders.find((r) => r.entryId === "late")?.stop).toBe("30:36");
  // Already waiting at its final stop: the late rider joins it there.
  const waiting = (at("10:36") + BUS_BRAKE) / speed;
  const there = plan([rider("a", "10:36"), rider("late", "30:36", waiting)]);
  expect(there.riders.find((r) => r.entryId === "late")?.stop).toBe("10:36");
  // A late rider whose stop is still ahead keeps its own stop.
  const early = plan([rider("a", "10:10"), rider("late", "30:36", 1_000)]);
  expect(early.riders.find((r) => r.entryId === "late")?.stop).toBe("30:36");
});

test("late riders at or behind the final stop join the drawn bus throughout its final brake", () => {
  const final = "10:36";
  const founder = rider("a", final);
  const speed = plan([founder]).speed;
  for (const d of [at(final), at(final) + 10, at(final) + BUS_BRAKE / 2 - 1]) {
    expect(townBusEase(d, at(final))).toBeLessThan(at(final));
    for (const home of [final, "10:10"]) {
      const p = plan([founder, rider("late", home, d / speed)]);
      expect(p.riders.find((r) => r.entryId === "late")!.stop).toBe(final);
      expect(p.final!.id).toBe(final);
      expect(townBusPosition(p, d / speed)).toEqual(
        townBusPosition(plan([founder]), d / speed),
      );
    }
  }
});

test("an orphaned late rider returns to its home after the founder is put back", () => {
  const founder = rider("a", "10:36");
  const speed = plan([founder]).speed;
  const arrival = (at("10:36") + BUS_BRAKE / 2) / speed;
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
  const between = (at("10:10") + at("10:36")) / 2 / speed;
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

test("moving the final stop ahead mid-brake moves the bus at most half the brake", () => {
  const finalAt = at("10:36");
  const further = at("30:36");
  let worst = 0;
  for (let d = finalAt - BUS_BRAKE; d <= finalAt + BUS_BRAKE / 2; d += 1)
    worst = Math.max(
      worst,
      Math.abs(townBusEase(d, further) - townBusEase(d, finalAt)),
    );
  expect(worst).toBeLessThanOrEqual(BUS_BRAKE / 2 + 1e-9);
  expect(worst).toBeGreaterThan(0);
  // Never backwards, and it stops exactly at the stop.
  for (let d = 0; d < finalAt + BUS_BRAKE; d += 3)
    expect(townBusEase(d + 3, finalAt)).toBeGreaterThanOrEqual(
      townBusEase(d, finalAt),
    );
  expect(townBusEase(finalAt + BUS_BRAKE, finalAt)).toBe(finalAt);
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

test("an empty stop on a street with riders shows nothing: no stop, no doors, nobody waiting", () => {
  const p = plan([rider("a", "10:36")]);
  // Rolling past the empty 10:10 on the occupied first street.
  const t = at("10:10") / p.speed;
  const position = townBusPosition(p, t);
  expect(position.visible).toBe(true);
  expect(position.atStop).toBeNull();
  expect(position.at).toBe(at("10:10"));
  // Rolling past an occupied intermediate stop opens the doors but keeps
  // the canonical position: no slowing.
  const two = plan([rider("a", "10:10"), rider("b", "10:36")]);
  const past = townBusPosition(two, at("10:10") / two.speed);
  expect(past.atStop).toBe("10:10");
  expect(past.at).toBe(at("10:10"));
  // A street without riders is driven off the map.
  const lower = plan([rider("a", "30:36")]);
  expect(townBusPosition(lower, at("10:36") / lower.speed).visible).toBe(false);
});

test("nine riders ride a convoy: the follower runs BUS_W + gap behind on the same clock", () => {
  const riders = Array.from({ length: 9 }, (_, i) =>
    rider(`r${i}`, i < 5 ? "10:36" : "30:36"),
  );
  const p = plan(riders);
  for (const t of [2_000, 6_000]) {
    const lead = townBusPosition(p, t, 0);
    const follower = townBusPosition(p, t, 1);
    expect(follower.at).toBeCloseTo(lead.at - (BUS_W + BUS_GAP), 6);
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
