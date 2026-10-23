/*
 * Herdr's tab order rules, shared by Spaces, Town and the World service's
 * `herdr-world town desk move`.
 */

/**
 * Herdr `tab.move` index that gives the dragged tab the neighbors it has in
 * `groupOrder`, the new display order of its pin group. Herdr inserts before
 * the tab currently at `insert_index` (counted before removal), and the tab
 * list length appends. Returns null when the tab would not move.
 */
export function tabMoveInsertIndex(
  herdrOrder: readonly string[],
  tabId: string,
  groupOrder: readonly string[],
): number | null {
  const from = herdrOrder.indexOf(tabId);
  const slot = groupOrder.indexOf(tabId);
  if (from < 0 || slot < 0) return null;
  const next = groupOrder[slot + 1];
  const previous = groupOrder[slot - 1];
  let insertIndex: number;
  if (next !== undefined) insertIndex = herdrOrder.indexOf(next);
  else if (previous !== undefined)
    insertIndex = herdrOrder.indexOf(previous) + 1;
  else return null;
  if (insertIndex < 0) return null;
  return insertIndex === from || insertIndex === from + 1 ? null : insertIndex;
}

/**
 * Herdr's tab.move index that puts `tabId` into `ontoId`'s slot of a room's
 * tab order (or last when `ontoId` is null): null when it is already there,
 * undefined when either tab is not in the order.
 */
export function deskReorderIndex(
  order: readonly string[],
  tabId: string,
  ontoId: string | null,
): number | null | undefined {
  const slot = ontoId === null ? order.length - 1 : order.indexOf(ontoId);
  if (slot < 0 || !order.includes(tabId)) return undefined;
  const next = order.filter((id) => id !== tabId);
  next.splice(slot, 0, tabId);
  return tabMoveInsertIndex(order, tabId, next);
}
