import { useEffect, useMemo, useState } from "react";
import { worldLocalStorage } from "../browserStorage";

const KEY = "worldHostsFilter.v1";
const EVENT = "world-hosts-filter-changed";
export type HostsFilter = readonly string[] | null;

function read(): HostsFilter {
  try {
    const value: unknown = JSON.parse(worldLocalStorage.getItem(KEY) ?? "null");
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((id) => typeof id === "string" && id.length > 0)
      ? [...new Set(value)]
      : null;
  } catch {
    return null;
  }
}

export function writeHostsFilter(ids: HostsFilter) {
  if (ids?.length === 0) ids = null;
  try {
    worldLocalStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* Session state still works without storage. */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: ids }));
}

/**
 * A stored filter covers whole hosts: a host is shown when any of its
 * runtime connection IDs is stored, and then every runtime World holds
 * there (one found later too) is shown with it.
 */
export function hostsFilterForGroups(
  ids: HostsFilter,
  groups: readonly (readonly string[])[],
): HostsFilter {
  if (ids === null) return null;
  const selected = new Set(ids);
  for (const members of groups)
    if (members.some((id) => selected.has(id)))
      for (const id of members) selected.add(id);
  return selected.size === ids.length ? ids : [...selected];
}

/**
 * The overview scope is independent of operational ownership and legacy
 * focus. `groups` lists each host's runtime connection IDs (see
 * `hostsFilterForGroups`).
 */
export function useHostsFilter(
  catalogueIds: readonly string[],
  catalogueReady = true,
  groups: readonly (readonly string[])[] = [],
) {
  const [ids, setIds] = useState<HostsFilter>(read);
  const [explanation, setExplanation] = useState("");
  const catalogueKey = JSON.stringify(catalogueIds);
  useEffect(() => {
    const changed = (event: Event) =>
      setIds((event as CustomEvent<HostsFilter>).detail);
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, []);
  useEffect(() => {
    if (ids === null || !catalogueReady) return;
    const knownIds = new Set<string>(JSON.parse(catalogueKey));
    const retained = ids.filter((id) => knownIds.has(id));
    if (retained.length === ids.length) return;
    setExplanation(
      "Some selected hosts were removed. " +
        (retained.length
          ? "Showing the remaining selected hosts."
          : "Showing All hosts."),
    );
    writeHostsFilter(retained.length ? retained : null);
  }, [catalogueKey, catalogueReady, ids]);
  const groupsKey = JSON.stringify(groups);
  const hostIds = useMemo(
    () => hostsFilterForGroups(ids, JSON.parse(groupsKey) as string[][]),
    [ids, groupsKey],
  );
  return { ids: hostIds, explanation, setIds: writeHostsFilter };
}
