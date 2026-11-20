import { expect, test } from "bun:test";
import {
  TOWN_BUS_TURN_S,
  townBusPath,
  townBusPathAt,
  townBusPose,
  townBusTimeline,
  townBusWay,
  townRoadGraph,
} from "./townBusDrive";

test("a leg rounds its corners in a quarter turn, never cutting across", () => {
  const path = townBusPath([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
  ]);
  // Shorter than its two straight runs by the corner it rounds, no more.
  expect(path.length).toBeLessThan(180);
  expect(path.length).toBeGreaterThan(180 - 2 * 14);
  expect(townBusPathAt(path, 0)).toMatchObject({ x: 0, y: 0, dx: 1, dy: 0 });
  const end = townBusPathAt(path, path.length);
  expect(end.x).toBeCloseTo(100, 9);
  expect(end.y).toBeCloseTo(80, 9);
  expect([end.dx, end.dy]).toEqual([0, 1]);
  let previous = townBusPathAt(path, 0);
  for (let s = 1; s <= path.length; s += 1) {
    const at = townBusPathAt(path, s);
    // It moves a pixel at a time and stays within the corner's box.
    expect(Math.hypot(at.x - previous.x, at.y - previous.y)).toBeLessThan(1.01);
    expect(at.x).toBeLessThanOrEqual(100 + 1e-9);
    expect(at.y).toBeGreaterThanOrEqual(-1e-9);
    previous = at;
  }
  // A point mid-run and a repeat change nothing.
  expect(
    townBusPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]).length,
  ).toBeCloseTo(path.length, 9);
});

/*
 * Two streets (roads 0 and 10, lanes at y 40 and 200) on a map 40 tiles wide,
 * joined by side roads at tiles 2 and 30 (lanes at x 72 and 520).
 */
const layout = {
  width: 40,
  roads: [0, 10],
  verticalRoads: [
    { x: 2, y0: 5, y1: 10 },
    { x: 30, y0: 5, y1: 10 },
  ],
};

test("the road graph joins halts on the streets and its side roads", () => {
  const home = { x: 300, y: 200 };
  const graph = townRoadGraph(layout, [home, { x: 100, y: 40 }]);
  const way = townBusWay(graph, home, [{ key: "a", at: { x: 100, y: 40 } }]);
  // Out by the nearer side road (at 72, not 520), and back the same way.
  const out = 228 + 160 + 28;
  expect(way.length).toBeCloseTo(2 * out, 6);
  expect(way.order).toEqual(["a"]);
  expect(way.legs[0]).toContainEqual({ x: 72, y: 200 });
  expect(way.legs[0]).not.toContainEqual({ x: 520, y: 200 });
});

test("halts are visited in the nearest order, not the order asked", () => {
  const home = { x: 300, y: 200 };
  const halts = [
    { key: "far", at: { x: 600, y: 40 } },
    { key: "near", at: { x: 400, y: 200 } },
    { key: "mid", at: { x: 560, y: 200 } },
  ];
  const graph = townRoadGraph(layout, [home, ...halts.map((h) => h.at)]);
  const way = townBusWay(graph, home, halts);
  // Along the street and up, or round the other way: never zig-zagging.
  expect([
    ["near", "mid", "far"],
    ["far", "mid", "near"],
  ]).toContainEqual([...way.order]);
});

test("a bus that must go back the way it came turns round where it stands", () => {
  const home = { x: 300, y: 200 };
  const halt = { key: "a", at: { x: 400, y: 200 } };
  const graph = townRoadGraph(layout, [home, halt.at]);
  const timeline = townBusTimeline(graph, home, [halt], 1, 2, 60_000);
  const turns = timeline.pieces.filter((piece) => piece.kind === "turn");
  // Out facing right, round at the stop, back facing left, round again to
  // park facing right before its doors open.
  expect(turns).toHaveLength(2);
  for (const turn of turns)
    expect(turn.t1 - turn.t0).toBeCloseTo(TOWN_BUS_TURN_S, 9);
  expect(timeline.arrive.facing).toBe("right");
  const last = timeline.pieces[timeline.pieces.length - 1]!;
  expect(last.kind).toBe("stand");
  // Mid-turn it shows head on, leaning.
  const mid = townBusPose(
    timeline,
    home,
    ((turns[0]!.t0 + turns[0]!.t1) / 2) * 1000,
  );
  expect(mid).toMatchObject({ facing: "down", x: 400, y: 200 });
});
