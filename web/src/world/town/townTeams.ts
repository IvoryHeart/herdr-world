import { terminalKey, type Relation } from "../../../../shared/relations";
import type { WorldPod } from "../pods";
import type { TerminalPlace } from "../relations";
import type { TerminalColor } from "../terminalColor";
import { TOWN_TILE as T, type TownCell, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";

/**
 * Teams in Town: desks whose terminals know each other (shared/relations.ts).
 * Desks of one team that touch in a room (side by side or one above the
 * other) share one wall: a box, or the traced outline of the desks when
 * another team's desk sits inside that box. A connector joins related desks
 * across walls. A spawn draws solid, a manual group dotted, and stale
 * evidence faded. A pod's desks (townPods.ts) are one team too, and its
 * wall around the current round carries the pod's plaque.
 */

export type TownTeamWall = {
  key: string;
  team: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** An SVG path around the desks when a box would hold another's desk. */
  outline: string | null;
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

/** A pod's plaque, on the wall around its current round; one per wall. */
export type TownPodPlaque = {
  key: string;
  pod: WorldPod;
  roomKey: string;
  /**
   * Where it hangs: just inside the bottom edge of the wall's bottom-left
   * cell, below the desks' nameplates. The top edge has chairs and seat
   * labels, and on the room's first row the room's nameplate.
   */
  x: number;
  y: number;
  /** The width of that cell's run along the edge, which the plaque stays within. */
  w: number;
  color: TerminalColor;
};

export type TownTeams = {
  /** Each related desk's team. */
  deskTeams: ReadonlyMap<string, string>;
  /** Desks in a manual group, which the user can take out of it. */
  groupedDesks: ReadonlySet<string>;
  walls: TownTeamWall[];
  links: TownTeamLink[];
  plaques: TownPodPlaque[];
};

export const NO_TOWN_TEAMS: TownTeams = {
  deskTeams: new Map(),
  groupedDesks: new Set(),
  walls: [],
  links: [],
  plaques: [],
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

const range = (values: number[]) =>
  [Math.min(...values), Math.max(...values)] as const;

/** Desk cells of one room split into sets that touch in the four directions. */
export function touching(cells: readonly TownCell[]): TownCell[][] {
  const at = new Map(cells.map((cell) => [`${cell.col},${cell.row}`, cell]));
  const seen = new Set<TownCell>();
  const groups: TownCell[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    seen.add(start);
    const group = [start];
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
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const CORNER = 10;

/**
 * The outline around touching desk cells: their footprints' union, with the
 * aisles between neighbours filled. It traces each cell's open sides
 * clockwise on the cell grid, then places every line on the footprint edge of
 * the cell inside it, so a hole around another desk becomes its own loop.
 */
export function outlinePath(cells: readonly TownCell[]): string {
  const inside = new Set(cells.map((cell) => `${cell.col},${cell.row}`));
  const has = (col: number, row: number) => inside.has(`${col},${row}`);
  type Edge = {
    from: string;
    to: string;
    /** Pixel position of the line: x for a vertical edge, y for a horizontal. */
    at: number;
    dir: 0 | 1 | 2 | 3; // east, south, west, north
  };
  const edges = new Map<string, Edge[]>();
  const add = (edge: Edge) =>
    edges.set(edge.from, [...(edges.get(edge.from) ?? []), edge]);
  const point = (col: number, row: number) => `${col},${row}`;
  for (const cell of cells) {
    const { col: c, row: r } = cell;
    const box = footprint(cell);
    if (!has(c, r - 1))
      add({ from: point(c, r), to: point(c + 1, r), at: box.y0, dir: 0 });
    if (!has(c + 1, r))
      add({
        from: point(c + 1, r),
        to: point(c + 1, r + 1),
        at: box.x1,
        dir: 1,
      });
    if (!has(c, r + 1))
      add({
        from: point(c + 1, r + 1),
        to: point(c, r + 1),
        at: box.y1,
        dir: 2,
      });
    if (!has(c - 1, r))
      add({ from: point(c, r + 1), to: point(c, r), at: box.x0, dir: 3 });
  }
  const loops: Edge[][] = [];
  for (;;) {
    const first = [...edges.values()].find((list) => list.length)?.[0];
    if (!first) break;
    const loop: Edge[] = [];
    let edge: Edge | undefined = first;
    while (edge) {
      const out = edges.get(edge.from)!;
      out.splice(out.indexOf(edge), 1);
      loop.push(edge);
      const next: Edge[] = edges.get(edge.to) ?? [];
      // Where two cells meet only at a corner, turn right to keep them apart.
      const dir: Edge["dir"] = edge.dir;
      edge =
        next.find((candidate) => candidate.dir === (dir + 1) % 4) ??
        next.find((candidate) => candidate.dir === dir) ??
        next[0];
    }
    // Keep only the turns: each corner sits where a vertical and a
    // horizontal line cross.
    loops.push(
      loop.filter((e, i) => e.dir !== loop[(i || loop.length) - 1]!.dir),
    );
  }
  return loops
    .map((turns) => {
      const corners = turns.map((edge, index) => {
        const before = turns[(index || turns.length) - 1]!;
        const vertical = edge.dir % 2 === 1 ? edge : before;
        const horizontal = edge.dir % 2 === 0 ? edge : before;
        return { x: vertical.at, y: horizontal.at };
      });
      return roundedLoop(corners);
    })
    .join(" ");
}

/**
 * Where a wall's plaque hangs: on the leftmost cell of its bottom row, as
 * wide as the run of cells beside it, so an outlined wall's plaque never
 * hangs over another team's desk.
 */
function plaqueAnchor(group: readonly TownCell[]) {
  const row = Math.max(...group.map((cell) => cell.row));
  const cols = new Set(
    group.filter((cell) => cell.row === row).map((cell) => cell.col),
  );
  const first = Math.min(...cols);
  let last = first;
  while (cols.has(last + 1)) last += 1;
  const at = (col: number) =>
    footprint(group.find((cell) => cell.row === row && cell.col === col)!);
  const start = at(first);
  return { x: start.x0, y: start.y1, w: at(last).x1 - start.x0 };
}

/** A closed path through rectilinear corners, rounded like the box walls. */
function roundedLoop(corners: readonly { x: number; y: number }[]): string {
  const towards = (
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const r = Math.min(CORNER, length / 2);
    return {
      x: from.x + ((to.x - from.x) / length) * r,
      y: from.y + ((to.y - from.y) / length) * r,
    };
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  const parts = corners.map((corner, index) => {
    const before = corners[(index || corners.length) - 1]!;
    const after = corners[(index + 1) % corners.length]!;
    const start = towards(corner, before);
    const end = towards(corner, after);
    return `${index ? "L" : "M"}${round(start.x)} ${round(start.y)} Q${round(corner.x)} ${round(corner.y)} ${round(end.x)} ${round(end.y)}`;
  });
  return `${parts.join(" ")} Z`;
}

export function townTeams(
  model: TownModel,
  layout: TownLayout,
  relations: readonly Relation[],
  places: ReadonlyMap<string, TerminalPlace>,
  pods: readonly WorldPod[] = [],
): TownTeams {
  if (!relations.length && !pods.length) return NO_TOWN_TEAMS;
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

  // Union desks joined by a pod or any relation; a team's label is its
  // first desk. Two pods never join one team: a relation between them stays
  // a connector, so each pull request keeps its own wall and plaque.
  const parent = new Map<string, string>();
  const podOfRoot = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const join = (a: string, b: string) => {
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
    const [x, y] = [find(a), find(b)].sort();
    const podX = podOfRoot.get(x!);
    const podY = podOfRoot.get(y!);
    if (podX && podY && podX !== podY) return;
    parent.set(y!, x!);
    if (podY) podOfRoot.set(x!, podY);
  };
  // A pod's desks join its current round's; a lone round is a team of one.
  const podPairs: { a: string; b: string }[] = [];
  const podDesks = new Map<WorldPod, string[]>();
  for (const pod of pods) {
    const desks = [
      ...pod.rounds.map((round) => round.tabKey).reverse(),
      ...pod.authorKeys,
    ].filter((key) => cells.has(key) && model.desks.has(key));
    const [head, ...rest] = desks;
    if (!head) continue;
    podDesks.set(pod, desks);
    join(head, head);
    if (!podOfRoot.has(find(head))) podOfRoot.set(find(head), pod.key);
    for (const key of rest) {
      join(head, key);
      podPairs.push({ a: head, b: key });
    }
  }
  const pairs: { a: string; b: string; relation: Relation }[] = [];
  const groupedDesks = new Set<string>();
  for (const relation of relations) {
    const a = deskOf(relation.a);
    const b = deskOf(relation.b);
    // A desk in a group can leave it even when its partner is gone.
    if (relation.evidence.some((entry) => entry.kind === "manual"))
      for (const desk of [a, b]) if (desk) groupedDesks.add(desk);
    if (!a || !b || a === b) continue;
    join(a, b);
    pairs.push({ a, b, relation });
  }
  const deskTeams = new Map<string, string>();
  for (const key of parent.keys()) deskTeams.set(key, find(key));

  // Per team and room: one wall per set of touching desks.
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
  for (const desks of podDesks.values())
    for (const key of desks) currentDesks.add(key);
  const walls: TownTeamWall[] = [];
  const walled = new Map<string, string>();
  const anchors = new Map<string, { x: number; y: number; w: number }>();
  for (const [key, deskKeys] of byRoom) {
    const team = deskTeams.get(deskKeys[0]!)!;
    const roomKey = model.desks.get(deskKeys[0]!)?.roomKey;
    const color =
      model.deskColors.get(team) ??
      model.deskColors.get(deskKeys[0]!) ??
      "blue";
    const own = new Set(deskKeys);
    const foreign = [...cells].filter(
      ([deskKey]) =>
        !own.has(deskKey) && model.desks.get(deskKey)?.roomKey === roomKey,
    );
    for (const group of touching(deskKeys.map((k) => cells.get(k)!))) {
      const parts = group.map(footprint);
      const x0 = Math.min(...parts.map((b) => b.x0));
      const y0 = Math.min(...parts.map((b) => b.y0));
      const [c0, c1] = range(group.map((cell) => cell.col));
      const [r0, r1] = range(group.map((cell) => cell.row));
      const intruder = foreign.some(
        ([, cell]) =>
          cell.col >= c0 && cell.col <= c1 && cell.row >= r0 && cell.row <= r1,
      );
      const wallKey = `${key}\u0000${group[0]!.deskKey}`;
      walls.push({
        key: wallKey,
        team,
        x: x0,
        y: y0,
        w: Math.max(...parts.map((b) => b.x1)) - x0,
        h: Math.max(...parts.map((b) => b.y1)) - y0,
        outline: intruder ? outlinePath(group) : null,
        color,
        current: group.some((cell) => currentDesks.has(cell.deskKey!)),
        desks: group.length,
      });
      for (const cell of group) walled.set(cell.deskKey!, wallKey);
      anchors.set(wallKey, plaqueAnchor(group));
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
  for (const { a, b } of podPairs) {
    const key = [a, b].sort().join("\u0001");
    const entry = byPair.get(key) ?? { a, b, spawned: false, current: false };
    entry.current = true;
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
  const wallByKey = new Map(walls.map((wall) => [wall.key, wall]));
  const plaques: TownPodPlaque[] = [];
  for (const [pod, desks] of podDesks) {
    const wall = wallByKey.get(walled.get(desks[0]!) ?? "");
    const anchor = anchors.get(wall?.key ?? "");
    const desk = model.desks.get(desks[0]!);
    if (!wall || !anchor || !desk) continue;
    plaques.push({
      key: pod.key,
      pod,
      roomKey: desk.roomKey,
      ...anchor,
      color: wall.color,
    });
  }
  return { deskTeams, groupedDesks, walls, links, plaques };
}
