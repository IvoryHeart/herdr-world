import { createContext, useCallback, useContext, useState } from "react";
import { UsageLens, type UsageTab } from "../usage/UsageLens";

/**
 * Opens the Usage screens over Town (#1029). Town provides it; without it (a
 * town drawn alone, as in captures) the observatory opens nothing.
 */
export const TownOpenUsageContext = createContext<
  ((tab?: UsageTab) => void) | null
>(null);
export const useOpenTownUsage = () => useContext(TownOpenUsageContext);

/** The observatory's signs, which the lens keeps as anchors. */
const anchor = () =>
  document.querySelector(".town-observatory-sign, .town-observatory-fold");

/** Town's Usage screens: the observatory's opener and, while open, the lens. */
export function useTownUsage() {
  const [tab, setTab] = useState<UsageTab | null>(null);
  const open = useCallback((next: UsageTab = "budget") => setTab(next), []);
  const lens = tab ? (
    <UsageLens initialTab={tab} anchor={anchor} onClose={() => setTab(null)} />
  ) : null;
  return { open, lens };
}
