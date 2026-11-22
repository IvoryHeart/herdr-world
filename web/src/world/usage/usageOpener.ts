import { useSyncExternalStore } from "react";
import type { UsageTab } from "./UsageLens";

/**
 * Breakdown narrowed to one agent: its usage agent IDs and its name, and
 * why World may have none of its usage (residentUsageGap).
 */
export type UsageAgentFilter = {
  ids: readonly string[];
  label: string;
  why?: string | null;
};

/** Opens the Usage screens on `tab`, Breakdown narrowed by `filter`. */
export type OpenUsage = (tab?: UsageTab, filter?: UsageAgentFilter) => void;

/**
 * The Usage screens' opener for windows drawn outside Town's tree, such as
 * Apartments (#1101). Town provides it while it is shown; elsewhere there
 * is none, and those windows offer no way into Usage.
 */
let opener: OpenUsage | null = null;
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

/** Town's opener while mounted; returns its removal. */
export function provideUsageOpener(open: OpenUsage) {
  opener = open;
  changed();
  return () => {
    if (opener !== open) return;
    opener = null;
    changed();
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const current = () => opener;

/** The opener Town provides now, else null. */
export function useUsageOpener(): OpenUsage | null {
  return useSyncExternalStore(subscribe, current, current);
}
