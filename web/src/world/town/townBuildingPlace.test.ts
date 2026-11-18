import { expect, test } from "bun:test";
import {
  townBuildingNeighbor,
  townBuildingOrder,
  townBuildingPlacementAt,
  townBuildingPlacements,
  townBuildingSwap,
  townBuildingsReordered,
  townOrderHosts,
  type BuildingPins,
} from "./townBuildingPlace";
import { layoutTown, townShapeFor, type TownInput } from "./townLayout";
import { townFirstLotsPerStreet } from "./townLots";
import { townModelFromProjection } from "./townModel";
import { town, working } from "./scene/townScene.fixture";

const HOSTS = {
  studio: { alpha: working(3), beta: working(1) },
  annex: { gamma: working(2) },
  depot: { delta: working(4), eps: working(2) },
};

function setup(order?: readonly string[]) {
  const model = townModelFromProjection(town(HOSTS));
  const shape = townShapeFor(1440, 900);
  const input: TownInput = order
    ? {
        ...model.input,
        hosts: order.map((key, displayOrder) => ({ key, displayOrder })),
      }
    : model.input;
  return { model, layout: layoutTown(input, shape).layout };
}

test("each lot a building could take keeps every other building on a lot, in order", () => {
  const { layout } = setup();
  const order = townBuildingOrder(layout);
  expect(order).toHaveLength(3);
  const moved = order[0]!;
  const placements = townBuildingPlacements(layout, moved);
  expect(placements.map((p) => p.index)).toEqual([0, 1, 2]);
  expect(placements.map((p) => p.changed)).toEqual([false, true, true]);
  // On its own lot every building stands where it is drawn.
  for (const building of layout.buildings) {
    const lot = placements[0]!.lots.get(building.hostKey)!;
    expect([lot.x, lot.y, lot.w]).toEqual([building.x, building.y, building.w]);
  }
  // Moved last, the others shift one lot along.
  expect(placements[2]!.order).toEqual([order[1], order[2], moved]);
  // No two lots overlap.
  for (const placement of placements) {
    const lots = [...placement.lots.values()];
    for (const [i, a] of lots.entries())
      for (const b of lots.slice(i + 1))
        expect(
          a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.y < b.y + b.h &&
            b.y < a.y + a.h,
        ).toBe(false);
  }
  expect(townBuildingPlacements(layout, "nowhere")).toEqual([]);
});

test("a carried building snaps to the lot nearest its centre", () => {
  const { layout } = setup();
  const moved = townBuildingOrder(layout)[0]!;
  const placements = townBuildingPlacements(layout, moved);
  for (const placement of placements) {
    const lot = placement.lots.get(moved)!;
    const near = townBuildingPlacementAt(
      placements,
      lot.x + lot.w / 2 + 0.4,
      lot.y + lot.h / 2 - 0.4,
    );
    expect(near?.index).toBe(placement.index);
  }
  expect(townBuildingPlacementAt([], 0, 0)).toBeNull();
});

test("Move before and after swap with the neighbour, and stop at the ends", () => {
  const { layout } = setup();
  const [a, b, c] = townBuildingOrder(layout);
  expect(townBuildingNeighbor(layout, a!, -1)).toBeNull();
  expect(townBuildingNeighbor(layout, a!, 1)).toBe(b!);
  expect(townBuildingNeighbor(layout, c!, 1)).toBeNull();
  expect(townBuildingSwap(layout, a!, -1)).toBeNull();
  expect(townBuildingSwap(layout, a!, 1)).toEqual([b, a, c]);
  expect(townBuildingSwap(layout, c!, -1)).toEqual([a, c, b]);
  expect(townBuildingSwap(layout, "nowhere", 1)).toBeNull();
});

test("a new order is a move; a host coming or going is not", () => {
  const { layout } = setup();
  const [a, b, c] = townBuildingOrder(layout);
  const swapped = setup([b!, a!, c!]).layout;
  expect(townBuildingOrder(swapped)).toEqual([b, a, c]);
  expect(townBuildingsReordered(layout, swapped)).toBe(true);
  expect(townBuildingsReordered(layout, setup([a!, b!, c!]).layout)).toBe(
    false,
  );
  const fewer = {
    ...layout,
    buildings: layout.buildings.filter((x) => x.hostKey !== b),
  };
  expect(townBuildingsReordered(layout, fewer)).toBe(false);
  expect(townBuildingsReordered(fewer, layout)).toBe(false);
});

test("saved ranks order the hosts; a host without one takes the next lot", () => {
  const { model } = setup();
  const keys = model.input.hosts.map((host) => host.key);
  const hosts = new Map(keys.map((key) => [key, { connectionId: `c-${key}` }]));
  expect(townOrderHosts(model.input, hosts, { ranks: {} })).toBe(model.input);
  const [a, b, c] = keys;
  // b and a are placed (b first); c is new and goes after them.
  const ordered = townOrderHosts(model.input, hosts, {
    ranks: { [`c-${b}`]: 0, [`c-${a}`]: 1 },
  });
  expect(ordered.hosts).toEqual([
    { key: b, displayOrder: 0 },
    { key: a, displayOrder: 1 },
    { key: c, displayOrder: 2 },
  ]);
  // A rank of a host not shown leaves the others in their saved order.
  const gap = townOrderHosts(model.input, hosts, {
    ranks: { "c-gone": 0, [`c-${c}`]: 1, [`c-${a}`]: 2 },
  });
  expect(gap.hosts.map((host) => host.key)).toEqual([c, a, b]);
  const { layout } = setupFrom(ordered);
  expect(townBuildingOrder(layout)).toEqual([b, a, c]);
});

function setupFrom(input: TownInput) {
  return { layout: layoutTown(input, townShapeFor(1440, 900)).layout };
}

test("a new host takes the next free lot: the placed buildings stay where they stand", () => {
  const names = ["h1", "h2", "h3", "h4", "h5"];
  const projection = (count: number) =>
    town(
      Object.fromEntries(
        names.slice(0, count).map((name) => [name, { ws: working(2) }]),
      ),
    );
  const four = townModelFromProjection(projection(4));
  const five = townModelFromProjection(projection(5));
  const keys = four.input.hosts.map((host) => host.key);
  const id = (key: string) => four.hosts.get(key)!.connectionId;
  // The first move saves the order and four lots per street.
  const pins = {
    ranks: Object.fromEntries(
      [keys[3]!, keys[0]!, keys[1]!, keys[2]!].map((key, rank) => [
        id(key),
        rank,
      ]),
    ),
    perStreet: townFirstLotsPerStreet(4),
  };
  const shape = townShapeFor(1440, 900);
  const lots = (model: typeof four, saved: BuildingPins) =>
    new Map(
      layoutTown(
        townOrderHosts(model.input, model.hosts, saved),
        shape,
      ).layout.buildings.map((b) => [b.hostKey, [b.x, b.y]]),
    );
  const before = lots(four, pins);
  const after = lots(five, pins);
  for (const key of keys) expect(after.get(key)).toEqual(before.get(key)!);
  const added = five.input.hosts.find((host) => !keys.includes(host.key))!;
  expect(after.get(added.key)![1]).toBeGreaterThan(before.get(keys[3]!)![1]!);
  // Without the saved lots per street, five buildings wrap three to a street.
  const reflowed = lots(five, { ranks: pins.ranks });
  expect(
    keys.some((key) => `${reflowed.get(key)}` !== `${before.get(key)}`),
  ).toBe(true);
});
