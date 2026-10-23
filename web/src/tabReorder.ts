import type { Tab } from "./types";

export { tabMoveInsertIndex } from "../../shared/tabOrder";

/**
 * Applies a Herdr `tab.move` locally so the strip settles in its new order
 * before the next refresh. Other workspaces keep their slots in the list.
 */
export function moveTabInList<T extends Pick<Tab, "tab_id" | "workspace_id">>(
  tabs: readonly T[],
  tabId: string,
  insertIndex: number,
): T[] {
  const moved = tabs.find((tab) => tab.tab_id === tabId);
  if (!moved) return [...tabs];
  const siblings = tabs.filter(
    (tab) => tab.workspace_id === moved.workspace_id,
  );
  const before = siblings[insertIndex];
  const reordered = siblings.filter((tab) => tab !== moved);
  const at = before ? reordered.indexOf(before) : reordered.length;
  if (at < 0) return [...tabs];
  reordered.splice(at, 0, moved);
  let next = 0;
  return tabs.map((tab) =>
    tab.workspace_id === moved.workspace_id ? reordered[next++] : tab,
  );
}

/**
 * Display slot the dragged tab lands in at the drag position `position`,
 * given the resting midpoints of the other tabs in its group, left to right.
 */
export function tabDropSlot(
  position: number,
  otherMidpoints: readonly number[],
): number {
  let slot = 0;
  while (slot < otherMidpoints.length && position > otherMidpoints[slot])
    slot++;
  return slot;
}
