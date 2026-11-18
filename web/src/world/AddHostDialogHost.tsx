import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConnectionManagerDialog } from "../components/ConnectionSwitcher";
import { store, useStoreSelector } from "../store";
import { worldHosts } from "../worldHosts";
import {
  addedConnection,
  hostArrivals,
  hostsFilterWith,
  onAddHostRequest,
} from "./addHost";
import type { HostsFilter } from "./hostsFilter";

/**
 * Where Add building and Add host open Manage connections (addHost.ts). Each
 * connection added while it is open becomes the arrival, and the Hosts
 * filter takes it in so the views can show it.
 */
export function AddHostDialogHost({
  hostsFilter,
}: {
  hostsFilter: { ids: HostsFilter; setIds(ids: HostsFilter): void };
}) {
  const [open, setOpen] = useState(false);
  const known = useRef<Set<string>>(new Set());
  const filter = useRef(hostsFilter);
  filter.current = hostsFilter;
  useEffect(
    () =>
      onAddHostRequest(() => {
        known.current = new Set(worldHosts(store.get()).map(({ id }) => id));
        setOpen(true);
      }),
    [],
  );
  // Herdr and herdr-core connections alike (worldHosts), as Hosts lists them.
  const connections = useStoreSelector(worldHosts);
  useEffect(() => {
    if (!open) return;
    const id = addedConnection(known.current, connections);
    if (!id) return;
    known.current.add(id);
    const { ids, setIds } = filter.current;
    const shown = hostsFilterWith(ids, id);
    if (shown !== ids) setIds(shown);
    hostArrivals.arrive(id);
  }, [open, connections]);
  return open
    ? createPortal(
        <ConnectionManagerDialog onClose={() => setOpen(false)} />,
        document.body,
      )
    : null;
}
