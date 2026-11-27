import { useEffect, useMemo, useState } from "react";
import { worldLocalStorage } from "../browserStorage";
import { hostsFilterByGroup, type WorldHost } from "../worldHosts";
import { useHostGrouping } from "./useHostGroups";

const KEY = "worldHostsFilter.v1";
const EVENT = "world-hosts-filter-changed";
export type HostsFilter = readonly string[] | null;

function read(): HostsFilter {
  try {
    const value: unknown = JSON.parse(worldLocalStorage.getItem(KEY) ?? "null");
    // An empty list is an explicit choice (every host unchecked), not All hosts.
    return Array.isArray(value) &&
      value.every((id) => typeof id === "string" && id.length > 0)
      ? [...new Set(value)]
      : null;
  } catch {
    return null;
  }
}

export function writeHostsFilter(ids: HostsFilter) {
  try {
    worldLocalStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* Session state still works without storage. */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: ids }));
}

/**
 * The overview scope is independent of operational ownership and legacy focus.
 * It is kept as connection IDs but read by World's published hosts
 * (machines): `ids` covers every runtime of each selected machine
 * (`hostsFilterByGroup`), so a selection saved per connection shows its whole
 * machine, under either "Group runtimes" choice. View-only: operations stay qualified by connection ID and
 * generation.
 */
export function useHostsFilter(
  catalogue: readonly Pick<WorldHost, "id">[],
  catalogueReady = true,
) {
  const [ids, setIds] = useState<HostsFilter>(read);
  const [explanation, setExplanation] = useState("");
  const catalogueKey = JSON.stringify(catalogue.map(({ id }) => id));
  const grouping = useHostGrouping();
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
      "Some selected host profiles were removed. " +
        (retained.length
          ? "Showing the remaining selected hosts."
          : "Showing All hosts."),
    );
    writeHostsFilter(retained.length ? retained : null);
  }, [catalogueKey, catalogueReady, ids]);
  const groupIds = useMemo(
    () => hostsFilterByGroup(ids, grouping),
    [ids, grouping],
  );
  return { ids: groupIds, explanation, setIds: writeHostsFilter };
}
