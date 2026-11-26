import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { UsageLens, type UsageTab } from "../usage/UsageLens";
import { PlaceWindow } from "../PlaceWindow";
import {
  provideUsageOpener,
  type OpenUsage,
  type UsageAgentFilter,
} from "../usage/usageOpener";
import type { WorldObject } from "../worldObject";

/**
 * Opens the Usage screens over Town (#1029). Town provides it; without it (a
 * town drawn alone, as in captures) the observatory opens nothing.
 */
export const TownOpenUsageContext = createContext<OpenUsage | null>(null);
export const useOpenTownUsage = () => useContext(TownOpenUsageContext);

/**
 * Town's Usage screens: the observatory's opener and, while open, the lens.
 * `world` names agents and rooms in the breakdown. Windows outside Town's
 * tree (Apartments) reach the same opener through usageOpener.ts.
 */
export function useTownUsage(world?: WorldObject) {
  const [shown, setShown] = useState<{
    tab: UsageTab;
    filter: UsageAgentFilter | null;
    seq: number;
  } | null>(null);
  const open = useCallback<OpenUsage>(
    (tab = "budget", filter) =>
      setShown((before) => ({
        tab,
        filter: filter ?? null,
        seq: (before?.seq ?? 0) + 1,
      })),
    [],
  );
  useEffect(() => provideUsageOpener(open), [open]);
  // Town's one window (#1170): the observatory and Apartments open it.
  const lens = shown ? (
    <PlaceWindow
      name="usage"
      label="Usage"
      closeLabel="Close Usage"
      bodyClassName="place-window-lens"
      onClose={() => setShown(null)}
    >
      <UsageLens
        key={shown.seq}
        initialTab={shown.tab}
        initialFilter={shown.filter}
        framed
        world={world}
        onClose={() => setShown(null)}
      />
    </PlaceWindow>
  ) : null;
  return { open, lens };
}
