import { expect, test } from "bun:test";
import { townBusRoute } from "./townBus";
import { townGroundPlan, townWildPlan } from "./townGroundPlan";
import {
  TOWN_BILLBOARD_VERGE,
  TOWN_LANDSCAPE_SEED,
  TOWN_LAND_PERIOD,
  TownLand,
  townLandscape,
  townWildLandscape,
  townWildLine,
  type TownLandObject,
} from "./townLandscape";
import {
  layoutTown,
  TOWN_FACADE,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
  type TownInput,
  type TownLayout,
  type TownShape,
} from "./townLayout";

function town(hosts: Record<string, number[]>): TownInput {
  return {
    hosts: Object.keys(hosts).map((key, displayOrder) => ({
      key,
      displayOrder,
    })),
    rooms: Object.entries(hosts).flatMap(([hostKey, counts]) =>
      counts.map((count, order) => ({
        key: `${hostKey}/room-${order}`,
        hostKey,
        order,
        deskKeys: Array.from(
          { length: count },
          (_, index) => `${hostKey}/room-${order}/tab-${index}`,
        ),
      })),
    ),
  };
}

/** The land a test looks at: the town and a wide margin of map beyond it. */
const BEYOND = 40;
function* tilesOf(layout: TownLayout, beyond = BEYOND) {
  for (let ty = -beyond; ty < layout.height + beyond; ty += 1)
    for (let tx = -beyond; tx < layout.width + beyond; tx += 1)
      yield [tx, ty] as const;
}

/** Every tile an object's drawing covers (its crown, shadow or body). */
function footprint(object: TownLandObject) {
  const tall = object.kind === "tree" || object.kind === "pine";
  const tiles: [number, number][] = [];
  for (
    let y = object.y - (tall ? 2 : 0);
    y <= object.y + (tall ? 1 : 0);
    y += 1
  )
    for (
      let x = object.x - (tall ? 1 : 0);
      x <= object.x + (tall ? 1 : 0);
      x += 1
    )
      tiles.push([x, y]);
  return tiles;
}

/**
 * What the landscape must leave alone, derived from the layout here rather
 * than from the generator: every road, pavement, plaza and building tile,
 * each building's roof row above it, the town center, lamps, bushes,
 * benches, the board, the bus stops' signs and the billboard verge above the
 * first street.
 */
function exclusionZones(layout: TownLayout) {
  const zones = new Set<string>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) zones.add(`${x},${y}`);
  };
  for (let ty = 0; ty < layout.height; ty += 1)
    for (let tx = 0; tx < layout.width; tx += 1)
      if (layout.ground[ty * layout.width + tx] !== TownGround.grass)
        add(tx, ty, tx + 1, ty + 1);
  for (const b of layout.buildings)
    add(b.x, b.y - 1, b.x + b.w, b.y + b.h + TOWN_FACADE);
  const { center } = layout;
  add(center.x, center.y, center.x + center.w, center.street);
  for (const p of [...layout.lamps, ...layout.bushes, ...layout.benches])
    add(p.x, p.y, p.x + 1, p.y + 1);
  add(layout.board.x, layout.board.y, layout.board.x + 1, layout.board.y + 1);
  for (const stop of townBusRoute(layout).stops) {
    const x = Math.floor(stop.wait.x / T);
    const y = Math.floor(stop.wait.y / T);
    add(x - 1, y - 4, x + 2, y + 1);
  }
  const top = Math.min(...layout.roads);
  add(0, top - TOWN_BILLBOARD_VERGE, layout.width, top);
  return zones;
}

const cases: [string, TownShape, Record<string, number[]>][] = [
  ["wide, two hosts", TOWN_SHAPES.wide, { a: [4, 2], b: [3] }],
  [
    "wide, five hosts",
    TOWN_SHAPES.wide,
    { a: [4], b: [9, 2], c: [1], d: [6], e: [2, 2] },
  ],
  ["phone, one host", TOWN_SHAPES.phone, { a: [4, 2, 1] }],
  ["phone, three hosts", TOWN_SHAPES.phone, { a: [2], b: [5], c: [1, 1] }],
  ["portrait, two hosts", TOWN_SHAPES.portrait, { a: [3, 3], b: [8] }],
];

