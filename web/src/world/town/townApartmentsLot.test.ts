import { expect, test } from "bun:test";
import { townBusRoute } from "./townBus";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
  type TownInput,
  type TownShape,
} from "./townLayout";
import {
  townApartmentsLot,
  townApartmentsPathColumn,
  townApartmentsReserve,
} from "./townApartmentsLot";
import { MARGIN } from "./townLots";

const town = (spec: Record<string, number[]>): TownInput => ({
  hosts: Object.keys(spec).map((key, displayOrder) => ({ key, displayOrder })),
  rooms: Object.entries(spec).flatMap(([hostKey, rooms]) =>
    rooms.map((desks, order) => ({
      key: `${hostKey}/${order}`,
      hostKey,
      order,
      deskKeys: Array.from(
        { length: desks },
        (_, d) => `${hostKey}/${order}/${d}`,
      ),
    })),
  ),
});

const towns: [string, TownInput, TownShape | "narrow"][] = [
  ["empty, wide", town({}), TOWN_SHAPES.wide],
  ["empty, phone", town({}), "narrow"],
  ["one building, phone", town({ a: [1] }), "narrow"],
  // A phone's civic row widens its town (#1351).
  [
    "three buildings, phone",
    town({ a: [2], b: [1], c: [4] }),
    TOWN_SHAPES.phone,
  ],
  ["one tall building", town({ a: [3, 3, 2, 2, 1, 1] }), TOWN_SHAPES.medium],
  [
    "two streets",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    TOWN_SHAPES.wide,
  ],
];

test.each(towns)(
  "the apartment building stands in the park beside the plaza (%s), on clear land",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const lot = townApartmentsLot(layout)!;
    expect(lot).not.toBeNull();
    const area = townApartmentsReserve(lot);
    // Inside the town, below the last street, its door on the plaza's walk.
    expect(area.x0).toBeGreaterThanOrEqual(MARGIN - 1);
    expect(area.x1).toBeLessThanOrEqual(layout.width - MARGIN + 1);
    expect(lot.y).toBeGreaterThan(Math.max(...layout.roads) + 4);
    expect(lot.y + lot.h).toBe(layout.plaza.y);
    // Only grass under it: no road, walk, plaza or building, but for the
    // footpath beside it from the bus's stop down to the plaza's walk.
    const path = townApartmentsPathColumn(lot, layout.plaza);
    for (let ty = area.y0; ty < area.y1; ty += 1)
      for (let tx = area.x0; tx < area.x1; tx += 1)
        expect(layout.ground[ty * layout.width + tx]).toBe(
          tx === path && ty < layout.plaza.y
            ? TownGround.walk
            : TownGround.grass,
        );
    // Nothing else stands on it.
    const inside = (x: number, y: number) =>
      x >= area.x0 && x < area.x1 && y >= area.y0 && y < area.y1;
    for (const item of [
      ...layout.benches,
      ...layout.bushes,
      ...layout.lamps,
      layout.board,
    ])
      expect(inside(item.x, item.y)).toBe(false);
    for (const stop of townBusRoute(layout).stops)
      expect(
        inside(Math.floor(stop.wait.x / T), Math.floor(stop.wait.y / T)),
      ).toBe(false);
  },
);
