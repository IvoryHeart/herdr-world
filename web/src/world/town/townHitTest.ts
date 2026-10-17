import type { TownLevel } from "./townCamera";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townDeskSlots,
  townSeat,
  type TownBuilding,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";

export type TownHit =
  | { kind: "agent"; key: string }
  | { kind: "pane"; key: string; deskKey: string }
  | { kind: "desk"; key: string }
  | { kind: "cell"; roomKey: string; cellIndex: number }
  | { kind: "room"; key: string }
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
        x >= actor.x - 9 - pad &&
        x <= actor.x + 9 + pad &&
        y >= actor.y - 22 - pad &&
        y <= actor.y + 3 + pad
      )
        return { kind: "agent", key: actor.key };
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
          if (device?.agentKey && context.model.agents.has(device.agentKey))
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
    return { kind: "room", key: room.key };
  }
  return { kind: "building", key: building.hostKey };
}

/** The selection key a hit maps to in the Office view. */
export function townHitKey(hit: TownHit | null) {
  if (!hit) return null;
  if (hit.kind === "cell") return hit.roomKey;
  if (hit.kind === "building") return null;
  return hit.key;
}
