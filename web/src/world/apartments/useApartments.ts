import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../api";
import {
  type ApartmentsClient,
  WorldApartmentsStore,
  type WorldApartmentsState,
} from "./apartmentsStore";

export { openApartments, WORLD_APARTMENTS_EVENT } from "./apartmentsStore";

let shared: WorldApartmentsStore | null = null;

/** The page's one Apartments store, on World's bridge. */
export function worldApartmentsStore() {
  shared ??= new WorldApartmentsStore(bridge);
  return shared;
}

/** Tests: the page's store answers from this client instead. */
export function setApartmentsClient(client: ApartmentsClient) {
  shared = new WorldApartmentsStore(client);
}

/** Apartments, kept fresh while any component shows them. */
export function useApartments(): WorldApartmentsState {
  const store = worldApartmentsStore();
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
