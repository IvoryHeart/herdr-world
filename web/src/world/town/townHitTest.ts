import type { TownLevel } from "./townCamera";
import {
  TOWN_AGENT_SCALE as S,
  TOWN_FACADE,
  TOWN_TILE as T,
  townDeskSlots,
  townSeat,
  type TownBuilding,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";

export type TownHit =
  /** `standing` when the agent was hit away from its seat (lounge, queue, walking). */
  | { kind: "agent"; key: string; standing?: true }
  | { kind: "pane"; key: string; deskKey: string }
  | { kind: "desk"; key: string }
  | { kind: "cell"; roomKey: string; cellIndex: number }
  /** `edge`: on or just outside the room's wall, where a drag lifts the room. */
  | { kind: "room"; key: string; edge?: true }
  | { kind: "building"; key: string };

export type TownHitContext = {
  layout: TownLayout;
  model: TownModel;
  level: TownLevel;
  roofAlpha: (hostKey: string) => number;
  /** Standing or walking agents only; seated agents are found through their seat. */
  standing: () => Iterable<{
    key: string;
    hostKey: string;
    x: number;
    y: number;
  }>;
  /**
   * Whether an agent is drawn at its seat. One walking, queued or in the
   * lounge leaves its chair empty, so the chair is its pane. Default: seated.
   */
  seated?: (agentKey: string) => boolean;
  zoom: number;
};

export function townBuildingAt(
  layout: TownLayout,
  x: number,
  y: number,
): TownBuilding | null {
  return (
    layout.buildings.find(
      (b) =>
        x >= b.x * T - 4 &&
        x < (b.x + b.w) * T + 4 &&
        y >= b.y * T - 12 &&
        y < (b.y + b.h + TOWN_FACADE) * T,
    ) ?? null
  );
}

/** World pixels outside a room's wall that still hold its edge. */
const EDGE_OUTSIDE = 8;

/**
 * How deep a room's edge reaches inside its wall, in world pixels: about ten
 * screen pixels at any zoom, and never deeper than a tile and a half.
 */
const edgeBand = (zoom: number) =>
  Math.min(T * 1.5, Math.max(8, 10 / Math.max(zoom, 0.01)));

/** Topmost target at world point (x, y). */
export function townHitTest(
  context: TownHitContext,
  x: number,
  y: number,
): TownHit | null {
  const building = townBuildingAt(context.layout, x, y);
  if (!building) return null;
  if (context.roofAlpha(building.hostKey) > 0.5)
    return { kind: "building", key: building.hostKey };
  const pad = context.zoom < 0.9 ? 6 : 0;
  if (context.level !== "overview" || context.zoom >= 0.5) {
    const standing = [...context.standing()]
      .filter((actor) => actor.hostKey === building.hostKey)
      .sort((a, b) => b.y - a.y);
    for (const actor of standing)
      if (
        x >= actor.x - 9 * S - pad &&
        x <= actor.x + 9 * S + pad &&
        y >= actor.y - 22 * S - pad &&
        y <= actor.y + 3 + pad
      )
        return { kind: "agent", key: actor.key, standing: true };
  }
  const detailed = context.level === "desk";
  for (const room of building.rooms)
    for (const cell of room.cells) {
      if (!cell.deskKey) continue;
      const X = (cell.x + 1) * T;
      const Y = cell.y * T;
      if (x < X - 2 || x > X + 66 || y < Y || y > Y + 60) continue;
      if (detailed) {
        const desk = context.model.desks.get(cell.deskKey);
        // The seats as drawn: solo, face to face or a team table.
        for (let seat = 0; seat < townDeskSlots(cell.seats).length; seat += 1) {
          const { cx, top } = townSeat(cell, seat);
          if (Math.abs(x - cx) > 11 || !(top ? y < Y + 22 : y > Y + 34))
            continue;
          const device = desk?.paneDevices[seat];
          if (
            device?.agentKey &&
            context.model.agents.has(device.agentKey) &&
            (context.seated?.(device.agentKey) ?? true)
          )
            return { kind: "agent", key: device.agentKey };
          if (device)
            return { kind: "pane", key: device.key, deskKey: cell.deskKey };
        }
      }
      return { kind: "desk", key: cell.deskKey };
    }
  for (const room of building.rooms) {
    if (
      x < room.x * T ||
      x >= (room.x + room.w) * T ||
      y < room.y * T ||
      y >= (room.y + room.h) * T
    )
      continue;
    const cellIndex = room.cells.findIndex(
      (cell) =>
        !cell.deskKey &&
        x >= (cell.x + 1) * T - 2 &&
        x < (cell.x + 1) * T + 66 &&
        y >= cell.y * T + 4 &&
        y < cell.y * T + 58,
    );
    if (cellIndex >= 0 && detailed)
      return { kind: "cell", roomKey: room.key, cellIndex };
    const band = edgeBand(context.zoom);
    return x < room.x * T + band ||
      x >= (room.x + room.w) * T - band ||
      y < room.y * T + band ||
      y >= (room.y + room.h) * T - band
      ? { kind: "room", key: room.key, edge: true }
      : { kind: "room", key: room.key };
  }
  // Just outside a wall still holds the room's edge.
  const outside = Math.min(EDGE_OUTSIDE, edgeBand(context.zoom) / 2);
  for (const room of building.rooms)
    if (
      x >= room.x * T - outside &&
      x < (room.x + room.w) * T + outside &&
      y >= room.y * T - outside &&
      y < (room.y + room.h) * T + outside
    )
      return { kind: "room", key: room.key, edge: true };
  return { kind: "building", key: building.hostKey };
}

/** The selection key a hit maps to in the Office view. */
export function townHitKey(hit: TownHit | null) {
  if (!hit) return null;
  if (hit.kind === "cell") return hit.roomKey;
  if (hit.kind === "building") return null;
  return hit.key;
}
