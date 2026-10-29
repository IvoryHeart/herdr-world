import { expect, test } from "bun:test";
import type { Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import { TOWN_TILE as T, type TownCell, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import { outlinePath, touching, townTeams } from "./townTeams";

/**
 * A room drawn as a grid: a letter is a desk of that team, "." an empty
 * cell. Each team's desks are joined by spawn relations in reading order.
 */
function room(rows: string[]) {
  const cells: TownCell[] = [];
  const desks = new Map<string, unknown>();
  const places = new Map<string, TerminalPlace>();
  const teams = new Map<string, string[]>();
  rows.forEach((line, row) =>
    [...line].forEach((mark, col) => {
      const deskKey = mark === "." ? null : `${mark}${col}${row}`;
      cells.push({ col, row, x: col * 5, y: 1 + row * 5, deskKey, seats: 4 });
      if (!deskKey) return;
      desks.set(deskKey, {
        key: deskKey,
        roomKey: "room",
        tabRef: { connectionId: "c", nativeId: deskKey },
      });
      places.set(`c\u0000${deskKey}`, {
        connectionId: "c",
        workspaceId: "w",
        tabId: deskKey,
        workspaceIds: new Set(["w"]),
        paneId: deskKey,
      });
      teams.set(mark, [...(teams.get(mark) ?? []), deskKey]);
    }),
  );
  const relations: Relation[] = [...teams.values()].flatMap((keys) =>
    keys.slice(1).map((key, index) => ({
      key: `${keys[index]}-${key}`,
      a: { connection_id: "c", terminal_id: keys[index]! },
      b: { connection_id: "c", terminal_id: key },
      evidence: [
        {
          kind: "spawned" as const,
          sor: "herdr" as const,
          source: "token",
          observed_at: null,
          current: true,
        },
      ],
      strength: 1,
    })),
  );
  const model = { desks, deskColors: new Map() } as unknown as TownModel;
  const layout = {
    buildings: [{ rooms: [{ cells }] }],
  } as unknown as TownLayout;
  const result = townTeams(model, layout, relations, places);
  const wallsOf = (team: string) =>
    result.walls.filter(
      (wall) => result.deskTeams.get(teams.get(team)![0]!) === wall.team,
    );
  return { result, wallsOf, cells };
}

test("a 2×2 block of one team shares one box", () => {
  const { wallsOf } = room(["aa", "aa"]);
  const walls = wallsOf("a");
  expect(walls).toHaveLength(1);
  expect(walls[0]).toMatchObject({ desks: 4, outline: null });
  expect(walls[0]!.w).toBeCloseTo(9.8 * T);
  expect(walls[0]!.h).toBeCloseTo(10 * T);
});

test("an L around another team's desk traces one outline that leaves it out", () => {
  const { wallsOf } = room(["aa", "ab"]);
  const walls = wallsOf("a");
  expect(walls).toHaveLength(1);
  expect(walls[0]!.desks).toBe(3);
  const path = walls[0]!.outline!;
  expect(path).toStartWith("M");
  expect(path.match(/Q/g)).toHaveLength(6);
  // The inner corner stops at the foreign desk's footprint, which starts
  // 5.6 tiles across and 5.7 down (rows start one tile into the room).
  expect(path).toContain(`Q${5.4 * T} ${5.7 * T}`);
  expect(wallsOf("b")).toHaveLength(0);
});

test("a row with a gap gets one box per side and keeps the connector", () => {
  const { wallsOf, result } = room(["aa.a"]);
  const walls = wallsOf("a");
  expect(walls.map((wall) => wall.desks).sort()).toEqual([1, 2]);
  expect(walls.every((wall) => wall.outline === null)).toBe(true);
  expect(result.links).toHaveLength(2);
});

test("two separate clusters of one team each get their own wall", () => {
  const { wallsOf } = room(["aa.", "...", ".aa"]);
  const walls = wallsOf("a");
  expect(walls).toHaveLength(2);
  expect(walls.map((wall) => wall.desks)).toEqual([2, 2]);
});

test("a desk inside a ring is a hole in the ring's outline", () => {
  const { wallsOf } = room(["aaa", "aba", "aaa"]);
  const [wall] = wallsOf("a");
  expect(wall!.desks).toBe(8);
  expect(wall!.outline!.match(/M/g)).toHaveLength(2);
});

test("cells that meet only at a corner are separate sets", () => {
  const { cells } = room(["a.", ".a"]);
  expect(touching(cells.filter((cell) => cell.deskKey))).toHaveLength(2);
});

test("an outline of one cell is its footprint", () => {
  const path = outlinePath([
    { col: 0, row: 0, x: 0, y: 0, deskKey: "a", seats: 4 },
  ]);
  expect(path.match(/Q/g)).toHaveLength(4);
  expect(path).toContain(`Q${0.6 * T} ${-0.3 * T}`);
  expect(path).toContain(`Q${5.4 * T} ${4.7 * T}`);
});
