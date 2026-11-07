import { expect, test } from "bun:test";
import type { BinEntry } from "../../../../shared/bin";
import { binClockLabel } from "../bin/binStore";
import {
  TOWN_BUS_DWELL_MS,
  TOWN_QUEUE_ROW,
  TOWN_QUEUE_ROWS,
  townBinRiders,
  townBusAlong,
  townBusAt,
  townBusOpacity,
  townBusRoute,
  townBusTimeline,
  townNearestStop,
  townQueueShape,
  townQueueSpot,
  townRiderFirstOuting,
  townRiderOuting,
  townRiderReturns,
  townRiderWalk,
  townRiderWalkBack,
  townRiderWalkMs,
  townStopClock,
} from "./townBus";
import { TownGround, type TownShape } from "./townLayout";
import { TOWN_WALK_SPEED } from "./townActors";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import type { TownModel } from "./townModel";

const town = (hosts: Record<string, number[]>) => ({
  hosts: Object.keys(hosts).map((key, displayOrder) => ({ key, displayOrder })),
  rooms: Object.entries(hosts).flatMap(([hostKey, counts]) =>
    counts.map((count, order) => ({
      key: `${hostKey}/r${order}`,
      hostKey,
      order,
      deskKeys: Array.from(
        { length: count },
        (_, i) => `${hostKey}/r${order}/t${i}`,
      ),
    })),
  ),
});

const shapes = [TOWN_SHAPES.phone, TOWN_SHAPES.medium, TOWN_SHAPES.wide];
const towns: Record<string, number[]>[] = [
  { a: [2] },
  { a: [3, 2], b: [1] },
  { a: [2], b: [2], c: [1], d: [1], e: [2] },
  // A shorter last row, and a wider one below a narrower one.
  Object.fromEntries([..."abcdefgh"].map((key) => [key, [1]])),
  { a: [1], b: [1], c: [1], d: [1], e: [1, 1, 1, 1] },
];

test("every road crossing has a stop, and the bus passes each on its way off the map", () => {
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const crossings = new Set<string>();
      for (const road of layout.roads)
        for (const side of layout.verticalRoads)
          if (side.y0 === road + 5 || side.y1 === road)
            crossings.add(`${side.x}:${road}`);
      expect(route.stops.map((stop) => stop.key).sort()).toEqual(
        [...crossings].sort(),
      );
      // Every street is driven edge to edge, from off the map to off it.
      expect(route.legs.map((leg) => leg.y)).toEqual(
        [...new Set(layout.roads)]
          .sort((a, b) => a - b)
          .map((r) => (r + 2.5) * T),
      );
      for (const leg of route.legs)
        for (const end of [leg.from, leg.to])
          expect(end < 0 || end > layout.width * T).toBe(true);
      for (const stop of route.stops) {
        expect(stop.at).toBeGreaterThan(0);
        expect(stop.at).toBeLessThan(route.length);
        // The bus is at the stop's crossing when it passes it.
        const bus = townBusAt(route, stop.at);
        expect(
          Math.hypot(bus.x - stop.wait.x, bus.y - stop.wait.y),
        ).toBeLessThanOrEqual(2 * T);
      }
    }
});

test("an agent waits at the stop nearest its room on its front door's street", () => {
  const { layout } = layoutTown(
    town({ a: [2], b: [2], c: [1], d: [1], e: [2] }),
    TOWN_SHAPES.wide,
  );
  const route = townBusRoute(layout);
  for (const building of layout.buildings) {
    const front = Math.max(
      ...layout.roads.filter((road) => road + 5 <= building.y),
    );
    for (const room of building.rooms) {
      const stop = townNearestStop(route, layout, building, room.key)!;
      expect(stop.key.endsWith(`:${front}`)).toBe(true);
      const centre = (room.x + room.w / 2 + 0.5) * T;
      for (const other of route.stops.filter((s) =>
        s.key.endsWith(`:${front}`),
      ))
        expect(Math.abs(stop.wait.x - centre)).toBeLessThanOrEqual(
          Math.abs(other.wait.x - centre),
        );
    }
  }
});

