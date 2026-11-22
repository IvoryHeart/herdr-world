import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import {
  TOWN_HARBOUR_SIGN_ROW,
  TOWN_LANE_PITCH,
  TOWN_LANE_TOP,
  townHarbourGeometry,
  townLanePier,
  type TownHarbourLot,
} from "./townHarbourLot";

/**
 * Town's harbour (#1028): the Shipyard as a place at the town's right-most
 * edge, on open sea. Every project the Shipyard reads has its own shipping
 * lane: a pier from the promenade flying the project's flag, the next
 * release on the slipway at its root (the changes merged and waiting to
 * ship), its latest releases moored along it as ships in the project's
 * colours (a pennant while a World here runs one), and at its head a
 * beacon for main's checks. Open pull requests are not the harbour's: they
 * are cargo in the warehouse on the shore (townWarehouseModel.ts).
 *
 * Pure geometry for the layout, the landscape, the DOM layer
 * (TownShipyard.tsx) and tests.
 */

export {
  TOWN_HARBOUR_ROOM,
  TOWN_HARBOUR_SEA,
  TOWN_HARBOUR_SHORE,
  TOWN_LANE_PITCH,
  townHarbourFoldAt,
  townHarbourReserve,
  townLanePier,
  type TownHarbourLot,
} from "./townHarbourLot";

/**
 * The town's harbour, on every form factor: a phone's stacked town has its
 * shore and sea at the right edge too, reached by panning or zooming, and
 * its folded sign on the town center flies there (townHarbourView).
 */
export function townHarbourLot(layout: TownLayout): TownHarbourLot {
  return townHarbourGeometry(layout.width, layout.height, layout.center);
}

/**
 * The harbour placed for `drawn` lanes (a last "+N" lane included): the
 * sign and the lanes as one block, vertically centred on the sea's height
 * instead of starting at its top, never above their top rows. With fewer
 * projects than the sea holds, the Shipyard sits in the middle of its side
 * of Town.
 */
export function townHarbourPlaced(
  lot: TownHarbourLot,
  drawn: number,
): TownHarbourLot {
  const lanes = Math.min(Math.max(0, drawn), lot.lanes);
  const top = TOWN_HARBOUR_SIGN_ROW;
  const bottom = TOWN_LANE_TOP + lanes * TOWN_LANE_PITCH;
  const spare = lot.bottom - lot.top - top - bottom;
  return { ...lot, shift: Math.max(0, Math.floor(spare / 2)) };
}

/** The Shipyard sign's row, in tiles, once the harbour is placed. */
export const townHarbourSignRow = (lot: TownHarbourLot) =>
  TOWN_HARBOUR_SIGN_ROW + lot.shift;

/** Released ships a lane moors; older releases are the Releases tab's. */
export const TOWN_HARBOUR_BERTHS = 3;
/** A berth's width in tiles: one ship and the water round it. */
export const TOWN_BERTH_TILES = 4.5;
/** The pier's root before the slipway, in tiles: the lane's flag and sign. */
const PIER_ROOT = 2;
/**
 * The pier's head past its last berth, in tiles: the lighthouse stands
 * there, so no moored ship ever lies in front of it (#1148).
 */
export const TOWN_PIER_HEAD = 2;
/** A ship's drawing with its outline, in pixels (townHarbourArt.ts). */
export const TOWN_SHIP = { w: 68, h: 52 } as const;
/** Rows of a ship's drawing below its waterline. */
const SHIP_DRAFT = 3;
/**
 * The lighthouse's drawing (townHarbourArt.ts), in pixels: its size, its
 * left edge from the pier's head end, its foot below the deck's top edge,
 * and its lamp room's glass within it.
 */
export const TOWN_LIGHTHOUSE = {
  w: 20,
  h: 28,
  right: 26,
  foot: 0,
  lamp: { x: 4, y: 4, w: 12, h: 5 },
} as const;

/**
 * The project colours, in lane order: Town's shirt palette (townSprites.ts),
 * so ships and flags read as Town's. Eight lanes at most show, one colour
 * each.
 */
