import { useSyncExternalStore } from "react";
import type { HostGrouping } from "../../../shared/hostGrouping";
import { type HostGroupOf, hostGroupOf } from "../worldHosts";
import { worldRuntimeStore } from "./runtimeStore";

const publishedHostGrouping = () => worldRuntimeStore.get().hostGrouping;

/**
 * How World groups its runtimes, as published under the replica's revision
 * (`host_grouping`, shared/hostGrouping.ts). Town, Desk, the navigator,
 * Board, Spaces and the Hosts control all read this one value; the replica
 * keeps its object while it is unchanged, so a revision that regroups
 * nothing re-renders no view that reads it.
 */
export function useHostGrouping(): HostGrouping | undefined {
  return useSyncExternalStore(
    worldRuntimeStore.subscribe,
    publishedHostGrouping,
    publishedHostGrouping,
  );
}

/**
 * Each connection's published group. Groups give a key and label only: a
 * runtime's live state comes from World, not from here.
 */
export function useHostGroupOf(): HostGroupOf {
  return hostGroupOf(useHostGrouping());
}
