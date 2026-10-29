import type { Pane, PaneLayout } from "./types";

/**
 * Last observed geometry per tab. Switching to another tab would otherwise
 * blank the terminal area until `pane.layout` answers, because the store has
 * no layout for a tab it is not currently showing.
 */
const layoutByTab = new Map<string, PaneLayout>();

function layoutKey(connectionId: string, generation: number, tabId: string) {
  return `${connectionId}\0${generation}\0${tabId}`;
}

export function rememberTabLayout(
  connectionId: string,
  generation: number,
  layout: PaneLayout | null,
) {
  if (!connectionId || !layout?.tab_id) return;
  layoutByTab.set(layoutKey(connectionId, generation, layout.tab_id), layout);
}

export function tabLayoutFor(
  connectionId: string,
  generation: number,
  tabId: string | undefined,
): PaneLayout | null {
  if (!connectionId || !tabId) return null;
  return layoutByTab.get(layoutKey(connectionId, generation, tabId)) ?? null;
}

export function forgetTabLayoutsExcept(
  connectionId: string,
  generation: number,
  tabIds: Set<string>,
) {
  const prefix = `${connectionId}\0${generation}\0`;
  for (const key of layoutByTab.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (!tabIds.has(key.slice(prefix.length))) layoutByTab.delete(key);
  }
}

/** Retire geometry only when a current catalogue proves its owner is gone. */
export function retainTabLayoutOwners(
  owners: readonly { id: string; generation: number }[],
) {
  const prefixes = owners.map((owner) => `${owner.id}\0${owner.generation}\0`);
  for (const key of layoutByTab.keys()) {
    if (!prefixes.some((prefix) => key.startsWith(prefix)))
      layoutByTab.delete(key);
  }
}

export function clearTabLayouts() {
  layoutByTab.clear();
}

/**
 * Geometry to render a tab with before its own `pane.layout` arrives. Cached
 * geometry is reused only while it still describes exactly the panes the tab
 * has, since a split or close since the last visit moves every rect. A single
 * pane needs no cache: it always fills its tab.
 */
export function provisionalTabLayout(
  cached: PaneLayout | null,
  panes: readonly Pane[],
  tabId: string | undefined,
): PaneLayout | null {
  if (!tabId) return null;
  const tabPanes = panes.filter((pane) => pane.tab_id === tabId);
  if (tabPanes.length === 0) return null;
  if (cached?.tab_id === tabId) {
    const cachedPaneIds = new Set(cached.panes.map((pane) => pane.pane_id));
    if (
      cached.workspace_id === tabPanes[0].workspace_id &&
      cachedPaneIds.size === tabPanes.length &&
      tabPanes.every((pane) => cachedPaneIds.has(pane.pane_id))
    ) {
      return cached;
    }
  }
  if (tabPanes.length > 1) return null;
  const unit = { x: 0, y: 0, width: 1, height: 1 };
  return {
    workspace_id: tabPanes[0].workspace_id,
    tab_id: tabId,
    zoomed: false,
    area: { ...unit },
    focused_pane_id: tabPanes[0].pane_id,
    panes: [{ pane_id: tabPanes[0].pane_id, focused: true, rect: { ...unit } }],
    splits: [],
  };
}

type LayoutRect = PaneLayout["area"];
type LayoutSplit = PaneLayout["splits"][number];

/** A split's place in Herdr's tree: "split_2_10" is root → after → before. */
function splitPath(split: LayoutSplit): string | null {
  const match = /^split_(\d+)_(root|[01]+)$/.exec(split.id);
  if (!match) return null;
  const path = match[2] === "root" ? "" : match[2]!;
  return Number(match[1]) === path.length ? path : null;
}

/**
 * Herdr sizes a tab that no client shows at a few cells (10×1), so a pane can
 * be 0 cells tall. Rebuild that geometry from the split tree, which keeps each
 * split's ratio, so every pane keeps its share. Herdr names each split by its
 * path from the root and lists the panes in the tree's left-to-right order.
 * Returns null when a pane still has no size: there is nothing to draw it in.
 */
export function drawableTabLayout(layout: PaneLayout): PaneLayout | null {
  const sized = (rect: LayoutRect) => rect.width > 0 && rect.height > 0;
  if (layout.panes.every((pane) => sized(pane.rect))) return layout;
  const byPath = new Map<string, LayoutSplit>();
  for (const split of layout.splits) {
    const path = splitPath(split);
    if (path === null || byPath.has(path)) return null;
    byPath.set(path, split);
  }
  const panes: LayoutRect[] = [];
  const splits = new Map<string, LayoutRect>();
  const place = (path: string, box: LayoutRect) => {
    const split = byPath.get(path);
    if (!split) {
      panes.push(box);
      return;
    }
    splits.set(split.id, box);
    const across = split.direction === "right";
    const first = across
      ? { ...box, width: box.width * split.ratio }
      : { ...box, height: box.height * split.ratio };
    const second = across
      ? { ...box, x: box.x + first.width, width: box.width - first.width }
      : { ...box, y: box.y + first.height, height: box.height - first.height };
    place(`${path}0`, first);
    place(`${path}1`, second);
  };
  const area = { x: 0, y: 0, width: 1000, height: 1000 };
  place("", area);
  // Every split must hang off the root, and each leaf is one listed pane.
  if (splits.size !== byPath.size || panes.length !== layout.panes.length)
    return null;
  return {
    ...layout,
    area,
    panes: layout.panes.map((pane, index) => ({
      ...pane,
      rect: panes[index]!,
    })),
    splits: layout.splits.map((split) => ({
      ...split,
      rect: splits.get(split.id)!,
    })),
  };
}