test("the landscape is the same for the same layout, in any order", () => {
  for (const [, shape, hosts] of cases) {
    const one = layoutTown(town(hosts), shape).layout;
    const two = layoutTown(town(hosts), shape).layout;
    const first = townLandscape(one);
    const second = townLandscape(two);
    expect(first.seed).toBe(TOWN_LANDSCAPE_SEED);
    const tiles = [...tilesOf(one)];
    // Visit the second backwards: no tile depends on the order of visits.
    const seen = tiles.map(([x, y]) => [
      first.surface(x, y),
      first.objectAt(x, y),
    ]);
    const back = [...tiles]
      .reverse()
      .map(([x, y]) => [second.surface(x, y), second.objectAt(x, y)])
      .reverse();
    expect(back).toEqual(seen);
    // A chunk's plan, and so its pixels, is the same however it is reached.
    const region = { x: -512, y: 0, w: 512, h: 512 };
    expect(townGroundPlan(one, region).key).toBe(
      townGroundPlan(two, region).key,
    );
  }
});

test("the land is varied: woods, meadows, gardens, ponds, paths and lanes", () => {
  const { layout } = layoutTown(
    town({ a: [4, 2], b: [3], c: [2] }),
    TOWN_SHAPES.wide,
  );
  const land = townLandscape(layout);
  const surfaces = new Set<number>();
  const objects = new Set<string>();
  for (const [x, y] of tilesOf(layout, 80)) {
    surfaces.add(land.surface(x, y));
    const object = land.objectAt(x, y);
    if (object) objects.add(object.kind);
  }
  expect([...surfaces].sort()).toEqual(Object.values(TownLand).sort());
  for (const kind of [
    "tree",
    "pine",
    "hedge",
    "shrub",
    "rock",
    "reeds",
    "flowers",
  ])
    expect(objects).toContain(kind);
});

test("nothing generated stands on a building, road, lot, stop or the verge", () => {
  for (const [name, shape, hosts] of cases) {
    const { layout } = layoutTown(town(hosts), shape);
    const land = townLandscape(layout);
    const zones = exclusionZones(layout);
    let objects = 0;
    for (const [x, y] of tilesOf(layout)) {
      const object = land.objectAt(x, y);
      if (zones.has(`${x},${y}`))
        expect([name, x, y, land.surface(x, y)]).toEqual([
          name,
          x,
          y,
          TownLand.meadow,
        ]);
      if (!object) continue;
      objects += 1;
      for (const [fx, fy] of footprint(object))
        expect([name, object.kind, fx, fy, zones.has(`${fx},${fy}`)]).toEqual([
          name,
          object.kind,
          fx,
          fy,
          false,
        ]);
    }
    expect(objects).toBeGreaterThan(100);
  }
});

test("past its wild line a town's land is the wild land, which repeats", () => {
  const wild = townWildLandscape();
  const same = (
    a: ReturnType<typeof townLandscape>,
    b: ReturnType<typeof townLandscape>,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ) => {
    expect([ax, ay, a.surface(ax, ay)]).toEqual([ax, ay, b.surface(bx, by)]);
    expect([ax, ay, a.objectAt(ax, ay)]).toEqual([
      ax,
      ay,
      b.objectAt(bx, by) && { ...b.objectAt(bx, by)!, x: ax, y: ay },
    ]);
  };
  // The wild repeats every period, whichever way.
  const P = TOWN_LAND_PERIOD;
  for (let ty = -20; ty < P + 20; ty += 1)
    for (let tx = -20; tx < P + 20; tx += 1) {
      same(wild, wild, tx, ty, tx + P, ty - 2 * P);
      same(wild, wild, tx, ty, tx - 3 * P, ty + P);
    }
  // It holds woods, meadows, ponds, gardens and paths.
  const kinds = new Set<number>();
  for (let ty = 0; ty < P; ty += 1)
    for (let tx = 0; tx < P; tx += 1) kinds.add(wild.surface(tx, ty));
  for (const kind of [
    TownLand.meadow,
    TownLand.forest,
    TownLand.trail,
    TownLand.water,
    TownLand.bed,
  ])
    expect(kinds.has(kind)).toBe(true);
  expect(kinds.has(TownLand.lane)).toBe(false);

  for (const [, shape, hosts] of cases) {
    const { layout } = layoutTown(town(hosts), shape);
    const land = townLandscape(layout);
    const line = townWildLine(layout);
    // The line keeps the town's own land at least 8 tiles past it, on
    // plot-cell lines, so no garden or pond straddles it.
    expect(line.x0).toBeLessThanOrEqual(-8);
    expect(line.y0).toBeLessThanOrEqual(-8);
    expect(line.x1).toBeGreaterThanOrEqual(layout.width + 8);
    expect(line.y1).toBeGreaterThanOrEqual(layout.height + 8);
    for (const edge of [line.x0, line.y0, line.x1, line.y1])
      expect(Math.abs(edge % 12)).toBe(0);
    for (const [x, y] of tilesOf(layout, BEYOND)) {
      const outside =
        x < line.x0 || y < line.y0 || x >= line.x1 || y >= line.y1;
      if (outside) same(land, wild, x, y, x, y);
    }
  }
});

