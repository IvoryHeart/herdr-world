import { expect, test } from "bun:test";
import { BIN_BUS_DRIVE_MS } from "../../../../shared/bin";
import { layoutTown, TOWN_SHAPES, TownGround } from "./townLayout";
import {
  townBusRoute,
  nearestTownStop,
  townRiderHidden,
  townOutdoorPath,
  type TownTransit,
} from "./townBus";
for (const shape of Object.values(TOWN_SHAPES)) {
  test(`the ${shape.formFactor}/${shape.roomColumns} route visits every intersection on roads and exits the map`, () => {
    const { layout } = layoutTown(
      {
        hosts: ["a", "b", "c"].map((key, displayOrder) => ({
          key,
          displayOrder,
        })),
        rooms: ["a", "b", "c"].flatMap((hostKey) =>
          Array.from({ length: 5 }, (_, order) => ({
            key: `${hostKey}-${order}`,
            hostKey,
            order,
            deskKeys: [`${hostKey}-${order}-desk`],
          })),
        ),
      },
      shape,
    );
    const route = townBusRoute(layout);
    const intersections = new Set(
      layout.verticalRoads.flatMap((road) => [
        `${road.x + 2},${road.y0 - 3}`,
        `${road.x + 2},${road.y1 + 2}`,
      ]),
    );
    expect(new Set(route.stops.map((stop) => stop.key))).toEqual(intersections);
    expect(new Set(route.pickups.keys())).toEqual(intersections);
    expect(route.points[0]!.x).toBeLessThan(0);
    expect(route.points[route.points.length - 1]!.x).toBeLessThan(0);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!,
        b = route.points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      const count = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      for (let j = 0; j <= count; j++) {
        const x = a.x + Math.sign(b.x - a.x) * j,
          y = a.y + Math.sign(b.y - a.y) * j;
        if (x >= 0 && x < layout.width)
          expect<number[]>([TownGround.road, TownGround.walk]).toContain(
            layout.ground[y * layout.width + x]!,
          );
      }
    }
    for (const building of layout.buildings) {
      const exit = { x: building.entryX, y: building.y - 1 };
      const stop = nearestTownStop(layout, route, exit)!;
      const path = townOutdoorPath(layout, exit, stop);
      expect(path.length).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual([stop.x, stop.y]);
      const reachable = route.stops
        .map((candidate) => townOutdoorPath(layout, exit, candidate).length)
        .filter((length) => length > 0);
      expect(path.length).toBe(Math.min(...reachable));
      for (const [x, y] of path)
        expect([
          TownGround.building,
          TownGround.facade,
          TownGround.lot,
        ]).not.toContain(layout.ground[y * layout.width + x]);
    }
    const stop = route.stops[0]!;
    const transit: TownTransit = {
      route,
      waiting: new Map([["a", stop]]),
      riders: new Set(["a"]),
      bus: {
        cycle: 1,
        driving: true,
        remaining_ms: BIN_BUS_DRIVE_MS,
        elapsed_ms: 0,
      },
      readAt: 100,
    };
    expect(townRiderHidden("a", transit, 100)).toBe(false);
    expect(townRiderHidden("a", transit, 100 + BIN_BUS_DRIVE_MS)).toBe(true);
    expect(townRiderHidden("b", transit, 100 + BIN_BUS_DRIVE_MS)).toBe(false);
    expect(
      townRiderHidden(
        "a",
        {
          ...transit,
          bus: { ...transit.bus!, driving: false },
          departed: new Set(["a"]),
        },
        100,
      ),
    ).toBe(true);
  });
}

test("stop selection follows walkable distance from the exit, including detours and unreachable stops", () => {
  const layout = {
    width: 7,
    height: 7,
    ground: new Uint8Array(49).fill(TownGround.walk),
  } as ReturnType<typeof layoutTown>["layout"];
  for (let y = 1; y < 7; y++) layout.ground[y * 7 + 2] = TownGround.building;
  const near = { key: "near", x: 3, y: 2, roadX: 3, roadY: 2 };
  const shortWalk = { key: "short", x: 1, y: 5, roadX: 1, roadY: 5 };
  const route = {
    stops: [near, shortWalk],
    points: [],
    length: 0,
    pickups: new Map(),
  };
  const exit = { x: 1, y: 2 };
  expect(nearestTownStop(layout, route, exit)).toEqual(shortWalk);
  layout.ground[2] = TownGround.building;
  expect(nearestTownStop(layout, route, exit)).toEqual(shortWalk);
  expect(nearestTownStop(layout, { ...route, stops: [near] }, exit)).toBeNull();
});
