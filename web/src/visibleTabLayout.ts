import { useEffect, useMemo, useState } from "react";
import {
  shallowEqual,
  useOperationalStore,
  useStoreSelector,
  type State,
} from "./store";
import {
  drawableTabLayout,
  provisionalTabLayout,
  rememberTabLayout,
  tabLayoutFor,
} from "./tabLayout";
import type { PaneLayout } from "./types";
import { useConnectionClient } from "./useConnectionClient";

type TabIdentity = {
  connectionId: string;
  connectionGeneration: number;
  runtimeGeneration: number | null;
  workspaceId: string;
  tabId: string;
};

function tabIdentityKey(identity: TabIdentity) {
  return JSON.stringify([
    identity.connectionId,
    identity.runtimeGeneration,
    identity.workspaceId,
    identity.tabId,
  ]);
}

const MAX_CONCURRENT_VISIBLE_LAYOUT_READS = 4;
let activeVisibleLayoutReads = 0;
const pendingVisibleLayoutReads: Array<() => void> = [];

function startVisibleLayoutReads() {
  while (
    activeVisibleLayoutReads < MAX_CONCURRENT_VISIBLE_LAYOUT_READS &&
    pendingVisibleLayoutReads.length > 0
  ) {
    pendingVisibleLayoutReads.shift()?.();
  }
}

/** Bound concurrent tab-layout RPCs even when many Spaces tabs are visible. */
export function queueVisibleTabLayoutRead<T>(
  read: () => Promise<T>,
  stillNeeded: () => boolean,
): Promise<{ skipped: true } | { skipped: false; value: T }> {
  return new Promise((resolve, reject) => {
    pendingVisibleLayoutReads.push(() => {
      if (!stillNeeded()) {
        resolve({ skipped: true });
        return;
      }
      activeVisibleLayoutReads++;
      void Promise.resolve()
        .then(read)
        .then((value) => resolve({ skipped: false, value }), reject)
        .finally(() => {
          activeVisibleLayoutReads--;
          startVisibleLayoutReads();
        });
    });
    startVisibleLayoutReads();
  });
}

type VisibleTabLayoutRead = ReturnType<typeof queueVisibleTabLayoutRead>;
const sharedVisibleLayoutReads = new Map<
  string,
  { needed: Set<() => boolean>; read: VisibleTabLayoutRead }
>();

/**
 * One queued read per tab at a time: a window's terminal and its title map
 * observe the same tab, so the second joins the first instead of reading
 * again. The read runs while any of them still needs it.
 */
export function shareVisibleTabLayoutRead(
  key: string,
  read: () => Promise<unknown>,
  stillNeeded: () => boolean,
): VisibleTabLayoutRead {
  const current = sharedVisibleLayoutReads.get(key);
  if (current) {
    current.needed.add(stillNeeded);
    return current.read;
  }
  const needed = new Set([stillNeeded]);
  const shared = queueVisibleTabLayoutRead(read, () =>
    [...needed].some((check) => check()),
  ).finally(() => sharedVisibleLayoutReads.delete(key));
  sharedVisibleLayoutReads.set(key, { needed, read: shared });
  return shared;
}

