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
  /** When it went in (performance.now()). */
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

/** The arrivals, and a clock that ticks when the oldest stops counting. */
export function useTownApartmentsArrivals() {
  const pending = useSyncExternalStore(subscribe, read, read);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    const ends = pending
      .filter((arrival) => !arrival.demo)
      .map((arrival) => arrival.at + TOWN_ARRIVAL_MS)
      .filter((end) => end > performance.now());
    if (!ends.length) return;
    const timer = setTimeout(
      () => setNow(performance.now()),
      Math.min(...ends) - performance.now() + 20,
    );
    return () => clearTimeout(timer);
  }, [pending]);
  return { pending, now };
}
