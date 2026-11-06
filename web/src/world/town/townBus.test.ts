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
    for (const building of layout.buildings)
      for (const room of building.rooms) {
        const at = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
        const stop = nearestTownStop(route, at)!;
        const d = (p: { x: number; y: number }) =>
          Math.abs(p.x - at.x) + Math.abs(p.y - at.y);
        expect(d(stop)).toBe(Math.min(...route.stops.map(d)));
        const path = townOutdoorPath(
          layout,
          { x: building.entryX, y: building.y - 1 },
          stop,
        );
        expect(path.length).toBeGreaterThan(0);
        expect(path[path.length - 1]).toEqual([stop.x, stop.y]);
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
