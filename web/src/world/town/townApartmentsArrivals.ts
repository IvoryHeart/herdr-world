import { clock } from "../../clock";
/**
 * Agents Town has shown walking in at Apartments' door (TownBusLayer), so its
 * sign counts each as it goes in. The service makes it a resident when the
 * bus's trip ends, moments later (shared/bin.ts); until Apartments lists it,
 * or for at most a minute should its close not go through, it counts here.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { ApartmentResident } from "../../../../shared/apartments";

export type TownArrival = {
  /** The bin entry that rode in. */
  id: string;
  connection_id: string;
  terminal_id: string;
  /** When it went in (clock.monotonic()). */
  at: number;
  /** A ?townBusDemo rider: never a resident, so it counts until reload. */
  demo?: boolean;
};

/** An arrival counts this long at most without becoming a resident. */
export const TOWN_ARRIVAL_MS = 60_000;

let arrivals: readonly TownArrival[] = [];
const listeners = new Set<() => void>();

/** Count `arrival` in at the door, once per bin entry. */
export function townApartmentsArrive(arrival: TownArrival) {
  if (arrivals.some((known) => known.id === arrival.id)) return;
  arrivals = [...arrivals, arrival];
  for (const listener of listeners) listener();
}

/** Tests: forget every arrival. */
export function resetTownApartmentsArrivals() {
  arrivals = [];
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** Every arrival counted in so far. */
export const townApartmentsPending = () => arrivals;
const read = townApartmentsPending;

/**
 * The residents Apartments' sign counts at `now`: those it lists, and those
 * seen going in that it does not list yet.
 */
export function townApartmentsCount(
  residents: readonly Pick<
    ApartmentResident,
    "connection_id" | "terminal_id"
  >[],
  pending: readonly TownArrival[],
  now: number,
) {
  const listed = new Set(
    residents.map((r) => `${r.connection_id}\0${r.terminal_id}`),
  );
  return (
    residents.length +
    pending.filter(
      (arrival) =>
        !listed.has(`${arrival.connection_id}\0${arrival.terminal_id}`) &&
        (arrival.demo || now - arrival.at < TOWN_ARRIVAL_MS),
    ).length
  );
}

/**
 * The next moment an arrival seen by `now` stops counting, or undefined when
 * none will (demo riders, or every deadline already passed).
 */
export function townArrivalNextExpiry(
  pending: readonly TownArrival[],
  now: number,
) {
  let next: number | undefined;
  for (const arrival of pending) {
    if (arrival.demo) continue;
    const end = arrival.at + TOWN_ARRIVAL_MS;
    if (end > now && (next === undefined || end < next)) next = end;
  }
  return next;
}

/**
 * The arrivals, and a clock that ticks as each one stops counting. The clock
 * rearms after every tick, so riders arriving moments apart each expire on
 * their own deadline.
 */
export function useTownApartmentsArrivals() {
  const pending = useSyncExternalStore(subscribe, read, read);
  const [now, setNow] = useState(() => clock.monotonic());
  useEffect(() => {
    const next = townArrivalNextExpiry(pending, now);
    if (next === undefined) return;
    const timer = clock.setTimeout(
      () => setNow(clock.monotonic()),
      Math.max(0, next - clock.monotonic() + 20),
    );
    return () => clock.clearTimeout(timer);
  }, [pending, now]);
  return { pending, now };
}