test("the wild plan paints one period, its edges wrapping round", () => {
  const plan = townWildPlan();
  const wild = townWildLandscape();
  const P = TOWN_LAND_PERIOD;
  expect(plan.region).toEqual({ x: 0, y: 0, w: P * T, h: P * T });
  expect(plan.key).toBe(townWildPlan().key);
  // The ring of tiles round it (for edges) is the period's other side.
  const at = (tx: number, ty: number) =>
    plan.tiles[(ty - plan.ty0) * plan.cols + tx - plan.tx0];
  for (let i = 0; i < P; i += 1) {
    expect(at(-1, i)).toBe(at(P - 1, i));
    expect(at(P, i)).toBe(at(0, i));
    expect(at(i, -1)).toBe(at(i, P - 1));
    expect(at(i, P)).toBe(at(i, 0));
  }
  // Objects from beyond each edge that reach in are drawn, like their
  // twins a period away.
  const key = (o: TownLandObject) =>
    `${o.kind}:${o.variant}:${((o.x % P) + P) % P},${((o.y % P) + P) % P}`;
  const inside = new Set(
    plan.objects
      .filter((o) => o.x >= 0 && o.x < P && o.y >= 0 && o.y < P)
      .map(key),
  );
  const beyond = plan.objects.filter(
    (o) => o.x < 0 || o.x >= P || o.y < 0 || o.y >= P,
  );
  expect(beyond.length).toBeGreaterThan(0);
  for (const o of beyond) {
    expect(inside.has(key(o))).toBe(true);
    expect(wild.objectAt(o.x, o.y)).toEqual(o);
  }
});

test("each street runs on beyond the town as a lane, and nothing grows on it", () => {
  for (const [, shape, hosts] of cases) {
    const { layout } = layoutTown(town(hosts), shape);
    const land = townLandscape(layout);
    for (const road of layout.roads) {
      // At the edge the lane continues the street's three lanes exactly.
      for (const x of [-1, -3, layout.width, layout.width + 2])
        for (let y = road + 1; y < road + 4; y += 1)
          expect(land.surface(x, y)).toBe(TownLand.lane);
      // It ends at the wild line.
      const line = townWildLine(layout);
      for (let y = road - 6; y < road + 10; y += 1)
        for (const x of [line.x0 - 1, line.x1])
          expect(land.surface(x, y)).not.toBe(TownLand.lane);
    }
    for (const [x, y] of tilesOf(layout)) {
      if (land.surface(x, y) !== TownLand.lane) continue;
      const object = land.objectAt(x, y);
      expect(object).toBeNull();
    }
  }
});

/** Every tile within `reach` of a tile in `seeds`. */
function near(seeds: Iterable<string>, reach: number) {
  const out = new Set<string>();
  for (const seed of seeds) {
    const [sx, sy] = seed.split(",").map(Number) as [number, number];
    for (let y = sy - reach; y <= sy + reach; y += 1)
      for (let x = sx - reach; x <= sx + reach; x += 1) out.add(`${x},${y}`);
  }
  return out;
}

