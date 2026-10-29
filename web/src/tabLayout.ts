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
type LayoutNode =
  | { kind: "pane"; item: PaneLayout["panes"][number] }
  | { kind: "split"; item: PaneLayout["splits"][number] };

/**
 * Herdr sizes a tab that no client shows at a few cells (10×1), so a pane can
 * be 0 cells tall. Rebuild that geometry from the split tree, which keeps each
 * split's ratio, so every pane keeps its share. Herdr lists a split before the
 * splits inside it; a side starts at its split's start or after it. Geometry
 * that cannot be rebuilt is returned unchanged.
 */
export function drawableTabLayout(layout: PaneLayout): PaneLayout {
  if (layout.panes.every((pane) => pane.rect.width > 0 && pane.rect.height > 0))
    return layout;
  const panes = new Map<string, LayoutRect>();
  const splits = new Map<string, LayoutRect>();
  const place = (members: LayoutNode[], box: LayoutRect): boolean => {
    const only = members.length === 1 ? members[0] : undefined;
    if (only?.kind === "pane") {
      panes.set(only.item.pane_id, box);
      return true;
    }
    const index = members.findIndex((member) => member.kind === "split");
    if (index < 0) return false;
    const split = members[index]!.item as PaneLayout["splits"][number];
    splits.set(split.id, box);
    const across = split.direction === "right";
    const start = (rect: LayoutRect) => (across ? rect.x : rect.y);
    const rest = members.filter((_, other) => other !== index);
    const before = rest.filter(
      (member) => start(member.item.rect) <= start(split.rect),
    );
    const after = rest.filter(
      (member) => start(member.item.rect) > start(split.rect),
    );
    const first = across
      ? { ...box, width: box.width * split.ratio }
      : { ...box, height: box.height * split.ratio };
    const second = across
      ? { ...box, x: box.x + first.width, width: box.width - first.width }
      : { ...box, y: box.y + first.height, height: box.height - first.height };
    return (
      before.length > 0 &&
      after.length > 0 &&
      place(before, first) &&
      place(after, second)
    );
  };
  const area = { x: 0, y: 0, width: 1000, height: 1000 };
  const placed = place(
    [
      ...layout.splits.map((item) => ({ kind: "split" as const, item })),
      ...layout.panes.map((item) => ({ kind: "pane" as const, item })),
    ],
    area,
  );
  if (!placed || panes.size !== layout.panes.length) return layout;
  return {
    ...layout,
    area,
    panes: layout.panes.map((pane) => ({
      ...pane,
      rect: panes.get(pane.pane_id)!,
    })),
    splits: layout.splits.map((split) => ({
      ...split,
      rect: splits.get(split.id)!,
    })),
  };
}
