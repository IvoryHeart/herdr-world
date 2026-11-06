import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../../api";
import { WorldBinStore, type WorldBin } from "./binStore";

let shared: WorldBinStore | null = null;

/** The page's one bin store, on World's bridge. */
export function worldBinStore() {
  shared ??= new WorldBinStore(bridge);
  return shared;
}

/** The bin, kept fresh while any component shows it. */
export function useWorldBin(): WorldBin {
  const bin = worldBinStore();
  useEffect(() => {
    bin.start();
    return () => bin.stop();
  }, [bin]);
  return useSyncExternalStore(bin.subscribe, bin.get, bin.get);
}
