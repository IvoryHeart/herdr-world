import { terminalKey, type Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import type { TerminalColor } from "../terminalColor";
import { TOWN_TILE as T, type TownCell, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";

/**
 * Teams in Town: desks whose terminals know each other (shared/relations.ts).
 * Desks of one team that sit together in a room get one wall around them;
 * otherwise each gets its own, and a connector joins related desks. A spawn
 * draws solid, a manual group dotted, and stale evidence faded.
 */

export type TownTeamWall = {
  key: string;
  team: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** Each grouped desk's team. */
  deskTeams: ReadonlyMap<string, string>;
  walls: TownTeamWall[];
  links: TownTeamLink[];
};

export const NO_TOWN_TEAMS: TownTeams = {
  deskTeams: new Map(),
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
  for (const relation of relations) {
    const a = deskOf(relation.a);
    const b = deskOf(relation.b);
    if (!a || !b || a === b) continue;
    for (const key of [a, b]) if (!parent.has(key)) parent.set(key, key);
    const [x, y] = [find(a), find(b)].sort();
    parent.set(y!, x!);
    pairs.push({ a, b, relation });
  }
  const deskTeams = new Map<string, string>();
  for (const key of parent.keys()) deskTeams.set(key, find(key));

  // Per team and room: one wall when no other desk sits inside its bounds.
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
    const color =
      model.deskColors.get(team) ??
      model.deskColors.get(deskKeys[0]!) ??
      "blue";
    const boxes = deskKeys.map((deskKey) => footprint(cells.get(deskKey)!));
    const box = {
      x0: Math.min(...boxes.map((b) => b.x0)),
      y0: Math.min(...boxes.map((b) => b.y0)),
      x1: Math.max(...boxes.map((b) => b.x1)),
      y1: Math.max(...boxes.map((b) => b.y1)),
    };
    const intruder = [...cells].some(([deskKey, cell]) => {
      if (deskKeys.includes(deskKey)) return false;
      const other = footprint(cell);
      return (
        other.x0 < box.x1 &&
        other.x1 > box.x0 &&
        other.y0 < box.y1 &&
        other.y1 > box.y0 &&
        model.desks.get(deskKey)?.roomKey ===
          model.desks.get(deskKeys[0]!)?.roomKey
      );
    });
    const groups =
      intruder || deskKeys.length < 2 ? deskKeys.map((k) => [k]) : [deskKeys];
    for (const group of groups) {
      const parts = group.map((deskKey) => footprint(cells.get(deskKey)!));
      const x0 = Math.min(...parts.map((b) => b.x0));
      const y0 = Math.min(...parts.map((b) => b.y0));
      const wallKey = `${key}\u0000${group[0]}`;
      walls.push({
        key: wallKey,
        team,
        x: x0,
        y: y0,
        w: Math.max(...parts.map((b) => b.x1)) - x0,
        h: Math.max(...parts.map((b) => b.y1)) - y0,
        color,
        current: group.some((deskKey) => currentDesks.has(deskKey)),
        desks: group.length,
      });
      for (const deskKey of group) walled.set(deskKey, wallKey);
    }
  }

  // A connector per related desk pair, unless one wall already holds both.
  const links: TownTeamLink[] = [];
  const seen = new Set<string>();
  for (const { a, b, relation } of pairs) {
    const kind = relation.evidence.some((entry) => entry.kind === "spawned")
      ? "spawned"
      : "manual";
    if (kind === "manual" && walled.get(a) && walled.get(a) === walled.get(b))
      continue;
    const key = [a, b].sort().join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    const from = cells.get(a);
    const to = cells.get(b);
    if (!from || !to) continue;
    links.push({
      key,
      x1: (from.x + 3) * T,
      y1: (from.y + 2.2) * T,
      x2: (to.x + 3) * T,
      y2: (to.y + 2.2) * T,
      kind,
      current: relation.strength > 0,
    });
  }
  return { deskTeams, walls, links };
}