/** Reject a layout after a lease change, pane move, split or close. */
export function tabLayoutMatchesSnapshot(
  layout: unknown,
  identity: TabIdentity,
  snapshot: Pick<
    State,
    | "activeConnectionId"
    | "connectionGeneration"
    | "serverRuntimeGeneration"
    | "workspaces"
    | "tabs"
    | "panes"
  >,
): layout is PaneLayout {
  if (!layout || typeof layout !== "object") return false;
  const candidate = layout as Partial<PaneLayout>;
  // A tab no client shows can have 0-cell panes and splits (see
  // drawableTabLayout); only its area must have a size.
  const validRect = (rect: unknown, sized = false) => {
    if (!rect || typeof rect !== "object") return false;
    const value = rect as Record<string, unknown>;
    if (
      !["x", "y", "width", "height"].every(
        (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
      )
    )
      return false;
    const width = value.width as number;
    const height = value.height as number;
    return sized ? width > 0 && height > 0 : width >= 0 && height >= 0;
  };
  if (
    !Array.isArray(candidate.panes) ||
    !Array.isArray(candidate.splits) ||
    !validRect(candidate.area, true) ||
    typeof candidate.focused_pane_id !== "string" ||
    candidate.panes.some(
      (pane) => typeof pane?.pane_id !== "string" || !validRect(pane.rect),
    ) ||
    candidate.splits.some(
      (split) =>
        typeof split?.id !== "string" ||
        (split.direction !== "right" && split.direction !== "down") ||
        !Number.isFinite(split.ratio) ||
        split.ratio <= 0 ||
        split.ratio >= 1 ||
        !validRect(split.rect),
    )
  )
    return false;
  if (
    snapshot.activeConnectionId !== identity.connectionId ||
    snapshot.connectionGeneration !== identity.connectionGeneration ||
    snapshot.serverRuntimeGeneration !== identity.runtimeGeneration ||
    candidate.workspace_id !== identity.workspaceId ||
    candidate.tab_id !== identity.tabId ||
    !snapshot.workspaces.some(
      (workspace) => workspace.workspace_id === identity.workspaceId,
    ) ||
    !snapshot.tabs.some(
      (tab) =>
        tab.tab_id === identity.tabId &&
        tab.workspace_id === identity.workspaceId,
    )
  )
    return false;
  const paneIds = snapshot.panes
    .filter(
      (pane) =>
        pane.workspace_id === identity.workspaceId &&
        pane.tab_id === identity.tabId,
    )
    .map((pane) => pane.pane_id);
  const layoutIds = candidate.panes.map((pane) => pane.pane_id);
  return (
    paneIds.length > 0 &&
    new Set(layoutIds).size === layoutIds.length &&
    paneIds.length === layoutIds.length &&
    paneIds.every((paneId) => layoutIds.includes(paneId)) &&
    layoutIds.includes(candidate.focused_pane_id)
  );
}

/** Read-only observation while a tab has a visible presentation. */
export function useVisibleTabLayoutState(
  workspaceId: string,
  tabId: string,
): { layout: PaneLayout | null; error: string | null } {
  const store = useOperationalStore();
  const client = useConnectionClient();
  const snapshot = useStoreSelector(
    (state) => ({
      activeConnectionId: state.activeConnectionId,
      connectionGeneration: state.connectionGeneration,
      serverRuntimeGeneration: state.serverRuntimeGeneration,
      status: state.status,
      lastRefresh: state.lastRefresh,
      workspaces: state.workspaces,
      tabs: state.tabs,
      panes: state.panes,
      layout: state.layout,
    }),
    shallowEqual,
  );
  const [observed, setObserved] = useState<{
    key: string;
    layout: PaneLayout;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const identity: TabIdentity = {
    connectionId: snapshot.activeConnectionId,
    connectionGeneration: snapshot.connectionGeneration,
    runtimeGeneration: snapshot.serverRuntimeGeneration,
    workspaceId,
    tabId,
  };
  const identityKey = tabIdentityKey(identity);
  const activeLayout = tabLayoutMatchesSnapshot(
    snapshot.layout,
    identity,
    snapshot,
  )
    ? snapshot.layout
    : null;
  const candidate =
    activeLayout ??
    (observed?.key === identityKey ? observed.layout : null) ??
    tabLayoutFor(
      identity.connectionId,
      identity.runtimeGeneration ?? identity.connectionGeneration,
      tabId,
    );
  const provisional = provisionalTabLayout(candidate, snapshot.panes, tabId);
  const observedLayout = tabLayoutMatchesSnapshot(
    provisional,
    identity,
    snapshot,
  )
    ? provisional
    : null;
  const layout = useMemo(
    () => (observedLayout ? drawableTabLayout(observedLayout) : null),
    [observedLayout],
  );

  useEffect(() => {
    if (
      snapshot.status !== "connected" ||
      activeLayout ||
      !snapshot.workspaces.some(
        (workspace) => workspace.workspace_id === workspaceId,
      ) ||
      !snapshot.tabs.some(
        (tab) => tab.tab_id === tabId && tab.workspace_id === workspaceId,
      )
    )
      return;
    const pane =
      snapshot.panes.find(
        (item) =>
          item.workspace_id === workspaceId &&
          item.tab_id === tabId &&
          item.focused,
      ) ??
      snapshot.panes.find(
        (item) => item.workspace_id === workspaceId && item.tab_id === tabId,
      );
    if (!pane) return;
    setError(null);
    const requestIdentity: TabIdentity = {
      connectionId: snapshot.activeConnectionId,
      connectionGeneration: snapshot.connectionGeneration,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
      workspaceId,
      tabId,
    };
    let cancelled = false;
    void shareVisibleTabLayoutRead(
      tabIdentityKey(requestIdentity),
      () => client.call("pane.layout", { pane_id: pane.pane_id }),
      () => !cancelled && client.isCurrent(),
    )
      .then((read) => {
        if (read.skipped || cancelled || !client.isCurrent()) return;
        const result = read.value as { layout?: unknown } | null;
        const next = (result?.layout ?? null) as PaneLayout | null;
        if (!tabLayoutMatchesSnapshot(next, requestIdentity, store.get())) {
          setError("Tab layout is unavailable.");
          return;
        }
        rememberTabLayout(
          requestIdentity.connectionId,
          requestIdentity.runtimeGeneration ??
            requestIdentity.connectionGeneration,
          next,
        );
        setObserved({ key: tabIdentityKey(requestIdentity), layout: next });
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("Tab layout is unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    store,
    snapshot.activeConnectionId,
    workspaceId,
    tabId,
    snapshot.status,
    snapshot.lastRefresh,
    snapshot.connectionGeneration,
    snapshot.serverRuntimeGeneration,
    snapshot.workspaces,
    snapshot.tabs,
    snapshot.panes,
    activeLayout,
  ]);
  return {
    layout,
    error: layout
      ? null
      : observedLayout
        ? "Tab layout is unavailable."
        : error,
  };
}

/** Layout-only convenience for an Inspector with its own loading UI. */
export function useVisibleTabLayout(
  workspaceId: string,
  tabId: string,
): PaneLayout | null {
  return useVisibleTabLayoutState(workspaceId, tabId).layout;
}
