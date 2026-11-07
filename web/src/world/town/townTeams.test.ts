import { expect, test } from "bun:test";
import { terminalKey, type Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import type { TownCell, TownLayout, TownPoint } from "./townLayout";
import type { TownModel } from "./townModel";
import { townTeams, townWallPath, type TownTeamWall } from "./townTeams";
import { TOWN_TILE as T } from "./townLayout";

/**
 * One room drawn as rows: `a` a desk of the team, `x` another desk, `.` an
 * empty cell. Team desks are chained by a manual group in reading order, so
 * related desks in separate walls keep a connector.
 */
function room(rows: string[], kind: "manual" | "spawned" = "manual") {
  const cells: TownCell[] = [];
  const team: string[] = [];
  const others: string[] = [];
  rows.forEach((line, row) =>
    [...line].forEach((mark, col) => {
      const deskKey = mark === "." ? null : `${mark}${col}${row}`;
      if (mark === "a") team.push(deskKey!);
      if (mark === "x") others.push(deskKey!);
      cells.push({
        col,
        row,
        x: 3 + col * 5,
        y: 4 + row * 5,
        deskKey,
        seats: 4,
      });
    }),
  );
  const desks = new Map(
    [...team, ...others].map((key) => [
      key,
      {
        key,
        roomKey: "room",
        tabRef: { connectionId: "studio", nativeId: key },
      },
    ]),
  );
  const model = { desks, deskColors: new Map() } as unknown as TownModel;
  const layout = {
    buildings: [{ rooms: [{ cells }] }],
  } as unknown as TownLayout;
  const ref = (key: string) => ({
    connection_id: "studio",
    terminal_id: `term-${key}`,
  });
  const places = new Map<string, TerminalPlace>(
    [...team, ...others].map((key) => [
      terminalKey(ref(key)),
      { connectionId: "studio", tabId: key } as TerminalPlace,
    ]),
  );
  const relations: Relation[] = team.slice(1).map((key, index) => ({
    key: `pair-${index}`,
    a: ref(team[index]!),
    b: ref(key),
    evidence: [
      { kind, sor: "world", source: "g", observed_at: null, current: true },
    ],
    strength: 1,
  })) as Relation[];
  const teams = townTeams(model, layout, relations, places);
  const centre = (key: string) => {
    const cell = cells.find((entry) => entry.deskKey === key)!;
    return { x: (cell.x + 3) * T, y: (cell.y + 2.2) * T };
  };
  return { teams, centre };
}

/** Even-odd containment over every loop, so a ring's hole is outside. */
function inside(wall: TownTeamWall, p: TownPoint) {
  const loops = wall.outline ?? [
    [
      { x: wall.x, y: wall.y },
      { x: wall.x + wall.w, y: wall.y },
      { x: wall.x + wall.w, y: wall.y + wall.h },
      { x: wall.x, y: wall.y + wall.h },
    ],
  ];
  let hit = false;
  for (const loop of loops)
    loop.forEach((a, index) => {
      const b = loop[(index + 1) % loop.length]!;
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)
      )
        hit = !hit;
    });
  return hit;
}

/** Each loop alternates horizontal and vertical sides, none of them empty. */
function rectilinear(wall: TownTeamWall) {
  for (const loop of wall.outline ?? []) {
    expect(loop.length % 2).toBe(0);
    loop.forEach((a, index) => {
      const b = loop[(index + 1) % loop.length]!;
      expect((a.x === b.x) !== (a.y === b.y)).toBe(true);
    });
  }
}

test("a 2×2 block of one team has one rectangular wall", () => {
  const { teams, centre } = room(["aa", "aa"]);
  expect(teams.walls).toHaveLength(1);
  const [wall] = teams.walls;
  expect(wall!.desks).toBe(4);
  expect(wall!.outline).toBeUndefined();
  for (const key of ["a00", "a10", "a01", "a11"])
    expect(inside(wall!, centre(key))).toBe(true);
  // One wall holds the whole manual group: no connectors.
  expect(teams.links).toHaveLength(0);
});

test("an L of one team around another desk shares one wall around it", () => {
  const { teams, centre } = room(["aa", "xa"]);
  expect(teams.walls).toHaveLength(1);
  const [wall] = teams.walls;
  expect(wall!.desks).toBe(3);
  expect(wall!.outline).toHaveLength(1);
  expect(wall!.outline![0]).toHaveLength(6);
  rectilinear(wall!);
  for (const key of ["a00", "a10", "a11"])
    expect(inside(wall!, centre(key))).toBe(true);
  expect(inside(wall!, centre("x01"))).toBe(false);
  expect(teams.links).toHaveLength(0);
});

test("a ring of one team keeps the desk it surrounds outside its wall", () => {
  const { teams, centre } = room(["aaa", "axa", "aaa"]);
  expect(teams.walls).toHaveLength(1);
  const [wall] = teams.walls;
  expect(wall!.desks).toBe(8);
  expect(wall!.outline).toHaveLength(2);
  rectilinear(wall!);
  expect(inside(wall!, centre("a00"))).toBe(true);
  expect(inside(wall!, centre("a21"))).toBe(true);
  expect(inside(wall!, centre("x11"))).toBe(false);
});

test("cells meeting only at a corner trace closed loops", () => {
  const { teams, centre } = room(["aaa", "axa", "aa."]);
  expect(teams.walls).toHaveLength(1);
  const [wall] = teams.walls;
  // The hole opens at that corner: one loop, wrapping each cell apart.
  expect(wall!.outline).toHaveLength(1);
  rectilinear(wall!);
  for (const key of ["a00", "a10", "a20", "a01", "a21", "a02", "a12"])
    expect(inside(wall!, centre(key))).toBe(true);
  expect(inside(wall!, centre("x11"))).toBe(false);
});

test("a row with a gap gets a wall per side and a connector", () => {
  for (const rows of [["a.a"], ["axa"]]) {
    const { teams } = room(rows);
    expect(teams.walls.map((wall) => wall.desks)).toEqual([1, 1]);
    expect(teams.walls.every((wall) => !wall.outline)).toBe(true);
    expect(teams.links).toHaveLength(1);
  }
});

test("two separate clusters of one team get two walls and a connector", () => {
  const { teams, centre } = room(["aa.aa"]);
  expect(teams.walls).toHaveLength(2);
  expect(teams.walls.map((wall) => wall.desks)).toEqual([2, 2]);
  expect(teams.walls.every((wall) => !wall.outline)).toBe(true);
  expect(teams.links).toHaveLength(1);
  const [link] = teams.links;
  expect({ x: link!.x1, y: link!.y1 }).toEqual(centre("a10"));
  expect({ x: link!.x2, y: link!.y2 }).toEqual(centre("a30"));
});

test("spawned desks sharing a wall keep their connectors", () => {
  const { teams } = room(["aa", "xa"], "spawned");
  expect(teams.walls).toHaveLength(1);
  expect(teams.links).toHaveLength(2);
});

test("an outline's path rounds each corner and closes each loop", () => {
  const { teams } = room(["aaa", "axa", "aaa"]);
  const path = townWallPath(teams.walls[0]!.outline!, 10);
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path.match(/Q/g)).toHaveLength(8);
  expect(path.match(/Z/g)).toHaveLength(2);
});