test("bin entries become Town riders by connection, generation and pane", () => {
  const { layout } = layoutTown(town({ a: [2], b: [1] }), TOWN_SHAPES.wide);
  const agent = (
    key: string,
    hostKey: string,
    pane: string,
    generation = 1,
  ) => ({
    key,
    hostKey,
    roomKey: `${hostKey}/r0`,
    currentPaneRef: {
      connectionId: hostKey,
      generation,
      kind: "pane",
      nativeId: pane,
      worldId: pane,
    },
  });
  const model = {
    agents: new Map(
      [agent("x", "a", "p1"), agent("y", "a", "p2"), agent("z", "b", "p3")].map(
        (item) => [item.key, item],
      ),
    ),
  } as unknown as TownModel;
  const entry = (
    id: string,
    connection: string,
    pane: string,
    generation = 1,
  ): BinEntry => ({
    id,
    connection_id: connection,
    connection_generation: generation,
    workspace_id: "w",
    tab_id: "t",
    pane_id: pane,
    terminal_id: `term-${pane}`,
    label: pane,
    view: "town",
    riding: false,
    preserve_tab: false,
  });
  const route = townBusRoute(layout);
  const { away, riders } = townBinRiders(
    [entry("1", "a", "p1"), entry("2", "a", "p2"), entry("3", "a", "p3", 2)],
    [entry("4", "b", "p3")],
    model,
    layout,
    route,
  );
  // An entry on another runtime generation is not this Town agent.
  expect([...away].sort()).toEqual(["x", "y", "z"]);
  expect(riders.map((rider) => [rider.agentKey, rider.slot])).toEqual([
    ["x", 0],
    ["y", 1],
  ]);
  // The second queues beside the first; both left by their building's door.
  const [first, second] = riders;
  expect(first!.stop.key).toBe(second!.stop.key);
  expect(second!.at.x).toBeLessThan(first!.at.x);
  const building = layout.buildings.find((b) => b.hostKey === "a")!;
  expect(first!.door).toEqual({
    x: (building.entryX + 0.5) * T,
    y: (building.y + 1) * T + 13,
  });
});

test("the bus comes in, waits about 10 s at each stop with riders and is off the map as its trip ends", () => {
  const TRIP = 120_000;
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const halting = new Set(
        route.stops
          .filter((_, index) => index % 2 === 0)
          .slice(0, 4)
          .map((s) => s.key),
      );
      const timeline = townBusTimeline(route, halting, TRIP);
      // It has not come in at the start; it is off the map, unseen, at the end.
      expect(townBusAlong(timeline, 0)).toBeNull();
      expect(townBusAlong(timeline, TRIP)).toBe(route.length);
      const end = townBusAt(route, route.length);
      expect(townBusOpacity(route, end.x)).toBe(0);
      const begin = townBusAt(
        route,
        townBusAlong(timeline, timeline.start * 1000)!,
      );
      expect(townBusOpacity(route, begin.x)).toBe(0);
      // It never goes backwards, and is never fast.
      let previous = 0;
      for (let ms = timeline.start * 1000; ms <= TRIP; ms += 100) {
        const along = townBusAlong(timeline, ms)!;
        expect(along).toBeGreaterThanOrEqual(previous - 1e-6);
        expect(along - previous).toBeLessThanOrEqual(
          timeline.cruise * 0.1 + 1e-6,
        );
        previous = along;
      }
      expect(timeline.cruise).toBeLessThanOrEqual(400);
      // It stands at each stop with riders for about 10 s, then goes on.
      for (const stop of route.stops) {
        const halt = timeline.halts.get(stop.key);
        if (!halting.has(stop.key)) continue;
        expect(halt).toBeDefined();
        const at = (s: number) => townBusAlong(timeline, s * 1000)!;
        expect(at(halt!)).toBeCloseTo(stop.at, 3);
        expect(at(halt! + TOWN_BUS_DWELL_MS / 1000 - 0.01)).toBeCloseTo(
          stop.at,
          3,
        );
        // It slows to the stop: in the last half second it barely moves.
        expect(stop.at - at(halt! - 0.5)).toBeLessThan(timeline.cruise * 0.2);
        expect(at(halt! + TOWN_BUS_DWELL_MS / 1000 + 0.5)).toBeGreaterThan(
          stop.at,
        );
      }
    }
});

