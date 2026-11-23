import { expect, test } from "bun:test";
import {
  BIN_BUS_SPEED_KMH,
  binBusTripMs,
  type BinEntry,
} from "../../../../shared/bin";
import {
  TOWN_QUEUE_ROW,
  TOWN_QUEUE_ROWS,
  TOWN_STOP_SPACING,
  townBinRiders,
  townBusRoute,
  townNearestStop,
  townQueueMoreLeft,
  townQueueShape,
  townQueueSpot,
  townRiderFirstOuting,
  townRiderOuting,
  townRiderReturns,
  townRiderWalk,
  townRiderWalkBack,
  townRiderWalkMs,
  townWalkAlong,
  townWalkLength,
  townBusSign,
  townTourRouteM,
  TOWN_METRES_PER_PX,
  type TownBusRoute,
  type TownBusStop,
} from "./townBus";
import {
  TOWN_BUS_DWELL_MS,
  TOWN_BUS_IN_BEFORE_END_S,
  townBusDoor,
  townBusLeft,
  townBusPose,
  townBusTimeline,
  townBusWay,
} from "./townBusDrive";
import { townApartmentsDoor, townApartmentsLot } from "./townApartmentsLot";
import { TownGround, type TownLayout, type TownShape } from "./townLayout";
import { TOWN_WALK_SPEED } from "./townActors";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import type { TownModel } from "./townModel";
import { townHarbourLot } from "./townHarbour";

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

const shapes = [
  TOWN_SHAPES.phone,
  TOWN_SHAPES.portrait,
  TOWN_SHAPES.medium,
  TOWN_SHAPES.wide,
];
const towns: Record<string, number[]>[] = [
  { a: [2] },
  { a: [3, 2], b: [1] },
  { a: [2], b: [2], c: [1], d: [1], e: [2] },
  // A shorter last row, and a wider one below a narrower one.
  Object.fromEntries([..."abcdefgh"].map((key) => [key, [1]])),
  { a: [1], b: [1], c: [1], d: [1], e: [1, 1, 1, 1] },
  // Stacked buildings a tile or two different in width (#889).
  { a: [3, 2], b: [1], c: [2, 2, 2], d: [2, 2] },
];

test("every road crossing has a stop, and the bus halts on its street for it", () => {
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const crossings: { x: number; road: number }[] = [];
      for (const road of layout.roads)
        for (const side of layout.verticalRoads)
          if (side.y0 === road + 5 || side.y1 === road)
            crossings.push({ x: side.x, road });
      const stopAt = (stop: TownBusStop) => {
        const [x, road] = stop.key.split(":").map(Number);
        return { x: x!, road: road! };
      };
      // Each stop stands at a crossing, and each crossing has a stop on its
      // street: its own, or one fewer than TOWN_STOP_SPACING tiles away that
      // it shares (stacked buildings of slightly different widths).
      for (const stop of route.stops)
        expect(crossings).toContainEqual(stopAt(stop));
      for (const crossing of crossings)
        expect(
          route.stops.some((stop) => {
            const at = stopAt(stop);
            return (
              at.road === crossing.road &&
              Math.abs(at.x - crossing.x) < TOWN_STOP_SPACING
            );
          }),
        ).toBe(true);
      // Stops on one street stand far enough apart for their queues.
      for (const a of route.stops)
        for (const b of route.stops)
          if (a !== b && stopAt(a).road === stopAt(b).road)
            expect(Math.abs(stopAt(a).x - stopAt(b).x)).toBeGreaterThanOrEqual(
              TOWN_STOP_SPACING,
            );
      // The leftmost junctions too: each edge road meets both its streets
      // at a stop, on the map (two rows' edge roads a tile apart share one).
      const edges = layout.verticalRoads.filter((side) => side.edge);
      expect(edges.length).toBeGreaterThan(0);
      for (const side of edges)
        for (const road of [side.y0 - 5, side.y1]) {
          const stop = route.stops.find((s) => {
            const at = stopAt(s);
            return (
              at.road === road && Math.abs(at.x - side.x) < TOWN_STOP_SPACING
            );
          });
          expect(stop).toBeDefined();
          expect(stop!.wait.x).toBeGreaterThan(0);
        }
      // The bus halts for each on its street's lanes, short of the
      // crossing and wholly on the map, short of the harbour's promenade.
      for (const stop of route.stops) {
        const [, road] = stop.key.split(":").map(Number);
        expect(stop.halt.y).toBe((road! + 2.5) * T);
        expect(stop.halt.x).toBeLessThan(stop.wait.x);
        expect(stop.halt.x).toBeGreaterThanOrEqual(32);
        expect(stop.halt.x).toBeLessThanOrEqual(
          townHarbourLot(layout).streetEnd * T - 32,
        );
      }
    }
});