/** Tiles where the two layouts' ground, or what stands on it, differ. */
function changedLayout(a: TownLayout, b: TownLayout) {
  const zonesA = exclusionZones(a);
  const zonesB = exclusionZones(b);
  const groundOf = (layout: TownLayout, x: number, y: number) =>
    x >= 0 && y >= 0 && x < layout.width && y < layout.height
      ? layout.ground[y * layout.width + x]
      : -1;
  const changed = new Set<string>();
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  for (let y = -BEYOND; y < h + BEYOND; y += 1)
    for (let x = -BEYOND; x < w + BEYOND; x += 1) {
      const key = `${x},${y}`;
      if (
        groundOf(a, x, y) !== groundOf(b, x, y) ||
        zonesA.has(key) !== zonesB.has(key)
      )
        changed.add(key);
    }
  return changed;
}

test("growth regenerates only the land next to what changed", () => {
  const before = { a: [4, 2], b: [3], c: [2] };
  const growths = [
    // A building grows a room.
    { ...before, b: [3, 4] },
    // A new host's building joins the town.
    { ...before, d: [5] },
  ];
  let regenerated = 0;
  for (const shape of [TOWN_SHAPES.wide, TOWN_SHAPES.phone])
    for (const growth of growths) {
      const a = layoutTown(town(before), shape).layout;
      const b = layoutTown(town(growth), shape).layout;
      const changed = changedLayout(a, b);
      expect(changed.size).toBeGreaterThan(0);
      // A garden or pond takes a 12-tile plot; it and anything near it may
      // change within that reach of the change, and no farther.
      const reach = near(changed, 12 + 4);
      // A street added or moved brings its lane beyond the town: the lane
      // (its rows, bending up to 3) and the plots beside it change.
      const lanes = new Set(
        [...a.roads, ...b.roads].filter(
          (r) => !a.roads.includes(r) || !b.roads.includes(r),
        ),
      );
      // A wider town's wild line moves out, so its streets' lanes run
      // farther: their rows (and the plots beside them) change near the
      // line, between its old and new places.
      const lineA = townWildLine(a);
      const lineB = townWildLine(b);
      const between = (x: number, p: number, q: number) =>
        p !== q && x >= Math.min(p, q) - 16 && x < Math.max(p, q) + 16;
      const laneGrew = (x: number, y: number) =>
        (between(x, lineA.x0, lineB.x0) || between(x, lineA.x1, lineB.x1)) &&
        [...a.roads, ...b.roads].some(
          (r) => y >= r - 3 - 16 && y <= r + 6 + 16,
        );
      const landA = townLandscape(a);
      const landB = townLandscape(b);
      let same = 0;
      let differ = 0;
      const w = Math.max(a.width, b.width);
      const h = Math.max(a.height, b.height);
      for (let y = -BEYOND; y < h + BEYOND; y += 1)
        for (let x = -BEYOND; x < w + BEYOND; x += 1) {
          const equal =
            landA.surface(x, y) === landB.surface(x, y) &&
            JSON.stringify(landA.objectAt(x, y)) ===
              JSON.stringify(landB.objectAt(x, y));
          if (equal) {
            same += 1;
            continue;
          }
          differ += 1;
          const byLane = [...lanes].some(
            (r) => y >= r - 3 - 16 && y <= r + 6 + 16,
          );
          const near = reach.has(`${x},${y}`) || byLane || laneGrew(x, y);
          expect([x, y, near]).toEqual([x, y, true]);
        }
      // Most of the land stays put.
      expect(same).toBeGreaterThan(differ * 4);
      regenerated += differ;
    }
  // Some growth did change the land next to it.
  expect(regenerated).toBeGreaterThan(0);
});

test("unchanged ground chunks keep their plan through a layout change", () => {
  const a = layoutTown(town({ a: [4, 2], b: [3] }), TOWN_SHAPES.wide).layout;
  const b = layoutTown(town({ a: [4, 2], b: [3, 1] }), TOWN_SHAPES.wide).layout;
  // The margin of land left of the town, away from the change.
  const far = { x: -256, y: 0, w: 256, h: 512 };
  expect(townGroundPlan(b, far).key).toBe(townGroundPlan(a, far).key);
  // Under the grown building the plan, and its key, changes.
  const building = b.buildings[1]!;
  const under = {
    x: Math.floor((building.x * T) / 512) * 512,
    y: Math.floor(((building.y + building.h) * T) / 512) * 512,
    w: 512,
    h: 512,
  };
  expect(townGroundPlan(b, under).key).not.toBe(townGroundPlan(a, under).key);
});
