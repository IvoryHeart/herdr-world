import { TOWN_TILE, type TownLayout } from "./townLayout";
import { townHarbourLotBeside, type TownHarbourLot } from "./townHarbourLot";

/**
 * Town's harbour (#1028): the Shipyard's release pipeline as a place. Main's
 * checks are the lighthouse's lamp, changes merged and waiting for the next
 * release are cargo crates on the quay, releases are ships moored in the
 * basin (newest by the quay crane), and a ship flies a green pennant while a
 * World on this computer runs its version. It reads only the Shipyard read
 * model (shipyard/shipyardModel.ts) the Work lens's Releases tab reads.
 *
 * Pure geometry for the painter (townHarbourPaint.ts), the landscape, the
 * DOM layer (TownShipyard.tsx) and tests.
 */

export {
  TOWN_HARBOUR_BASIN_ROWS,
  TOWN_HARBOUR_QUAY_ROWS,
  TOWN_HARBOUR_WIDTH,
  townHarbourFoldAt,
  townHarbourReserve,
  type TownHarbourLot,
} from "./townHarbourLot";

/**
 * The harbour's lot: right of the town center on the first street. A
 * narrow (stacked) town folds it to a sign on the town center instead.
 */
export function townHarbourLot(layout: TownLayout): TownHarbourLot | null {
  if (layout.formFactor === "narrow") return null;
  return townHarbourLotBeside(layout.center);
}

/** Ships the basin moors; older releases are the Releases tab's. */
export const TOWN_HARBOUR_BERTHS = 3;
/** Crates the quay stacks; more show as a "+N" tally. */
export const TOWN_HARBOUR_CRATES = 10;

/** The lighthouse lamp's centre, in pixels from the lot's top-left. */
export const TOWN_HARBOUR_LAMP = { x: 15, y: 12 } as const;

/**
 * Berth `index`'s top-left in the basin, in pixels from the lot's top-left:
 * the newest release (index 0) by the crane at the right, older ones to its
 * left. A ship is 56 pixels wide and 44 tall, hull on the quay wall.
 */
export function townHarbourBerth(index: number) {
  return { x: 166 - index * 66, y: 58 };
}

/** Crate `index`'s top-left on the quay, in pixels from the quay's top-left. */
export function townHarbourCrate(index: number) {
  const perRow = TOWN_HARBOUR_CRATES / 2;
  return {
    x: 14 + (index % perRow) * 17 + (Math.floor(index / perRow) % 2) * 8,
    y: 22 - Math.floor(index / perRow) * 10,
  };
}

/** The quay's top-left in world pixels. */
export const townHarbourQuayAt = (lot: TownHarbourLot) => ({
  x: lot.x * TOWN_TILE,
  y: lot.quayY * TOWN_TILE,
});