test("many stops with riders share half the trip, so the bus still drives it", () => {
  const { layout } = layoutTown(
    town(Object.fromEntries([..."abcdefgh"].map((key) => [key, [1]]))),
    TOWN_SHAPES.wide,
  );
  const route = townBusRoute(layout);
  const all = new Set(route.stops.map((stop) => stop.key));
  const timeline = townBusTimeline(route, all, 120_000);
  expect(townBusAlong(timeline, 120_000)).toBe(route.length);
  const dwell = timeline.pieces.find((piece) => !piece.phases.length)!;
  expect(dwell.t1 - dwell.t0).toBeLessThanOrEqual(60 / all.size + 1e-9);
});

test("a binned agent walks out to its stop as it walks indoors, then stands there", () => {
  const door = { x: 100, y: 200 };
  const stop = { x: 40, y: 152 };
  const at = (distance: number) =>
    townRiderWalk(door, stop, distance / TOWN_WALK_SPEED);
  // Up to the pavement first, stepping through the indoor walking frames.
  expect(at(0)).toMatchObject({ x: 100, y: 200, dir: "up", walking: true });
  expect(at(24)).toMatchObject({ x: 100, y: 176, dir: "up", frame: 0 });
  expect(at(30).frame).toBe(1);
  // Then along it, to the left.
  expect(at(68)).toMatchObject({ x: 80, y: 152, dir: "left", walking: true });
  // There, it stands facing out, and keeps standing.
  for (const distance of [108, 500])
    expect(at(distance)).toEqual({
      x: 40,
      y: 152,
      dir: "down",
      frame: 0,
      walking: false,
    });
  expect(townRiderWalk(door, stop, Infinity).walking).toBe(false);
});

test("an agent seen indoors walks out of the door however long it took to reach it", () => {
  const start = { indoors: false, out: null };
  // Not drawn yet, then walking indoors to its front door for a long while
  // (a phone draws fewer frames, so its walk indoors takes longer).
  let outing = townRiderOuting(start, null, 0, false);
  expect(outing).toEqual({ indoors: false, out: null });
  outing = townRiderOuting(outing, false, 1_000, false);
  expect(outing).toEqual({ indoors: true, out: null });
  outing = townRiderOuting(outing, false, 40_000, false);
  // Out of the door: its walk to the stop starts now, and keeps that start.
  outing = townRiderOuting(outing, true, 41_000, false);
  expect(outing).toEqual({ indoors: true, out: 41_000 });
  expect(townRiderOuting(outing, true, 42_000, false).out).toBe(41_000);
  // Already out when Town first draws it (Town opened again): at its stop.
  expect(townRiderOuting(start, true, 5_000, false).out).toBe(-Infinity);
  // Binned on Board, then Town opened: never shown here, it walks from its door.
  expect(
    townRiderOuting(townRiderFirstOuting(false), true, 5_000, false).out,
  ).toBe(5_000);
  // Shown outside before, then Town opened again: at its stop.
  expect(
    townRiderOuting(townRiderFirstOuting(true), true, 5_000, false).out,
  ).toBe(-Infinity);
  // With reduced motion, at its stop too.
  expect(
    townRiderOuting({ indoors: true, out: null }, true, 5_000, true).out,
  ).toBe(-Infinity);
});