export const TOWN_PROJECT_COLORS = [
  "#4f7cc9",
  "#d9644a",
  "#59a86b",
  "#e0b33c",
  "#9b6ad6",
  "#3fa7a3",
  "#d65c8e",
  "#6b7a8f",
] as const;

export const townProjectColor = (lane: number) =>
  TOWN_PROJECT_COLORS[lane % TOWN_PROJECT_COLORS.length]!;

/**
 * Lane `lane`'s pier in world pixels: from the promenade's water edge out
 * to its head, `y` its deck's top edge.
 */
export function townLanePierAt(lot: TownHarbourLot, lane: number) {
  return {
    x: lot.coast * T,
    y: (townLanePier(lane) + lot.shift) * T,
    w:
      (PIER_ROOT +
        (TOWN_HARBOUR_BERTHS + 1) * TOWN_BERTH_TILES +
        TOWN_PIER_HEAD) *
      T,
  };
}

/**
 * The lighthouse on lane `lane`'s pier head in world pixels, and its lamp:
 * clear of every berth, and drawn above the ships (townHarbour.css), so
 * main's red or green always shows.
 */
export function townLighthouseAt(lot: TownHarbourLot, lane: number) {
  const pier = townLanePierAt(lot, lane);
  const x = pier.x + pier.w - TOWN_LIGHTHOUSE.right;
  const y = pier.y - TOWN_LIGHTHOUSE.h + TOWN_LIGHTHOUSE.foot;
  return {
    x,
    y,
    w: TOWN_LIGHTHOUSE.w,
    h: TOWN_LIGHTHOUSE.h,
    lamp: {
      x: x + TOWN_LIGHTHOUSE.lamp.x,
      y: y + TOWN_LIGHTHOUSE.lamp.y,
      w: TOWN_LIGHTHOUSE.lamp.w,
      h: TOWN_LIGHTHOUSE.lamp.h,
    },
  };
}

/** The slipway and the bollards on a pier, in pixels from its root. */
export const TOWN_PIER_SLIPWAY = {
  x: PIER_ROOT * T,
  w: TOWN_BERTH_TILES * T,
} as const;
export const TOWN_PIER_BOLLARDS = Array.from(
  { length: TOWN_HARBOUR_BERTHS },
  (_, i) => (PIER_ROOT + (i + 1.5) * TOWN_BERTH_TILES) * T,
);

/**
 * Berth `berth`'s ship top-left on lane `lane`, in world pixels: berth 0 is
 * the slipway by the promenade, then the released ships, newest first, out
 * towards the open sea. A ship lies along the pier's north side, its
 * waterline on the deck's edge.
 */
export function townBerthAt(lot: TownHarbourLot, lane: number, berth: number) {
  const pier = townLanePierAt(lot, lane);
  return {
    x:
      pier.x +
      (PIER_ROOT + berth * TOWN_BERTH_TILES) * T +
      (TOWN_BERTH_TILES * T - TOWN_SHIP.w) / 2,
    y: pier.y - TOWN_SHIP.h + SHIP_DRAFT,
  };
}

/** Where a lane's flag and name board stand: the pier's root. */
export function townLaneSignAt(lot: TownHarbourLot, lane: number) {
  const pier = townLanePierAt(lot, lane);
  return { x: pier.x + PIER_ROOT * T - 4, y: pier.y + 4 };
}

/**
 * What the folded sign's flight frames, in world pixels: from the
 * promenade across a whole pier to past its lighthouse, `top` the view's
 * top edge just above the harbour's sign, and the zoom that fits that width
 * into `usable` screen pixels. On a phone: the sign and the first lanes.
 */
export function townHarbourView(lot: TownHarbourLot, usable: number) {
  const pier = townLanePierAt(lot, 0);
  const left = lot.streetEnd * T;
  const right = pier.x + pier.w + 2 * T;
  return {
    x: (left + right) / 2,
    top: (townHarbourSignRow(lot) - 1) * T,
    z: Math.max(1, usable) / (right - left),
  };
}

/** How many lanes show; a last "+N" lane lists the rest. */
export function townLanesShown(lot: TownHarbourLot, projects: number) {
  return projects <= lot.lanes ? projects : Math.max(0, lot.lanes - 1);
}
