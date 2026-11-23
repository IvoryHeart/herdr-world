import { useMemo } from "react";
import { useStoreSelector } from "../store";
import {
  type HostGroupOf,
  hostGroupOf,
  type WorldHost,
  worldHosts,
} from "../worldHosts";
import { useRuntimeGrouping } from "./runtimeGrouping";

/**
 * Whether two catalogues group alike: the same runtimes, in order, with the
 * same names and machines. A runtime's state or generation changes no group,
 * so it re-renders no view that groups by it.
 */
export function sameHostGrouping(
  a: readonly WorldHost[],
  b: readonly WorldHost[],
) {
  return (
    a === b ||
    (a.length === b.length &&
      a.every(
        (host, index) =>
          host.id === b[index]!.id &&
          host.label === b[index]!.label &&
          host.machine === b[index]!.machine,
      ))
  );
}

/**
 * Each connection's group under World's "Group runtimes" setting, read from
 * the one host catalogue (worldHosts.ts). Desk, the navigator and Board group
 * by this; Town's buildings apply the same `runtimeGroupKey`. Groups give a
 * key and label only: a runtime's live state comes from World, not from here.
 */
export function useHostGroupOf(): HostGroupOf {
  const hosts = useStoreSelector(worldHosts, sameHostGrouping);
  const grouping = useRuntimeGrouping();
  return useMemo(() => hostGroupOf(hosts, grouping), [hosts, grouping]);
}