test("a stop's clock reads due only just before the bus pulls in there", () => {
  const TRIP = 120_000;
  const { layout } = layoutTown(
    town({ a: [2], b: [2], c: [1] }),
    TOWN_SHAPES.phone,
  );
  const route = townBusRoute(layout);
  const stop = [...route.stops].sort((a, b) => b.at - a.at)[0]!;
  const timeline = townBusTimeline(route, new Set([stop.key]), TRIP);
  const halt = timeline.halts.get(stop.key)!;
  // The trip sets off with the bus off the map: it reaches a stop well after.
  expect(halt).toBeGreaterThan(30);
  const clock = (elapsed: number | null, next = 200_000, riding = true) =>
    townStopClock({
      elapsed,
      next,
      stopped: false,
      riding,
      halt,
      nextHalt: halt,
    });
  // Waiting for the next trip: until it sets off and drives to this stop.
  expect(clock(null, 60_000, false)).toBe(binClockLabel(60_000 + halt * 1000));
  expect(clock(null, 0, false)).not.toBe("due");
  // Riding this trip: it counts down to the bus pulling in here.
  expect(clock(0)).not.toBe("due");
  expect(clock((halt - 10) * 1000)).toBe("0:10");
  expect(clock((halt - 4) * 1000)).toBe("due");
  // Due, the bus is a few seconds away: in sight, slowing to the stop.
  const along = townBusAlong(timeline, (halt - 4) * 1000);
  expect(along).not.toBeNull();
  expect(stop.at - along!).toBeLessThan(timeline.cruise * 5);
  expect(clock((halt + 3) * 1000)).toBe("due");
  expect(
    townStopClock({
      elapsed: 1_000,
      next: 0,
      stopped: true,
      riding: true,
      halt,
      nextHalt: halt,
    }),
  ).toBe("stopped");
});

/** A Town of one host with `count` agents in one room, and their bin entries. */
function crowd(count: number, shape: TownShape = TOWN_SHAPES.wide) {
  const { layout } = layoutTown(town({ a: [count] }), shape);
  const agents = Array.from({ length: count }, (_, i) => ({
    key: `x${i}`,
    hostKey: "a",
    roomKey: "a/r0",
    currentPaneRef: {
      connectionId: "a",
      generation: 1,
      kind: "pane",
      nativeId: `p${i}`,
      worldId: `p${i}`,
    },
  }));
  const model = {
    agents: new Map(agents.map((agent) => [agent.key, agent])),
  } as unknown as TownModel;
  const entries = agents.map(
    (_, i): BinEntry => ({
      id: `e${i}`,
      connection_id: "a",
      connection_generation: 1,
      workspace_id: "w",
      tab_id: "t",
      pane_id: `p${i}`,
      terminal_id: `term-p${i}`,
      label: `p${i}`,
      view: "town",
      riding: false,
      preserve_tab: false,
    }),
  );
  const route = townBusRoute(layout);
  const place = (list: readonly BinEntry[]) =>
    townBinRiders(list, [], model, layout, route).riders;
  return { layout, route, entries, place };
}

test("everyone waiting at a stop stands in its queue, in two rows, then a count", () => {
  for (const shape of shapes) {
    const { layout, entries, place } = crowd(30, shape);
    for (const count of [1, 4, 14, 30]) {
      const riders = place(entries.slice(0, count));
      expect(riders).toHaveLength(count);
      const stop = riders[0]!.stop;
      expect(riders.every((rider) => rider.stop.key === stop.key)).toBe(true);
      const { shown, more } = townQueueShape(stop, count);
      const standing = riders.filter((rider) => !rider.counted);
      // Every one stands while the two rows hold them; past them, all but
      // the queue's last place stand and that place counts the rest.
      expect(standing).toHaveLength(shown);
      expect(shown + more).toBe(count);
      if (count <= stop.row * TOWN_QUEUE_ROWS) expect(more).toBe(0);
      else expect(shown).toBe(stop.row * TOWN_QUEUE_ROWS - 1);
      // Each stands in its own place, in joining order, on the pavement.
      const spots = new Set(standing.map((r) => `${r.at.x},${r.at.y}`));
      expect(spots.size).toBe(shown);
      standing.forEach((rider, slot) => {
        expect(rider.slot).toBe(slot);
        expect(rider.at).toEqual(townQueueSpot(stop, slot));
        const tile =
          layout.ground[
            Math.floor(rider.at.y / T) * layout.width +
              Math.floor(rider.at.x / T)
          ];
        expect(tile).toBe(TownGround.walk);
      });
      for (const rider of riders.filter((r) => r.counted))
        expect(rider.at).toEqual(townQueueSpot(stop, shown));
    }
    // The owner's fourteen all stand in the queue on a roomy street.
    const riders = place(entries.slice(0, 14));
    if (riders[0]!.stop.row === TOWN_QUEUE_ROW)
      expect(riders.every((rider) => !rider.counted)).toBe(true);
  }
});

