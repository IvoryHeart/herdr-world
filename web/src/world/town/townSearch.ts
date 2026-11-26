/**
 * Town's search on the map (#159): which rooms and buildings hold a match,
 * where each match is drawn, and how many are off-screen. Matches light up;
 * the rest of Town dims a little (townSelectionEffects.ts).
 */

import {
  worldSearchWords,
  worldTextMatches,
  type WorldSearchResult,
} from "../worldSearch";
import { findCell } from "./townCameraTargets";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townSeat,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import {
  townWarehouseLot,
  TOWN_WAREHOUSE_YARD_ROWS,
} from "./townWarehouseModel";
import { townBuildingOf } from "./townBuildings";

/**
 * The warehouse's search key: Town's landmark, not a World node. It holds
 * your pull requests on the harbour shore (#1028).
 */
export const TOWN_WAREHOUSE_SEARCH_KEY = "town:warehouse";

/**
 * Town's landmarks the search finds besides World's nodes (#1033): its
 * name, then the words it also answers to.
 */
const TOWN_LANDMARKS = [
  {
    key: TOWN_WAREHOUSE_SEARCH_KEY,
    label: "Warehouse",
    also: "pull requests crates parcels github harbour",
  },
] as const;

/** Town's landmarks a query finds, names before what they hold. */
export function townLandmarkResults(rawQuery: string): WorldSearchResult[] {
  const words = worldSearchWords(rawQuery);
  return TOWN_LANDMARKS.flatMap((landmark) => {
    const name = landmark.label.toLocaleLowerCase();
    if (!worldTextMatches(`${name} ${landmark.also}`, words)) return [];
    return [
      {
        id: landmark.key,
        nodeId: landmark.key,
        kind: "landmark" as const,
        label: landmark.label,
        place: ["Pull requests"],
        status: null,
        stale: false,
        excerpt: null,
        rank: worldTextMatches(name, words) ? 0 : 1,
      },
    ];
  });
}

/** Whether a Town key is one of its landmarks, not a World node. */
export const townLandmarkKey = (key: string) =>
  TOWN_LANDMARKS.some((landmark) => landmark.key === key);

/** What a search lights up: its matches' keys and the places holding them. */
export type TownSearchLight = {
  keys: ReadonlySet<string>;
  rooms: ReadonlySet<string>;
  hosts: ReadonlySet<string>;
  /** The chosen match, which pulses once per `seq` (unless calm). */
  pulse: { key: string; seq: number } | null;
  /**
   * A lens is on: its layer, over the canvas, draws the outlines and pulse
   * (TownLensSearch.tsx), so they read above the lens. The canvas dims.
   */
  overLens?: boolean;
};

/** A world-pixel rectangle. */
export type TownSearchRect = { x: number; y: number; w: number; h: number };

export type TownActorPosition = (
  key: string,
) => { x: number; y: number; seated: boolean } | null;

/** The room and building each match is in, for the dim. */
export function townSearchLight(
  model: TownModel,
  keys: readonly string[],
  pulse: TownSearchLight["pulse"] = null,
): TownSearchLight {
  const rooms = new Set<string>();
  const hosts = new Set<string>();
  const place = (roomKey: string | undefined, hostKey: string | undefined) => {
    if (roomKey) rooms.add(roomKey);
    if (hostKey) hosts.add(hostKey);
  };
  for (const key of keys) {
    if (model.hosts.has(key)) hosts.add(key);
    const room = model.rooms.get(key);
    if (room) place(room.key, townBuildingOf(room));
    const desk = model.desks.get(key);
    if (desk) place(desk.roomKey, townBuildingOf(desk));
    const agent = model.agents.get(key);
    if (agent) place(agent.roomKey, townBuildingOf(agent));
    const device = model.devices.get(key);
    if (device) place(device.roomKey, townBuildingOf(device));
  }
  return { keys: new Set(keys), rooms, hosts, pulse };
}

const roomRect = (layout: TownLayout, roomKey: string | undefined) => {
  if (!roomKey) return null;
  for (const building of layout.buildings)
    for (const room of building.rooms)
      if (room.key === roomKey)
        return { x: room.x * T, y: room.y * T, w: room.w * T, h: room.h * T };
  return null;
};

const deskRect = (layout: TownLayout, deskKey: string | null | undefined) => {
  const cell = deskKey ? findCell(layout, deskKey) : null;
  return cell ? { x: cell.x * T, y: cell.y * T, w: 6 * T, h: 4 * T } : null;
};

/**
 * Where a match is drawn, in world pixels: an agent where it sits or
 * stands, a table or terminal at its table, a room, building or the
 * warehouse whole. One
 * Town does not draw is null, such as a table, or anything at a table, that
 * its room folds away: its room is not where it can be seen.
 */
export function townSearchRect(
  key: string,
  model: TownModel,
  layout: TownLayout,
  actorPosition: TownActorPosition,
): TownSearchRect | null {
  if (key === TOWN_WAREHOUSE_SEARCH_KEY) {
    const lot = townWarehouseLot(layout);
    return {
      x: lot.x * T,
      y: lot.y * T,
      w: lot.w * T,
      h: (lot.yardY + TOWN_WAREHOUSE_YARD_ROWS - lot.y) * T,
    };
  }
  const building = layout.buildings.find(
    (candidate) => candidate.hostKey === key,
  );
  if (building)
    return {
      x: building.x * T,
      y: building.y * T,
      w: building.w * T,
      h: (building.h + TOWN_FACADE) * T,
    };
  if (model.rooms.has(key)) return roomRect(layout, key);
  if (model.desks.has(key)) return deskRect(layout, key);
  const device = model.devices.get(key);
  if (device)
    return device.deskKey
      ? deskRect(layout, device.deskKey)
      : roomRect(layout, device.roomKey);
  const agent = model.agents.get(key);
  if (!agent) return null;
  const position = actorPosition(key);
  if (position?.seated) {
    const seat = model.agentSeats.get(key);
    const cell = seat && findCell(layout, seat.deskKey);
    if (seat && cell) {
      const geometry = townSeat(cell, seat.seat);
      const y = geometry.top ? geometry.tableY - 8 : geometry.tableY + 24;
      return { x: geometry.cx - 10, y, w: 20, h: 32 };
    }
  }
  if (position) return { x: position.x - 10, y: position.y - 28, w: 20, h: 32 };
  return agent.deskKey
    ? deskRect(layout, agent.deskKey)
    : roomRect(layout, agent.roomKey);
}

/** Whether a world rectangle shows inside the viewport, past its insets. */
export function townRectOnScreen(
  rect: TownSearchRect,
  camera: {
    toScreen(x: number, y: number): { x: number; y: number };
    viewport: {
      width: number;
      height: number;
      inset: { top: number; right: number; bottom: number; left: number };
    };
  },
) {
  const a = camera.toScreen(rect.x, rect.y);
  const b = camera.toScreen(rect.x + rect.w, rect.y + rect.h);
  const { width, height, inset } = camera.viewport;
  return (
    b.x > inset.left &&
    a.x < width - inset.right &&
    b.y > inset.top &&
    a.y < height - inset.bottom
  );
}

/** How many matches are not on screen, those Town does not draw included. */
export function townSearchOffscreen(
  keys: Iterable<string>,
  rectOf: (key: string) => TownSearchRect | null,
  onScreen: (rect: TownSearchRect) => boolean,
) {
  let count = 0;
  for (const key of keys) {
    const rect = rectOf(key);
    if (!rect || !onScreen(rect)) count += 1;
  }
  return count;
}
