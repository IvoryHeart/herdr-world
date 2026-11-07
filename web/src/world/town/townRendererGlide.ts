/**
 * Tidy rooms' glide (townRoomTidy in townRoomPlace.ts): each room of the
 * building that moves floats, a little lifted, from where it stood to its new
 * spot, one shortly after another in reading order, and lands with a puff, as
 * a dropped room does. The rooms are snapshotted when the tidy begins; the
 * glide starts once the town shows the saved arrangement, so what lies
 * beneath is already true. Until a room lands, its new spot shows as an
 * empty outline. Calm or reduced motion skips the glide: rooms simply stand
 * in their new places.
 */

import { Graphics, Rectangle, Sprite, type Texture } from "pixi.js";
import { TOWN_TILE as T, type TownRoom } from "./townLayout";
import type { TownMoveResult } from "./townMoves";
import type { TownDragContext } from "./townRendererDrag";

/** Seconds one room takes to glide, and between one room's start and the next. */
export const TOWN_GLIDE_SECONDS = 0.55;
export const TOWN_GLIDE_STAGGER = 0.07;
/** How long a tidy may wait for the town to show it before the glide is dropped. */
const WAIT_SECONDS = 4;

/**
 * The `index`th gliding room's progress `t` seconds into the glide: how far
 * along its way (eased in and out), how high it floats (0..1) and whether it
 * has landed.
 */
export function townGlideProgress(t: number, index: number) {
  const raw = Math.min(
    1,
    Math.max(0, (t - index * TOWN_GLIDE_STAGGER) / TOWN_GLIDE_SECONDS),
  );
  const along = raw < 0.5 ? 4 * raw ** 3 : 1 - (-2 * raw + 2) ** 3 / 2;
  return { along, lift: Math.sin(Math.PI * raw), landed: raw >= 1 };
}

type Rect = { x: number; y: number; w: number; h: number };

const rectOf = (room: TownRoom): Rect => ({
  x: room.x * T,
  y: room.y * T,
  w: room.w * T,
  h: room.h * T,
});

type Glider = {
  key: string;
  from: Rect;
  to: Rect | null;
  texture: Texture;
  ghost: Sprite | null;
  shadow: Graphics | null;
  landed: boolean;
};

export function createTownRoomGlide(
  ctx: TownDragContext,
  quiet: () => boolean,
  puffAt: (x: number, y: number, count: number) => boolean,
) {
  let glide: {
    hostKey: string;
    began: number;
    started: number | null;
    refused: boolean;
    rooms: Glider[];
    covers: Graphics | null;
  } | null = null;

  const clear = () => {
    if (!glide) return;
    for (const room of glide.rooms) {
      room.ghost?.destroy();
      room.shadow?.destroy();
      room.texture.destroy(true);
    }
    glide.covers?.destroy();
    glide = null;
  };

  /** Snapshot the building's rooms as drawn, before the tidy is saved. */
  const begin = (hostKey: string) => {
    clear();
    const building = ctx.layout()?.buildings.find((b) => b.hostKey === hostKey);
    const container = ctx.buildingOf(hostKey);
    // Under its roof the rooms are hidden: there is nothing to watch.
    if (quiet() || !building || !container || ctx.roofAlpha(hostKey) > 0.05)
      return;
    glide = {
      hostKey,
      began: ctx.clock(),
      started: null,
      refused: false,
      covers: null,
      rooms: building.rooms.map((room) => {
        const from = rectOf(room);
        return {
          key: room.key,
          from,
          to: null,
          texture: ctx.app.renderer.generateTexture({
            target: container,
            frame: new Rectangle(from.x, from.y, from.w, from.h),
          }),
          ghost: null,
          shadow: null,
          landed: false,
        };
      }),
    };
  };

  /** How the tidy's save ended: one not saved glides nothing. */
  const finish = (result: TownMoveResult) => {
    if (glide && result !== "moved") glide.refused = true;
    ctx.request("glide-result");
  };

  /** Lift the rooms that move off their old spots, toward their new ones. */
  const start = (rooms: ReadonlyMap<string, Rect>) => {
    if (!glide) return;
    const moving: Glider[] = [];
    for (const room of glide.rooms) {
      const to = rooms.get(room.key);
      if (to && (to.x !== room.from.x || to.y !== room.from.y)) {
        room.to = to;
        moving.push(room);
      } else room.texture.destroy(true);
    }
    // One after another in their new reading order.
    moving.sort((a, b) => a.to!.y - b.to!.y || a.to!.x - b.to!.x);
    glide.rooms = moving;
    glide.covers = new Graphics();
    ctx.dragLayer.addChild(glide.covers);
    for (const room of moving) {
      room.shadow = new Graphics()
        .roundRect(
          -room.from.w / 2,
          -room.from.h / 2,
          room.from.w,
          room.from.h,
          6,
        )
        .fill({ color: 0x000000, alpha: 0.28 });
      room.ghost = new Sprite(room.texture);
      room.ghost.anchor.set(0.5);
      ctx.dragLayer.addChild(room.shadow, room.ghost);
    }
    glide.started = ctx.clock();
  };

  /** Advance the glide; true while a room still moves. */
  const update = () => {
    if (!glide) return false;
    const clock = ctx.clock();
    if (glide.started === null) {
      if (glide.refused || clock - glide.began > WAIT_SECONDS) {
        clear();
        return false;
      }
      const building = ctx
        .layout()
        ?.buildings.find((b) => b.hostKey === glide!.hostKey);
      const now = new Map(
        building?.rooms.map((room) => [room.key, rectOf(room)]) ?? [],
      );
      // Not yet: the town still shows the rooms where they stood.
      if (
        !glide.rooms.some((room) => {
          const to = now.get(room.key);
          return to && (to.x !== room.from.x || to.y !== room.from.y);
        })
      )
        return false;
      start(now);
    }
    const t = clock - glide.started!;
    const covers = glide.covers!;
    covers.clear();
    let moving = false;
    glide.rooms.forEach((room, index) => {
      if (room.landed) return;
      const { along, lift, landed } = townGlideProgress(t, index);
      const { from, to } = room as Glider & { to: Rect };
      if (landed) {
        room.landed = true;
        room.ghost!.visible = false;
        room.shadow!.visible = false;
        puffAt(to.x + to.w / 2, to.y + to.h, 14);
        return;
      }
      moving = true;
      // Its new spot stays an empty outline until it lands there.
      covers
        .rect(to.x, to.y, to.w, to.h)
        .fill({ color: 0x1b1d24, alpha: 0.85 })
        .stroke({ color: 0xe8dcc4, width: 2, alpha: 0.5 });
      const x = from.x + (to.x - from.x) * along + from.w / 2;
      const y = from.y + (to.y - from.y) * along + from.h / 2;
      room.ghost!.position.set(x, y - lift * 10);
      room.shadow!.position.set(x + 6 * lift, y + 8 * lift);
      room.shadow!.alpha = Math.min(1, lift * 1.5);
    });
    if (!moving) clear();
    return moving;
  };

  return {
    begin,
    finish,
    update,
    clear,
    /** A tidy waits for the town to show it, or its rooms glide. */
    active: () => glide !== null,
  };
}