test("a queue keeps to its pavement, clear of the road, other stops and the map's edge", () => {
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      for (const stop of route.stops) {
        const places = stop.row * TOWN_QUEUE_ROWS;
        for (let slot = 0; slot < places; slot += 1) {
          const at = townQueueSpot(stop, slot);
          // Its feet are on the stop's pavement row, never in the lanes.
          expect(Math.floor(at.y / T)).toBe(Math.floor(stop.wait.y / T));
          expect(at.x).toBeLessThanOrEqual(stop.wait.x);
          expect(at.x - 10).toBeGreaterThanOrEqual(0);
          for (const other of route.stops)
            if (other.wait.y === stop.wait.y && other.wait.x < stop.wait.x)
              // Clear of the sign of the stop along the street.
              expect(at.x - 10).toBeGreaterThanOrEqual(other.wait.x + 28);
        }
      }
    }
});

test("one put back leaves the queue and those behind step up", () => {
  const { entries, place } = crowd(6);
  const before = place(entries);
  const after = place(entries.filter((entry) => entry.id !== "e2"));
  expect(after.map((rider) => rider.entry.id)).toEqual([
    "e0",
    "e1",
    "e3",
    "e4",
    "e5",
  ]);
  const at = (list: typeof before, id: string) =>
    list.find((rider) => rider.entry.id === id)!.at;
  expect(at(after, "e0")).toEqual(at(before, "e0"));
  expect(at(after, "e3")).toEqual(at(before, "e2"));
  expect(at(after, "e5")).toEqual(at(before, "e4"));
  // A new one joins the end.
  const joined = place([...entries.filter((e) => e.id !== "e2"), entries[2]!]);
  expect(joined[joined.length - 1]!.entry.id).toBe("e2");
  expect(joined[joined.length - 1]!.at).toEqual(at(before, "e5"));
});

test("one put back walks home from its place; one the bus took does not", () => {
  const { entries, place } = crowd(3);
  const before = place(entries);
  const outside = () => true;
  const kept = entries.filter((entry) => entry.id !== "e1");
  const after = place(kept);
  const returns = townRiderReturns(
    [],
    before,
    after,
    { entries: kept, closing: [] },
    outside,
    1000,
  );
  expect(returns.map((walk) => walk.rider.agentKey)).toEqual(["x1"]);
  const walk = returns[0]!;
  const { door, at } = walk.rider;
  expect(walk.end - walk.start).toBeCloseTo(townRiderWalkMs(door, at));
  // From its place along the pavement, then down to its front door.
  expect(townRiderWalkBack(door, at, 0)).toMatchObject({
    x: at.x,
    y: at.y,
    walking: true,
  });
  const along = Math.abs(at.x - door.x) / TOWN_WALK_SPEED;
  expect(townRiderWalkBack(door, at, along / 2)).toMatchObject({
    y: at.y,
    dir: door.x < at.x ? "left" : "right",
  });
  expect(
    townRiderWalkBack(door, at, (walk.end - walk.start + 1) / 1000),
  ).toEqual({
    x: door.x,
    y: door.y,
    dir: "up",
    frame: 0,
    walking: false,
  });
  // Home, it is done; binned again, it stops walking home.
  expect(
    townRiderReturns(
      returns,
      after,
      after,
      { entries: kept, closing: [] },
      outside,
      walk.end,
    ),
  ).toEqual([]);
  const again = place(entries);
  expect(
    townRiderReturns(
      returns,
      after,
      again,
      { entries, closing: [] },
      outside,
      1500,
    ),
  ).toEqual([]);
  // The bus took them: they close, and none walks home.
  expect(
    townRiderReturns(
      [],
      before,
      [],
      { entries: [], closing: entries },
      outside,
      1000,
    ),
  ).toEqual([]);
  // One never seen outside has no walk home.
  expect(
    townRiderReturns(
      [],
      before,
      after,
      { entries: kept, closing: [] },
      () => false,
      1000,
    ),
  ).toEqual([]);
});
