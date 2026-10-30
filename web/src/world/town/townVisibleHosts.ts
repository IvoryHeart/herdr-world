import type { TownLevel } from "./townCamera";
import { TOWN_FACADE, TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownRendererHandle } from "./townRenderer";

/* ---------- DOM world layer ---------- */

export type TownVisible = {
  key: string;
  hosts: ReadonlySet<string>;
  /** Room cards are drawn only from the overview level up to the room level. */
  cards: boolean;
  /** Rooms on screen whose desks carry name tags (room and desk levels). */
  tagRooms: ReadonlySet<string>;
};

export const NOTHING_VISIBLE: TownVisible = {
  key: "",
  hosts: new Set(),
  cards: false,
  tagRooms: new Set(),
};

/** Buildings within half a viewport of the screen, plus whether cards show. */
export function townVisibleHosts(
  camera: TownRendererHandle["camera"],
  layout: TownLayout,
  level: TownLevel,
): TownVisible {
  const { width, height } = camera.viewport;
  const left = camera.toWorld(-width / 2, -height / 2);
  const right = camera.toWorld(width * 1.5, height * 1.5);
  const hosts: string[] = [];
  for (const b of layout.buildings)
    if (
      b.x * T < right.x &&
      (b.x + b.w) * T > left.x &&
      (b.y - 2) * T < right.y &&
      (b.y + b.h + TOWN_FACADE + 8) * T > left.y
    )
      hosts.push(b.hostKey);
  const cards = level === "overview" || level === "room";
  // Name tags only for rooms on screen, so a large town adds few elements.
  const tagRooms: string[] = [];
  if (level === "room" || level === "desk") {
    const from = camera.toWorld(0, 0);
    const to = camera.toWorld(width, height);
    for (const b of layout.buildings)
      for (const room of b.rooms)
        if (
          room.x * T < to.x &&
          (room.x + room.w) * T > from.x &&
          room.y * T < to.y &&
          (room.y + room.h) * T > from.y
        )
          tagRooms.push(room.key);
  }
  return {
    key: `${cards ? 1 : 0}:${hosts.join("\u0000")}:${tagRooms.join("\u0000")}`,
    hosts: new Set(hosts),
    cards,
    tagRooms: new Set(tagRooms),
  };
}
