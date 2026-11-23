import { useMemo } from "react";
import { useStoreSelector } from "../store";
import { hostGroupOf, worldHosts } from "../worldHosts";
import { useRuntimeGrouping } from "./runtimeGrouping";

/**
 * Each connection's group under World's "Group runtimes" setting, read from
 * the one host catalogue (worldHosts.ts). Desk and the navigator group by
 * this; Town's buildings apply the same `runtimeGroupKey`.
 */
export function useHostGroupOf() {
  const hosts = useStoreSelector(worldHosts);
  const grouping = useRuntimeGrouping();
  return useMemo(() => hostGroupOf(hosts, grouping), [hosts, grouping]);
}
