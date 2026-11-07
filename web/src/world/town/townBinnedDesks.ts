/**
 * The desks a bin drop is taking away. While an agent waits for the bus its
 * seat fades into the room's carpet and crumbs fall from it, so the desk
 * reads as going and no longer in use; when every agent at a desk is
 * binned the whole desk fades. Putting an agent back clears its seat.
 */

import { Graphics, type Container } from "pixi.js";
import {
  townDeskSlots,
  townDeskTable,
  TOWN_TILE as T,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import { townHash } from "./townSprites";

/** A faded area; `key` names what is binned there (a seat or the desk). */
export type TownBinnedRect = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** One desk with binned agents, in world pixels. */
export type TownBinnedDesk = {
  deskKey: string;
  hostKey: string;
  roomKey: string;
  /** Every agent at the desk is binned: the whole desk fades. */
  whole: boolean;
  /** The faded areas: the whole desk, or each binned agent's seat. */
  rects: TownBinnedRect[];
  /** Just above the desk's own sprites, below anyone walking in front. */
  z: number;
};

/** A seat's or the whole desk's area, chairs included (bakeTownPod). */
function deskRects(
  deskKey: string,
  cell: { x: number; y: number; seats: number },
  seats: readonly number[] | null,
): TownBinnedRect[] {
  const X = (cell.x + 1) * T;
  const Y = cell.y * T;
  if (!seats) {
    const table = townDeskTable(cell.seats);
    return [
      { key: deskKey, x: X + table.x - 1, y: Y + 2, w: table.w + 2, h: 53 },
    ];
  }
  const slots = townDeskSlots(cell.seats);
  return seats.flatMap((seat) => {
    const slot = slots[seat];
    if (!slot) return [];
    // A top seat's chair, person and near half of the table; a bottom
    // seat's far half of the table and its chair back.
    return [
      slot.top
        ? {
            key: `${deskKey}#${seat}`,
            x: X + slot.chairX - 2,
            y: Y + 2,
            w: 18,
            h: 31,
          }
        : {
            key: `${deskKey}#${seat}`,
            x: X + slot.chairX - 2,
            y: Y + 33,
            w: 18,
            h: 22,
          },
    ];
  });
}

/** The desks of `away` (binned) agents, as laid out now. */
export function townBinnedDesks(
  layout: TownLayout,
  model: Pick<TownModel, "agentSeats" | "desks">,
  away: ReadonlySet<string>,
): TownBinnedDesk[] {
  if (!away.size) return [];
  const seatsOf = new Map<string, number[]>();
  for (const key of away) {
    const seat = model.agentSeats.get(key);
    if (!seat) continue;
    const list = seatsOf.get(seat.deskKey) ?? [];
    list.push(seat.seat);
    seatsOf.set(seat.deskKey, list);
  }
  if (!seatsOf.size) return [];
  const desks: TownBinnedDesk[] = [];
  for (const building of layout.buildings)
    for (const room of building.rooms)
      for (const cell of room.cells) {
        const seats = cell.deskKey ? seatsOf.get(cell.deskKey) : undefined;
        if (!seats || !cell.deskKey) continue;
        const devices = model.desks.get(cell.deskKey)?.paneDevices ?? [];
        const whole =
          devices.length > 0 &&
          devices.every(
            (device) => device.agentKey && away.has(device.agentKey),
          );
        desks.push({
          deskKey: cell.deskKey,
          hostKey: building.hostKey,
          roomKey: room.key,
          whole,
          rects: deskRects(
            cell.deskKey,
            cell,
            whole ? null : [...seats].sort((a, b) => a - b),
          ),
          z: cell.y * T + 53,
        });
      }
  return desks;
}

/** How long a binned seat takes to fade, in seconds. */
export const TOWN_BINNED_FADE_S = 1.5;
/** How far the faded seat goes towards the carpet. */
const VEIL = 0.62;
/** Crumbs per faded area, and their fall each loop, in pixels. */
const CRUMBS = 4;
const FALL = 9;
/** Crumb frames a second: a few, in step with the pixel art. */
export const TOWN_CRUMB_RATE = 6;

/**
 * Draw one binned desk into `g` at `clock` (seconds): over each faded area,
 * from when it was first seen binned (`since`), a veil of its room's carpet
 * colour fading in, and crumbs falling from it (none with reduced motion).
 * Returns whether it still changes after this frame.
 */
export function drawTownBinnedDesk(
  g: Graphics,
  desk: TownBinnedDesk,
  carpet: string,
  clock: number,
  since: (key: string) => number,
  still: boolean,
): boolean {
  g.clear();
  let moving = false;
  for (const rect of desk.rects) {
    const seconds = clock - since(rect.key);
    const fade = still
      ? 1
      : Math.min(1, Math.max(0, seconds / TOWN_BINNED_FADE_S));
    const eased = fade * (2 - fade);
    g.rect(rect.x, rect.y, rect.w, rect.h).fill({
      color: carpet,
      alpha: VEIL * eased,
    });
    if (still) continue;
    moving = true;
    const step = Math.floor(seconds * TOWN_CRUMB_RATE);
    for (let i = 0; i < CRUMBS; i += 1) {
      const seed = townHash(`${rect.key}:${i}`);
      const drop = (step + (seed % FALL)) % FALL;
      const x = rect.x + 2 + ((seed >>> 4) % Math.max(1, rect.w - 4));
      const y = rect.y + rect.h - 6 + drop;
      g.rect(x, y, 2, 2).fill({
        color: 0x5a4a3c,
        alpha: eased * (1 - drop / FALL) * 0.85,
      });
    }
  }
  return moving;
}

/** What the binned desks read from the renderer. */
export type TownBinnedDeskPorts = {
  /** The building's container its desks' sprites live in, once built. */
  container(hostKey: string): Container | undefined;
  /** A room's carpet colour (#rrggbb). */
  carpet(roomKey: string): string;
  visible(g: Graphics): boolean;
};

/**
 * The binned desks' drawings: `sync` after the model, layout or bin
 * changed, `update` each frame. A drawing lives in its building's container
 * (so roofs cover it and a re-bake drops it) and is made again when gone.
 */
export function createTownBinnedDesks(ports: TownBinnedDeskPorts) {
  let desks: TownBinnedDesk[] = [];
  const views = new Map<string, Graphics>();
  const since = new Map<string, number>();
  return {
    sync(
      layout: TownLayout,
      model: Pick<TownModel, "agentSeats" | "desks">,
      away: ReadonlySet<string>,
    ) {
      desks = townBinnedDesks(layout, model, away);
    },
    /** Draw this frame; true when a visible desk changes again soon. */
    update(clock: number, still: boolean): boolean {
      const keys = new Set<string>();
      const live = new Set<string>();
      let moving = false;
      for (const desk of desks) {
        for (const rect of desk.rects) {
          keys.add(rect.key);
          if (!since.has(rect.key)) since.set(rect.key, clock);
        }
        const parent = ports.container(desk.hostKey);
        if (!parent) continue;
        let g = views.get(desk.deskKey);
        if (!g || g.destroyed || g.parent !== parent) {
          if (g && !g.destroyed) g.destroy();
          g = createTownBinnedDeskView(parent, desk.z);
          views.set(desk.deskKey, g);
        }
        g.zIndex = desk.z;
        live.add(desk.deskKey);
        const changes = drawTownBinnedDesk(
          g,
          desk,
          ports.carpet(desk.roomKey),
          clock,
          (key) => since.get(key) ?? clock,
          still,
        );
        if (changes && ports.visible(g)) moving = true;
      }
      for (const [deskKey, g] of views)
        if (!live.has(deskKey)) {
          if (!g.destroyed) g.destroy();
          views.delete(deskKey);
        }
      for (const key of since.keys()) if (!keys.has(key)) since.delete(key);
      return moving;
    },
    clear() {
      for (const g of views.values()) if (!g.destroyed) g.destroy();
      views.clear();
    },
  };
}

/** A binned desk's drawing in its building, above the desk's sprites. */
function createTownBinnedDeskView(parent: Container, z: number) {
  const g = new Graphics();
  g.zIndex = z;
  g.label = "binned-desk";
  parent.addChild(g);
  return g;
}
