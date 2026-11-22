import { createContext, useCallback, useContext, useState } from "react";
import { UsageLens, type UsageTab } from "../usage/UsageLens";
import { PlaceWindow } from "../PlaceWindow";
import type { WorldObject } from "../worldObject";

/**
 * Opens the Usage screens over Town (#1029). Town provides it; without it (a
 * town drawn alone, as in captures) the observatory opens nothing.
 */
export const TownOpenUsageContext = createContext<
  ((tab?: UsageTab) => void) | null
>(null);
export const useOpenTownUsage = () => useContext(TownOpenUsageContext);

/**
 * Town's Usage screens: the observatory's opener and, while open, the lens.
 * `world` names agents and rooms in the breakdown.
 */
export function useTownUsage(world?: WorldObject) {
  const [tab, setTab] = useState<UsageTab | null>(null);
  const open = useCallback((next: UsageTab = "budget") => setTab(next), []);
  // Town's one window (#1170): the observatory opens it.
  const lens = tab ? (
    <PlaceWindow
      name="usage"
      label="Usage"
      closeLabel="Close Usage"
      bodyClassName="place-window-lens"
      onClose={() => setTab(null)}
    >
      <UsageLens
        initialTab={tab}
        framed
        world={world}
        onClose={() => setTab(null)}
      />
    </PlaceWindow>
  ) : null;
  return { open, lens };
}
