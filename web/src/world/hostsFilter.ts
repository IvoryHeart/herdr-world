import { useEffect, useState } from "react";
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

/** The overview scope is independent of operational ownership and legacy focus. */
export function useHostsFilter(
  catalogueIds: readonly string[],
  catalogueReady = true,
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
      "Some selected host profiles were removed. " +
        (retained.length
          ? "Showing the remaining selected hosts."
          : "Showing All hosts."),
    );
    writeHostsFilter(retained.length ? retained : null);
  }, [catalogueKey, catalogueReady, ids]);
  return { ids, explanation, setIds: writeHostsFilter };
}