const groundAt = (layout: TownLayout, x: number, y: number) =>
  layout.ground[Math.floor(y / T) * layout.width + Math.floor(x / T)];

test("every town's bus lives at Apartments: it parks on the last street, by a footpath to the door", () => {
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const { terminus } = townBusRoute(layout);
      const lot = townApartmentsLot(layout)!;
      expect(lot).not.toBeNull();
      expect(terminus).not.toBeNull();
      expect(terminus!.to).toBe("apartments");
      const last = Math.max(...layout.roads);
      expect(terminus!.halt.y).toBe((last + 2.5) * T);
      expect(terminus!.halt.x).toBeGreaterThanOrEqual(32);
      expect(terminus!.halt.x).toBeLessThanOrEqual(
        townHarbourLot(layout).streetEnd * T - 32,
      );
      // Its door (facing right, parked) opens onto the footpath's kerb.
      expect(townBusDoor(terminus!.halt, "right", terminus!.kerb.y)).toEqual(
        terminus!.kerb,
      );
      // The walk in keeps to pavement and plaza and ends at the door.
      const walk = terminus!.walk;
      expect(walk[walk.length - 1]).toEqual(townApartmentsDoor(lot));
      const length = townWalkLength(walk);
      for (let d = 0; d < length - 6; d += 4) {
        const at = townWalkAlong(walk, d);
        expect<number[]>([TownGround.walk, TownGround.plaza]).toContain(
          groundAt(layout, at.x, at.y),
        );
      }
      expect(townWalkAlong(walk, length + 1)).toMatchObject({
        ...walk[walk.length - 1],
        walking: false,
      });
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

/** The halts a trip makes at `stops`, as TownBusLayer asks for them. */
const haltsAt = (stops: readonly TownBusStop[]) =>
  stops.map((stop) => ({ key: stop.key, at: stop.halt }));
const walkOf = (route: TownBusRoute) =>
  townWalkLength(route.terminus!.walk) / TOWN_WALK_SPEED;

test("the bus drives from Apartments to each stop with riders by road, waits there with its doors open and brings them back", () => {
  const TRIP = 120_000;
  const RIDERS = 3;
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const terminus = route.terminus!;
      const halting = route.stops
        .filter((_, index) => index % 2 === 0)
        .slice(0, 4);
      const walk = walkOf(route);
      const timeline = townBusTimeline(
        route.graph,
        terminus.halt,
        haltsAt(halting),
        RIDERS,
        walk,
        TRIP,
      );
      const pose = (s: number) =>
        townBusPose(timeline, terminus.halt, s * 1000);
      // Parked at Apartments as the trip starts and as it ends.
      for (const s of [0, TRIP / 1000])
        expect(pose(s)).toMatchObject({
          ...terminus.halt,
          facing: "right",
          moving: false,
          doors: false,
        });
      // It never leaves the map or the roads (the streets end at the
      // harbour's promenade), and never jumps.
      let previous = pose(0);
      for (let s = 0; s <= TRIP / 1000; s += 0.1) {
        const now = pose(s);
        expect(now.x).toBeGreaterThanOrEqual(0);
        expect(now.x).toBeLessThanOrEqual(townHarbourLot(layout).streetEnd * T);
        expect(now.y).toBeGreaterThanOrEqual(0);
        expect(now.y).toBeLessThanOrEqual(layout.height * T);
        // Its lanes, or the pavement where a side road meets a street.
        expect<number[]>([TownGround.road, TownGround.walk]).toContain(
          groundAt(layout, now.x, now.y),
        );
        expect(
          Math.hypot(now.x - previous.x, now.y - previous.y),
        ).toBeLessThanOrEqual(timeline.cruise * 0.1 * 1.05 + 1e-6);
        previous = now;
      }
      expect(timeline.cruise).toBeLessThanOrEqual(400);
      // It stands at each stop with riders for about 10 s, its doors open.
      for (const stop of halting) {
        const halt = timeline.halts.get(stop.key)!;
        expect(halt).toBeDefined();
        expect(halt.point).toEqual(stop.halt);
        expect(pose(halt.at + 0.01)).toMatchObject({
          ...stop.halt,
          moving: false,
        });
        expect(pose((halt.open + halt.close) / 2).doors).toBe(true);
        expect(halt.close - halt.at).toBeLessThanOrEqual(
          TOWN_BUS_DWELL_MS / 1000,
        );
        expect(halt.close - halt.at).toBeGreaterThan(5);
        // It slows to the stop: in the last half second it barely moves.
        const before = pose(halt.at - 0.5);
        expect(
          Math.hypot(before.x - stop.halt.x, before.y - stop.halt.y),
        ).toBeLessThan(timeline.cruise * 0.3);
      }
      // Back at Apartments, it faces the footpath and its riders step off;
      // the last is in just before the trip ends and they close.
      const { arrive } = timeline;
      expect(arrive.point).toEqual(terminus.halt);
      expect(arrive.facing).toBe("right");
      expect(pose(arrive.open + 0.1).doors).toBe(true);
      expect(arrive.open + (RIDERS - 1) * arrive.step + walk).toBeCloseTo(
        TRIP / 1000 - TOWN_BUS_IN_BEFORE_END_S,
        6,
      );
    }
});

test("the bus takes the nearest way round its stops", () => {
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const halts = haltsAt(route.stops.slice(0, 5));
      const way = townBusWay(route.graph, route.terminus!.halt, halts);
      expect([...way.order].sort()).toEqual(halts.map((h) => h.key).sort());
      expect(way.legs).toHaveLength(halts.length + 1);
      // One round is never longer than a trip out and back for each stop.
      const alone = halts.map(
        (halt) => townBusWay(route.graph, route.terminus!.halt, [halt]).length,
      );
      expect(way.length).toBeLessThanOrEqual(
        alone.reduce((a, b) => a + b, 0) + 1e-6,
      );
      expect(way.length).toBeGreaterThanOrEqual(Math.max(...alone) - 1e-6);
      // Each leg runs along a street or a side road, a turn at a time.
      for (const leg of way.legs)
        for (let i = 1; i < leg.length; i += 1)
          expect(
            leg[i]!.x === leg[i - 1]!.x || leg[i]!.y === leg[i - 1]!.y,
          ).toBe(true);
    }
});

