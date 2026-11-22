/**
 * The order of a Town room's pinned desks on its rug. Pinned desks move as
 * pinned browser tabs do: among the pinned seats only. Their order is World's
 * own view layout (useDeskPins.ts `saveDeskPinOrder`), since Herdr's apps
 * have no order for pins; without one they follow tab order.
 */

import type {
  HerdrOfficeProjection,
  OfficeRoom,
} from "../herdrOfficeProjection";
import type { DeskPins } from "../useDeskPins";
import { townPinnedOrder } from "./townLayout";
import { townDeskPinKey } from "./townModel";

/** A pinned desk: its desk key and the key its pin is saved under. */
export type TownPinnedSeat = { deskKey: string; pinKey: string };

/** A room's pinned desks, front first, as Town seats them (townLayout.ts). */
export function townRoomPinnedSeats(
  office: HerdrOfficeProjection,
  room: OfficeRoom,
  deskPins: DeskPins,
): TownPinnedSeat[] {
  const pinKeys = new Map<string, string>();
  const ranks = new Map<string, number | null>();
  for (const desk of room.desks) {
    const pinKey = townDeskPinKey(office, desk);
    const pin = pinKey ? deskPins[pinKey] : undefined;
    if (!pinKey || !pin) continue;
    pinKeys.set(desk.key, pinKey);
    ranks.set(desk.key, pin.rank ?? null);
  }
  return townPinnedOrder(
    room.desks.map((desk) => desk.key),
    ranks,
  ).map((deskKey) => ({ deskKey, pinKey: pinKeys.get(deskKey)! }));
}

/**
 * The pinned seats with `deskKey` in `ontoKey`'s place, as a drop onto that
 * desk puts it; null when either is not among them or nothing changes.
 */
export function townPinnedReorder<T extends { deskKey: string }>(
  seats: readonly T[],
  deskKey: string,
  ontoKey: string,
): T[] | null {
  const from = seats.findIndex((seat) => seat.deskKey === deskKey);
  const to = seats.findIndex((seat) => seat.deskKey === ontoKey);
  if (from < 0 || to < 0 || from === to) return null;
  const next = seats.filter((seat) => seat.deskKey !== deskKey);
  next.splice(to, 0, seats[from]!);
  return next;
}
