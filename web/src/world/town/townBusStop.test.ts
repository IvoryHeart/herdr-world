import { expect, test } from "bun:test";
import { layoutTown, TownGround } from "./townLayout";
import {
  nearestTownBusStop,
  TOWN_ROAD_BAND,
  townBusStops,
  type TownBusStop,
} from "./townBusStop";

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

test("every crossing has a stop on its street's pavement, in road order, one main", () => {
  for (const [hosts, shape] of [
    [1, "wide"],
    [4, "wide"],
    [7, "wide"],
    [3, "narrow"],
  ] as const) {
    const { layout } = layoutTown(town(hosts), shape);
    const { busStops, roads, verticalRoads, width } = layout;
    for (const road of roads)
      for (const v of verticalRoads)
        if (v.y1 === road || v.y0 === road + TOWN_ROAD_BAND)
          expect(
            busStops.some(
              (s) => s.road === road && s.x > v.x && s.x <= v.x + 8,
            ),
          ).toBe(true);
    busStops.forEach((stop, order) => {
      expect(stop.order).toBe(order);
      expect(stop.id).toBe(`${stop.road}:${stop.x}`);
      expect(roads).toContain(stop.road);
      expect(layout.ground[stop.y * width + stop.x]).toBe(TownGround.walk);
      for (const lamp of layout.lamps)
        expect(
          Math.abs(lamp.x - stop.x) <= 2 && Math.abs(lamp.y - stop.y) <= 1,
        ).toBe(false);
    });
    const sorted = [...busStops].sort((a, b) => a.road - b.road || a.x - b.x);
    expect(sorted.map((s) => s.id)).toEqual(busStops.map((s) => s.id));
    expect(new Set(busStops.map((s) => s.id)).size).toBe(busStops.length);
    expect(busStops.filter((s) => s.main)).toHaveLength(1);
    expect(layout.busStop.main).toBe(true);
    expect(layout.busStop).toEqual(
      nearestTownBusStop(busStops, {
        x: layout.width / 2,
        y: layout.height / 2,
      }),
    );
  }
});

test("the main stop is the one nearest the centre; ties go to road order", () => {
  const stops = townBusStops(
    [10, 30],
    [
      { x: 4, y0: 15, y1: 30 },
      { x: 30, y0: 15, y1: 30 },
    ],
    { width: 80, height: 40 },
    3,
  );
  expect(stops.map((s) => s.id)).toEqual(["10:10", "10:36", "30:10", "30:36"]);
  // Centre (40, 20): 10:36 and 30:36 are equally near; the earlier wins.
  expect(stops.find((s) => s.main)?.id).toBe("10:36");
  const tie: TownBusStop[] = stops.map((s) => ({ ...s, main: false }));
  expect(nearestTownBusStop(tie, { x: 36, y: 20 }).id).toBe("10:36");
  expect(nearestTownBusStop(tie, { x: 12, y: 29 }).id).toBe("30:10");
});

test("a stop steps past a door's path onto its pavement; no crossing keeps one stop", () => {
  const [stop] = townBusStops(
    [10],
    [{ x: 4, y0: 2, y1: 10 }],
    { width: 60, height: 30 },
    3,
    [{ x: 10, y: 10 }],
  );
  expect(stop!.x).toBe(12);
  const lone = townBusStops([10], [], { width: 60, height: 30 }, 3);
  expect(lone).toHaveLength(1);
  expect(lone[0]).toMatchObject({ road: 10, main: true, order: 0 });
});