test("many stops with riders share under half the trip, so the bus still drives it", () => {
  const { layout } = layoutTown(
    town(Object.fromEntries([..."abcdefgh"].map((key) => [key, [1]]))),
    TOWN_SHAPES.wide,
  );
  const route = townBusRoute(layout);
  const timeline = townBusTimeline(
    route.graph,
    route.terminus!.halt,
    haltsAt(route.stops),
    12,
    walkOf(route),
    120_000,
  );
  expect(timeline.halts.size).toBe(route.stops.length);
  const dwells = [...timeline.halts.values()].reduce(
    (sum, halt) => sum + (halt.close - halt.open),
    0,
  );
  expect(dwells).toBeLessThanOrEqual(120 * 0.4);
  expect(townBusPose(timeline, route.terminus!.halt, 120_000)).toMatchObject(
    route.terminus!.halt,
  );
});

test("World times the bus by the tour Town measures, and Town drives it at about that speed", () => {
  // 36 km/h is 10 m a second; a tile is 2 m.
  const speed = BIN_BUS_SPEED_KMH / 3.6 / TOWN_METRES_PER_PX;
  expect(speed).toBe(80);
  for (const shape of shapes)
    for (const hosts of towns) {
      const { layout } = layoutTown(town(hosts), shape);
      const route = townBusRoute(layout);
      const terminus = route.terminus!;
      const single = (stop: TownBusStop) =>
        townTourRouteM(route, [stop])!.route_m;
      // One stop at a time, and each stop with the next one along.
      const trips = [
        ...route.stops.map((stop) => [stop]),
        ...route.stops.slice(1).map((stop, i) => [route.stops[i]!, stop]),
      ];
      for (const stops of trips) {
        // A stop named twice is one halt.
        const tour = townTourRouteM(route, [...stops, stops[0]!])!;
        expect(tour.stops).toBe(stops.length);
        // The bus's own way past them all, not the farthest one's.
        const way = townBusWay(route.graph, terminus.halt, haltsAt(stops));
        expect(tour.route_m).toBe(Math.round(way.length * TOWN_METRES_PER_PX));
        expect(tour.route_m).toBeGreaterThanOrEqual(
          Math.max(...stops.map(single)) - 1,
        );
        const trip = binBusTripMs(tour.route_m, tour.stops);
        const timeline = townBusTimeline(
          route.graph,
          terminus.halt,
          haltsAt(stops),
          1,
          walkOf(route),
          trip,
        );
        // The plate counts World's route down: the whole of it at the
        // start, less as it goes, none once the bus is back.
        expect(townBusLeft(timeline, 0)).toBe(1);
        let previous = Infinity;
        for (let ms = 0; ms <= trip; ms += 250) {
          const left = townBusLeft(timeline, ms);
          expect(left).toBeLessThanOrEqual(previous + 1e-9);
          previous = left;
        }
        expect(townBusLeft(timeline, trip)).toBe(0);
        // Out along a street it drives at about the bus's speed. (Its
        // allowances for pulling away, turning and stepping off are a few
        // seconds, so on a short hop it takes the spare time gently.)
        expect(timeline.cruise).toBeLessThanOrEqual(speed * 1.15);
        if (tour.route_m >= 200)
          expect(timeline.cruise).toBeGreaterThanOrEqual(speed * 0.85);
      }
      // A stop farther along the roads is a longer route and a longer trip.
      const [near, far] = route.stops.map(single).sort((a, b) => a - b);
      if (far !== undefined && far > near!)
        expect(binBusTripMs(far, 1)).toBeGreaterThan(binBusTripMs(near!, 1));
    }
});

