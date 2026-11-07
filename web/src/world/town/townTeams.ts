import { terminalKey, type Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import type { TerminalColor } from "../terminalColor";
import {
  TOWN_TILE as T,
  type TownCell,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import type { TownModel } from "./townModel";

/**
 * Teams in Town: desks whose terminals know each other (shared/relations.ts).
 * A team's desks that touch in a room (a neighbouring cell in one of the four
 * directions) share one wall: their bounding box, or, when another team's desk
 * sits inside that box, the outline of their footprints drawn around it. A
 * connector joins related desks in separate walls. A spawn draws solid, a
 * manual group dotted, and stale evidence faded.
 */

export type TownTeamWall = {
  key: string;
  team: string;
  /** The wall's bounding box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * A rectilinear outline instead of the box, as closed loops of corners
   * (clockwise; a ring of desks has a second loop around its hole).
   */
  outline?: TownPoint[][];
  color: TerminalColor;
  current: boolean;
  /** How many desks it holds. */
  desks: number;
};

export type TownTeamLink = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "spawned" | "manual";
  current: boolean;
};

export type TownTeams = {
  /** Each related desk's team. */
  deskTeams: ReadonlyMap<string, string>;
  /** Desks in a manual group, which the user can take out of it. */
  groupedDesks: ReadonlySet<string>;
  walls: TownTeamWall[];
  links: TownTeamLink[];
};

export const NO_TOWN_TEAMS: TownTeams = {
  deskTeams: new Map(),
  groupedDesks: new Set(),
  walls: [],
  links: [],
};

const placeKey = (connectionId: string, tabId: string) =>
  `${connectionId}\u0000${tabId}`;

/** A desk cell's footprint, around its table and chairs. */
function footprint(cell: TownCell) {
  return {
    x0: (cell.x + 0.6) * T,
    y0: (cell.y - 0.3) * T,
    x1: (cell.x + 5.4) * T,
    y1: (cell.y + 4.7) * T,
  };
}

/** Desk cells split into groups that touch in one of the four directions. */
function touching(deskCells: readonly TownCell[]): TownCell[][] {
  const at = new Map(
    deskCells.map((cell) => [`${cell.col},${cell.row}`, cell]),
  );
  const seen = new Set<TownCell>();
  const groups: TownCell[][] = [];
  for (const first of deskCells) {
    if (seen.has(first)) continue;
    seen.add(first);
    const group = [first];
    for (let index = 0; index < group.length; index += 1) {
      const { col, row } = group[index]!;
      for (const [dc, dr] of STEPS) {
        const next = at.get(`${col + dc},${row + dr}`);
        if (next && !seen.has(next)) {
          seen.add(next);
          group.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/**
 * The outline of touching desk cells' footprints, traced on the cell grid and
 * placed at each side's footprint edge, so it hugs the desks and spans the
 * aisle between neighbours. Loops run clockwise on screen (inside on the
 * right); where two cells meet only at a corner the trace turns right, keeping
 * them as separate loops.
 */
function outlineOf(group: readonly TownCell[]): TownPoint[][] {
  const at = new Set(group.map((cell) => `${cell.col},${cell.row}`));
  const has = (col: number, row: number) => at.has(`${col},${row}`);
  // Boundary edges on the grid; `at` is the side's screen coordinate.
  type Edge = {
    from: string;
    to: string;
    vertical: boolean;
    dx: number;
    dy: number;
    at: number;
  };
  const edges = new Map<string, Edge[]>();
  const add = (from: [number, number], to: [number, number], at: number) => {
    const edge: Edge = {
      from: from.join(","),
      to: to.join(","),
      vertical: from[0] === to[0],
      dx: to[0] - from[0],
      dy: to[1] - from[1],
      at,
    };
    edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge]);
  };
  for (const cell of group) {
    const { col: c, row: r } = cell;
    const box = footprint(cell);
    if (!has(c, r - 1)) add([c, r], [c + 1, r], box.y0);
    if (!has(c + 1, r)) add([c + 1, r], [c + 1, r + 1], box.x1);
    if (!has(c, r + 1)) add([c + 1, r + 1], [c, r + 1], box.y1);
    if (!has(c - 1, r)) add([c, r + 1], [c, r], box.x0);
  }
  const loops: TownPoint[][] = [];
  const used = new Set<Edge>();
  for (const list of [...edges.values()])
    for (const start of list) {
      if (used.has(start)) continue;
      const path: Edge[] = [];
      let edge = start;
      while (!used.has(edge)) {
        used.add(edge);
        path.push(edge);
        const next = edges.get(edge.to)!.filter((e) => !used.has(e));
        // Turn right (dx,dy -> -dy,dx on screen) before going on or left.
        const right = next.find((e) => e.dx === -edge.dy && e.dy === edge.dx);
        edge = right ?? next[0] ?? start;
      }
      // A corner wherever the trace turns: its vertical side's x, horizontal
      // side's y.
      const corners: TownPoint[] = [];
      for (let index = 0; index < path.length; index += 1) {
        const a = path[index]!;
        const b = path[(index + 1) % path.length]!;
        if (a.vertical === b.vertical) continue;
        corners.push(a.vertical ? { x: a.at, y: b.at } : { x: b.at, y: a.at });
      }
      loops.push(corners);
    }
  return loops;
}

/**
 * An SVG path through an outline's corners, each rounded by up to `radius`
 * (as the box's corners are).
 */
export function townWallPath(outline: readonly TownPoint[][], radius: number) {
  return outline
    .map((corners) => {
      const n = corners.length;
      const point = (p: TownPoint) => `${round(p.x)} ${round(p.y)}`;
      const toward = (from: TownPoint, to: TownPoint, length: number) => {
        const d = Math.hypot(to.x - from.x, to.y - from.y);
        const t = d ? Math.min(length, d / 2) / d : 0;
        return {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        };
      };
      const parts = corners.map((corner, index) => {
        const before = corners[(index + n - 1) % n]!;
        const after = corners[(index + 1) % n]!;
        const enter = toward(corner, before, radius);
        const leave = toward(corner, after, radius);
        return `${index ? "L" : "M"}${point(enter)}Q${point(corner)} ${point(leave)}`;
      });
      return `${parts.join("")}Z`;
    })
    .join("");
}

const round = (value: number) => Math.round(value * 100) / 100;

export function townTeams(
  model: TownModel,
  layout: TownLayout,
  relations: readonly Relation[],
  places: ReadonlyMap<string, TerminalPlace>,
): TownTeams {
  if (!relations.length) return NO_TOWN_TEAMS;
  const deskOfTab = new Map<string, string>();
  for (const desk of model.desks.values())
    deskOfTab.set(
      placeKey(desk.tabRef.connectionId, desk.tabRef.nativeId),
      desk.key,
    );
  const deskOf = (ref: Relation["a"]) => {
    const place = places.get(terminalKey(ref));
    return place
      ? deskOfTab.get(placeKey(place.connectionId, place.tabId))
      : undefined;
  };
  const cells = new Map<string, TownCell>();
  for (const building of layout.buildings)
    for (const room of building.rooms)
      for (const cell of room.cells)
        if (cell.deskKey) cells.set(cell.deskKey, cell);

  // Union desks joined by any relation; a team's label is its first desk.
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const pairs: { a: string; b: string; relation: Relation }[] = [];
  const groupedDesks = new Set<string>();
  for (const relation of relations) {
    const a = deskOf(relation.a);
    const b = deskOf(relation.b);
    // A desk in a group can leave it even when its partner is gone.
    if (relation.evidence.some((entry) => entry.kind === "manual"))
      for (const desk of [a, b]) if (desk) groupedDesks.add(desk);
    if (!a || !b || a === b) continue;
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
    const [x, y] = [find(a), find(b)].sort();
    parent.set(y!, x!);
    pairs.push({ a, b, relation });
  }
  const deskTeams = new Map<string, string>();
  for (const key of parent.keys()) deskTeams.set(key, find(key));

  // Per team and room, each group of touching desks gets one wall.
  const byRoom = new Map<string, string[]>();
  for (const [deskKey, team] of deskTeams) {
    const desk = model.desks.get(deskKey);
    if (!desk || !cells.has(deskKey)) continue;
    const key = `${team}\u0000${desk.roomKey}`;
    byRoom.set(key, [...(byRoom.get(key) ?? []), deskKey]);
  }
  const currentDesks = new Set<string>();
  for (const pair of pairs)
    if (pair.relation.strength > 0) {
      currentDesks.add(pair.a);
      currentDesks.add(pair.b);
    }
  const walls: TownTeamWall[] = [];
  const walled = new Map<string, string>();
  for (const [key, deskKeys] of byRoom) {
    const team = deskTeams.get(deskKeys[0]!)!;
    const roomKey = model.desks.get(deskKeys[0]!)?.roomKey;
    const color =
      model.deskColors.get(team) ??
      model.deskColors.get(deskKeys[0]!) ??
      "blue";
    for (const group of touching(deskKeys.map((k) => cells.get(k)!))) {
      const parts = group.map(footprint);
      const box = {
        x0: Math.min(...parts.map((b) => b.x0)),
        y0: Math.min(...parts.map((b) => b.y0)),
        x1: Math.max(...parts.map((b) => b.x1)),
        y1: Math.max(...parts.map((b) => b.y1)),
      };
      const intruder = [...cells].some(([deskKey, cell]) => {
        if (deskKeys.includes(deskKey)) return false;
        if (model.desks.get(deskKey)?.roomKey !== roomKey) return false;
        const other = footprint(cell);
        return (
          other.x0 < box.x1 &&
          other.x1 > box.x0 &&
          other.y0 < box.y1 &&
          other.y1 > box.y0
        );
      });
      const keys = group.map((cell) => cell.deskKey!);
      const wallKey = `${key}\u0000${keys[0]}`;
      walls.push({
        key: wallKey,
        team,
        x: box.x0,
        y: box.y0,
        w: box.x1 - box.x0,
        h: box.y1 - box.y0,
        ...(intruder ? { outline: outlineOf(group) } : {}),
        color,
        current: keys.some((deskKey) => currentDesks.has(deskKey)),
        desks: keys.length,
      });
      for (const deskKey of keys) walled.set(deskKey, wallKey);
    }
  }

  // A connector per related desk pair, unless one wall already holds both
  // and it is only a manual group. Its evidence is all pairs' together.
  const byPair = new Map<
    string,
    { a: string; b: string; spawned: boolean; current: boolean }
  >();
  for (const { a, b, relation } of pairs) {
    const key = [a, b].sort().join("\u0001");
    const entry = byPair.get(key) ?? { a, b, spawned: false, current: false };
    entry.spawned ||= relation.evidence.some(
      (evidence) => evidence.kind === "spawned",
    );
    entry.current ||= relation.strength > 0;
    byPair.set(key, entry);
  }
  const links: TownTeamLink[] = [];
  for (const [key, { a, b, spawned, current }] of byPair) {
    if (!spawned && walled.get(a) && walled.get(a) === walled.get(b)) continue;
    const from = cells.get(a);
    const to = cells.get(b);
    if (!from || !to) continue;
    links.push({
      key,
      x1: (from.x + 3) * T,
      y1: (from.y + 2.2) * T,
      x2: (to.x + 3) * T,
      y2: (to.y + 2.2) * T,
      kind: spawned ? "spawned" : "manual",
      current,
    });
  }
  return { deskTeams, groupedDesks, walls, links };
}
