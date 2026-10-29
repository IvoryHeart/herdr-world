import type { BoardTab } from "./boardModel";

/** Native Board order, including panes beyond the currently rendered viewport. */
export function nextBoardAttention(
  tabs: readonly BoardTab[],
  selectedId: string | null,
  asks: { has(id: string): boolean; size: number },
) {
  let first: { tab: BoardTab; pane: BoardTab["panes"][number] } | null = null;
  let afterCurrent = false;
  for (const tab of tabs) {
    if (
      !tab.actionable ||
      tab.stale ||
      (!asks.size && tab.status !== "blocked")
    )
      continue;
    for (const pane of tab.panes) {
      if (
        !pane.isAgent ||
        !pane.leaf.actionable ||
        pane.leaf.stale ||
        (pane.status !== "blocked" && !asks.has(pane.leaf.id))
      )
        continue;
      const candidate = { tab, pane };
      if (afterCurrent || selectedId === null) return candidate;
      first ??= candidate;
      if (pane.leaf.id === selectedId) afterCurrent = true;
    }
  }
  return first;
}
