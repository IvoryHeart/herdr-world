/**
 * Add building (Town's town center) and Add host (Board's hub) open the one
 * add-a-connection flow, Hosts → Manage connections, unchanged
 * (AddHostDialogHost.tsx). A connection added while it is open is the
 * arrival: the Hosts filter takes it in, and the view in use moves to its
 * building or zone once that shows, then settles the arrival. Closing the
 * flow without adding one changes nothing.
 */

import { useMemo, useSyncExternalStore } from "react";
import type { HostsFilter } from "./hostsFilter";

const OPEN_EVENT = "world-add-host";

/** Open the add-a-connection flow on its first step. */
export const requestAddHost = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Listen for Add building / Add host; returns the unsubscribe. */
export function onAddHostRequest(open: () => void) {
  window.addEventListener(OPEN_EVENT, open);
  return () => window.removeEventListener(OPEN_EVENT, open);
}

/** A connection the flow added; a new `seq` asks the views again. */
export type HostArrival = { connectionId: string; seq: number };

let arrival: HostArrival | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const hostArrivals = {
  get: () => arrival,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** The flow added `connectionId`: the views move to it when it shows. */
  arrive(connectionId: string) {
    arrival = { connectionId, seq: ++sequence };
    emit();
  },
  /** A view moved to arrival `seq`; a newer arrival stays. */
  settle(seq: number) {
    if (arrival?.seq !== seq) return;
    arrival = null;
    emit();
  },
};

/** The connection the views should move to, if any. */
export const useHostArrival = () =>
  useSyncExternalStore(hostArrivals.subscribe, hostArrivals.get, () => null);

/**
 * The arrival's host among `hosts` (its `key`, a Town building's host key or
 * a World host ID), once it shows there; null before then and when nothing
 * is arriving.
 */
export function useHostArrivalIn<H extends { connectionId: string }>(
  hosts: readonly H[],
  key: (host: H) => string,
) {
  const arrival = useHostArrival();
  const host = arrival
    ? hosts.find((host) => host.connectionId === arrival.connectionId)
    : undefined;
  const hostKey = host ? key(host) : undefined;
  const seq = arrival?.seq;
  return useMemo(
    () => (hostKey && seq !== undefined ? { hostKey, seq } : null),
    [hostKey, seq],
  );
}

/**
 * The connection the flow added: the newest one not there when it opened, or
 * null (cancelled, or only edited, tested or removed).
 */
export function addedConnection(
  before: ReadonlySet<string>,
  now: readonly { id: string }[],
): string | null {
  for (let index = now.length - 1; index >= 0; index -= 1) {
    const id = now[index]!.id;
    if (!before.has(id)) return id;
  }
  return null;
}

/** The Hosts filter that also shows `id`; All hosts stays All hosts. */
export const hostsFilterWith = (ids: HostsFilter, id: string): HostsFilter =>
  ids === null || ids.includes(id) ? ids : [...ids, id];
