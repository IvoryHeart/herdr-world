import { expect, test } from "bun:test";
import type { BinEntry } from "../../../../shared/bin";
import {
  townBinRiders,
  townBusAt,
  townBusRoute,
  townNearestStop,
} from "./townBus";
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
    y: building.y * T,
  });
});