test("every layout shows World's route: a trip measured on a wide Town reads the same distance on a phone", () => {
  const hosts = Object.fromEntries([..."abcdefgh"].map((key) => [key, [1]]));
  const wide = townBusRoute(layoutTown(town(hosts), TOWN_SHAPES.wide).layout);
  const phone = townBusRoute(layoutTown(town(hosts), TOWN_SHAPES.phone).layout);
  // World keeps the wide page's measure of the tour past two stops.
  const measured = townTourRouteM(wide, wide.stops.slice(0, 2))!;
  const trip = binBusTripMs(measured.route_m, measured.stops);
  // The phone draws its own roads, fitted to the same trip, and its plate
  // reads World's metres, not its own.
  const own = townTourRouteM(phone, phone.stops.slice(0, 2))!;
  expect(own.route_m).not.toBe(measured.route_m);
  const timeline = townBusTimeline(
    phone.graph,
    phone.terminus!.halt,
    haltsAt(phone.stops.slice(0, 2)),
    1,
    walkOf(phone),
    trip,
  );
  const plate = (ms: number) =>
    townBusSign(
      BIN_BUS_SPEED_KMH,
      measured.route_m * townBusLeft(timeline, ms),
      "left",
    );
  expect(plate(0)).toBe(
    townBusSign(BIN_BUS_SPEED_KMH, measured.route_m, "left"),
  );
  expect(plate(trip)).toBe(`${BIN_BUS_SPEED_KMH} km/h · 0 m left`);
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

test("a stop's +N board counts only those not yet aboard and comes down when the bus takes them", () => {
  const { entries, place } = crowd(30, shapes[0]!);
  const riders = place(entries);
  const stop = riders[0]!.stop;
  const { more } = townQueueShape(stop, riders.length);
  expect(more).toBeGreaterThan(0);
  expect(townQueueMoreLeft(riders, new Set()).get(stop.key)).toBe(more);
  // The bus takes the whole queue: the board has no one left to count.
  const all = new Set(riders.map((rider) => rider.entry.id));
  expect(townQueueMoreLeft(riders, all).has(stop.key)).toBe(false);
  // Those who joined after the bus set off still wait, and the board
  // counts just them.
  const late = riders.filter((rider) => rider.counted).slice(-3);
  const aboard = new Set(
    riders.filter((rider) => !late.includes(rider)).map((r) => r.entry.id),
  );
  expect(townQueueMoreLeft(riders, aboard).get(stop.key)).toBe(late.length);
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
