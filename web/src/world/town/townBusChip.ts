import type { BinEntry } from "../../../../shared/bin";
import type { TownBusScene } from "./scene/townBus";
import type { TownLayout } from "./townLayout";
import { STOP_W } from "./townBusGeometry";

/**
 * The stop the chip points at: where the departure whose clock it shows waits
 * (that trip's last occupied stop), else the main stop. Its pole's foot, world px.
 */
export const townBusChipStop = (
  l: TownLayout,
  scene: TownBusScene | null | undefined,
  entries: readonly BinEntry[],
  remaining: (entry: BinEntry) => number,
) => {
  const soon = soonestTownBus(entries, remaining);
  const stopIds = new Set(
    entries
      .filter((entry) => entry.trip === soon?.trip)
      .map((entry) => scene?.stopOf.get(entry.id)),
  );
  const occupied = scene?.stops.filter((stop) => stopIds.has(stop.id)).pop();
  return occupied
    ? {
        pole: occupied.box.x + STOP_W / 2,
        foot: occupied.box.y + occupied.box.h,
      }
    : { pole: l.busStop.x * 16 + 8, foot: l.busStop.y * 16 + 16 };
};

/**
 * The soonest bus's clock, from the bin's own state rather than the last
 * drawn frame, so a boarding shows at once: its wait left, or leaving.
 */
export const soonestTownBus = (
  entries: readonly BinEntry[],
  remaining: (entry: BinEntry) => number,
) => {
  if (!entries.length) return null;
  const selected = entries
    .map((entry) => ({
      trip: entry.trip,
      left: remaining(entry) - entry.departure_ms,
    }))
    .reduce((soon, entry) => (entry.left < soon.left ? entry : soon));
  return {
    trip: selected.trip,
    remaining: Math.max(0, selected.left),
    leaving: selected.left < 0,
  };
};
