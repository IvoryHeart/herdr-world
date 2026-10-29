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
    for (const pane of tab.panes) {
      if (
        tab.actionable &&
        !tab.stale &&
        pane.leaf.actionable &&
        !pane.leaf.stale &&
        (asks.has(pane.leaf.id) || (pane.isAgent && pane.status === "blocked"))
      ) {
        const candidate = { tab, pane };
        if (afterCurrent || selectedId === null) return candidate;
        first ??= candidate;
      }
      // Keep the cursor's position even after its question has been answered.
      if (pane.leaf.id === selectedId) afterCurrent = true;
    }
  }
  return first;
}
