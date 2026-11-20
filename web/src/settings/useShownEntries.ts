/**
 * The entries this host shows, kept current (#1035): a row whose
 * `available` check reads another value (Notify when a task finishes, with
 * task notifications on) appears or goes as soon as that value changes, not
 * when Settings opens again.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEVTOOLS } from "../world/devtools/flag";
import {
  entryShown,
  type RegistryEntry,
  type SettingsHost,
  subscribeEntries,
} from "./registry";

export function useShownEntries(
  entries: readonly RegistryEntry[],
  host: SettingsHost | null,
): readonly RegistryEntry[] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeEntries(entries, listener),
    [entries],
  );
  // One character per entry: re-renders only when what is shown changes.
  const read = useCallback(
    () =>
      host
        ? entries
            .map((entry) => (entryShown(entry, host, DEVTOOLS) ? "1" : "0"))
            .join("")
        : "",
    [entries, host],
  );
  const shownMask = useSyncExternalStore(subscribe, read, read);
  return useMemo(
    () => entries.filter((_entry, index) => shownMask[index] === "1"),
    [entries, shownMask],
  );
}
