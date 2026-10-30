import {
  state,
  set,
  captureConnectionLease,
  leaseSnapshot,
  leaseIsCurrent,
  setForConnection,
} from "../store";
import { type Workspace, type Tab, type PaneLayout } from "../types";
import { withAgentActivity } from "../agentOrder";
import { observedRecency } from "../agentRecency";
import { forgetTerminalRelayViewportsExcept } from "../terminalResize";
import { forgetTabLayoutsExcept, rememberTabLayout } from "../tabLayout";
import { trackTaskCompletions, notifyCompletedTasks } from "./notifications";
import { forgetClosedTabPins } from "../tabPins";
import { type State, type StoreConnectionLease } from "./types";
import { parseEndpointAvailability } from "../endpointAvailability";
import {
  projectBrowserNavigation,
  projectBrowserLayout,
} from "../browserNavigation";
import { pickActiveTabId, stabilizeRefreshPatch } from "./sessions";

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const refreshingConnectionKeys = new Set<string>();
const refreshCompletions = new Map<
  string,
  { promise: Promise<void>; resolve(): void }
>();
const queuedConnectionKeys = new Set<string>();
const focusActionChains = new Map<string, Promise<unknown>>();

function enqueueFocusAction<T>(
  fn: () => Promise<T>,
  connectionId = state.activeConnectionId,
): Promise<T> {
  const chain = focusActionChains.get(connectionId) ?? Promise.resolve();
  const task = chain.then(fn, fn);
  const settled = task.catch(() => undefined);
  focusActionChains.set(connectionId, settled);
  void settled.then(() => {
    if (focusActionChains.get(connectionId) === settled)
      focusActionChains.delete(connectionId);
  });
  return task;
}

let nextPendingFocusWorkspaceSeq = 1;

/**
 * Marks a workspace focus as in flight and returns the sequence token that
 * identifies this attempt. The pending flag suppresses focus-follower
 * effects until a fresh refresh observes the workspace focused (or the focus
 * is declared lost after the action settled).
 */
function stampPendingFocusWorkspace(workspaceId: string): number {
  const seq = nextPendingFocusWorkspaceSeq++;
  set({
    pendingFocusWorkspaceId: workspaceId,
    pendingFocusWorkspaceSeq: seq,
    pendingFocusWorkspaceSettledAt: null,
  });
  return seq;
}

/** Clears an in-flight focus marker identified by its sequence token. */
function clearPendingFocusWorkspace(seq: number): void {
  if (state.pendingFocusWorkspaceSeq !== seq) return;
  set({
    pendingFocusWorkspaceId: null,
    pendingFocusWorkspaceSettledAt: null,
  });
}

/** Records that the action behind an in-flight focus has completed. */
function settlePendingFocusWorkspace(seq: number): void {
  if (
    !state.pendingFocusWorkspaceId ||
    state.pendingFocusWorkspaceSeq !== seq ||
    state.pendingFocusWorkspaceSettledAt !== null
  ) {
    return;
  }
  set({ pendingFocusWorkspaceSettledAt: Date.now() });
}

async function refreshNow(
  lease = captureConnectionLease(),
  waitForRunning = false,
) {
  if (
    leaseSnapshot(lease).connectionPaused ||
    leaseSnapshot(lease).status !== "connected" ||
    !leaseIsCurrent(lease)
  ) {
    return;
  }
  const refreshKey = `${lease.connectionId}:${lease.generation}`;
  if (refreshingConnectionKeys.has(refreshKey)) {
    queuedConnectionKeys.add(refreshKey);
    return waitForRunning
      ? refreshCompletions.get(refreshKey)?.promise
      : undefined;
  }
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const completion = { promise, resolve };
  refreshCompletions.set(refreshKey, completion);
  refreshingConnectionKeys.add(refreshKey);
  const observationStartedAt = performance.now();
  // Snapshot the pending-focus marker when the fetch actually starts. Only a
  // refresh that began after the focus action settled may declare the focus
  // lost, and only while the marker still belongs to that same attempt.
  const navigationAtEntry = leaseSnapshot(lease).browserNavigation;
  const endpointAvailabilityAtEntry = leaseSnapshot(lease).endpointAvailability;
  const pendingFocusAtEntry = {
    seq: leaseSnapshot(lease).pendingFocusWorkspaceSeq,
    settledAt: leaseSnapshot(lease).pendingFocusWorkspaceSettledAt,
  };
  try {
    const [wsRes, tabRes, paneRes, agentRes] = await Promise.all([
      lease.client.call("workspace.list"),
      lease.client.call("tab.list"),
      lease.client.call("pane.list"),
      // Older servers may omit agent metadata; ordinary navigation still works.
      lease.client.call("agent.list").catch(() => null),
    ]);
    if (!leaseIsCurrent(lease)) return;
    const workspaces: Workspace[] = wsRes?.workspaces ?? [];
    const tabs: Tab[] = tabRes?.tabs ?? [];
    const panes = withAgentActivity(paneRes?.panes ?? [], agentRes);
    forgetTerminalRelayViewportsExcept(
      lease.connectionId,
      lease.generation,
      new Set(tabs.map((tab) => tab.tab_id)),
    );
    forgetTabLayoutsExcept(
      lease.connectionId,
      lease.generation,
      new Set(tabs.map((tab) => tab.tab_id)),
    );
    const completedPanes = trackTaskCompletions(lease.connectionId, panes);

    const navigationMode =
      wsRes?.navigation_mode === "browser-local" ? "browser-local" : "shared";
    forgetClosedTabPins(
      lease.connectionId,
      new Set(tabs.map((tab) => tab.tab_id)),
    );
    const next: Partial<State> = {
      serverRuntimeGeneration: lease.generation,
      navigationMode,
      tabMoveSupported: wsRes?.tab_move_supported === true,
      endpointAvailability: parseEndpointAvailability(
        wsRes?.endpoint_availability,
      ),
      workspaces,
      tabs,
      panes,
      error: null,
      lastRefresh: Date.now(),
    };
    if (navigationMode === "browser-local") {
      Object.assign(
        next,
        projectBrowserNavigation(
          leaseSnapshot(lease).browserNavigation,
          workspaces,
          tabs,
          panes,
        ),
      );
    }
    const pendingFocusAtObservation = {
      seq: leaseSnapshot(lease).pendingFocusWorkspaceSeq,
      settledAt: leaseSnapshot(lease).pendingFocusWorkspaceSettledAt,
    };
    if (
      leaseSnapshot(lease).pendingFocusWorkspaceId &&
      workspaces.some(
        (w) =>
          w.workspace_id === leaseSnapshot(lease).pendingFocusWorkspaceId &&
          w.focused,
      )
    ) {
      next.pendingFocusWorkspaceId = null;
      next.pendingFocusWorkspaceSettledAt = null;
    } else if (
      leaseSnapshot(lease).pendingFocusWorkspaceId &&
      leaseSnapshot(lease).pendingFocusWorkspaceSeq ===
        pendingFocusAtEntry.seq &&
      pendingFocusAtEntry.settledAt !== null &&
      leaseSnapshot(lease).pendingFocusWorkspaceSettledAt ===
        pendingFocusAtEntry.settledAt
    ) {
      // The focus action settled before this refresh started, yet a fresh
      // observation still does not show the workspace focused: the focus was
      // pre-empted or the workspace vanished, so release follower effects.
      next.pendingFocusWorkspaceId = null;
      next.pendingFocusWorkspaceSettledAt = null;
    }

    // Keep selection valid globally. Layout-scoped validation runs after the
    // active tab layout is fetched below, because a pane can exist while no
    // longer belonging to the visible terminal.
    if (
      navigationMode === "shared" &&
      leaseSnapshot(lease).selectedPaneId &&
      !panes.some((p) => p.pane_id === leaseSnapshot(lease).selectedPaneId)
    ) {
      next.selectedPaneId = null;
    }

    // Fetch layout for the active tab (needs a pane_id in that tab).
    const merged = { ...leaseSnapshot(lease), ...next } as State;
    const activeTabId = pickActiveTabId(merged);
    const aPane =
      panes.find((p) => p.tab_id === activeTabId && p.focused) ??
      panes.find((p) => p.tab_id === activeTabId);
    if (aPane) {
      try {
        const lr = await lease.client.call("pane.layout", {
          pane_id: aPane.pane_id,
        });
        if (!leaseIsCurrent(lease)) return;
        const observedLayout = (lr?.layout ?? null) as PaneLayout | null;
        // Panes can move or close between pane.list and pane.layout. Never
        // substitute shared layout focus for a missing browser-selected pane.
        const staleLayout =
          navigationMode === "browser-local" &&
          observedLayout &&
          (observedLayout.tab_id !== activeTabId ||
            observedLayout.workspace_id !== aPane.workspace_id ||
            (next.selectedPaneId &&
              !observedLayout.panes.some(
                (pane) => pane.pane_id === next.selectedPaneId,
              )));
        const layout = staleLayout ? null : observedLayout;
        // A runtime may keep returning the old tab while topology catches up.
        // Yield through the normal per-lease debounce instead of spinning
        // through immediately resolved RPCs and synchronous store renders.
        if (staleLayout) scheduleRefresh(lease);
        rememberTabLayout(lease.connectionId, lease.generation, layout);
        next.layout =
          navigationMode === "browser-local"
            ? projectBrowserLayout(layout, next.selectedPaneId ?? null)
            : layout;
        if (
          navigationMode === "shared" &&
          layout &&
          leaseSnapshot(lease).selectedPaneId &&
          !layout.panes.some(
            (p) => p.pane_id === leaseSnapshot(lease).selectedPaneId,
          )
        ) {
          next.selectedPaneId = null;
        }
      } catch (error) {
        next.layout = null;
        next.error = error instanceof Error ? error.message : String(error);
      }
    } else {
      next.layout = null;
    }

    // Never publish a layout fetched for an older browser navigation target.
    if (navigationAtEntry !== leaseSnapshot(lease).browserNavigation) {
      queuedConnectionKeys.add(refreshKey);
      return;
    }

    // Layout fetching can overlap another focus attempt or its settlement.
    // Drop only a stale marker clear, preserving the useful snapshot data.
    if (
      next.pendingFocusWorkspaceId === null &&
      (leaseSnapshot(lease).pendingFocusWorkspaceSeq !==
        pendingFocusAtObservation.seq ||
        leaseSnapshot(lease).pendingFocusWorkspaceSettledAt !==
          pendingFocusAtObservation.settledAt)
    ) {
      delete next.pendingFocusWorkspaceId;
      delete next.pendingFocusWorkspaceSettledAt;
    }
    // Close/reattach can replace advertisements while either RPC is pending.
    // Keep that newer slice without discarding useful topology/layout updates.
    if (
      endpointAvailabilityAtEntry !== leaseSnapshot(lease).endpointAvailability
    ) {
      delete next.endpointAvailability;
      queuedConnectionKeys.add(refreshKey);
    }
    Object.assign(
      next,
      observedRecency(
        leaseSnapshot(lease).agentActivity,
        next.panes ?? [],
        agentRes,
      ),
    );
    const patch = stabilizeRefreshPatch(leaseSnapshot(lease), next);
    if (
      !setForConnection(lease, {
        ...(patch ?? {}),
        lastTopologyObservationStartedAt: observationStartedAt,
      })
    ) {
      return;
    }
    notifyCompletedTasks(lease, completedPanes, workspaces, tabs);
  } catch (error) {
    setForConnection(lease, { error: (error as Error).message });
  } finally {
    refreshingConnectionKeys.delete(refreshKey);
    refreshCompletions.delete(refreshKey);
    completion.resolve();
    if (queuedConnectionKeys.delete(refreshKey) && leaseIsCurrent(lease)) {
      void refreshNow(lease);
    }
  }
}

/** Observe after a focus change, including when an older observation is running. */
async function refreshAfterCurrent(lease: StoreConnectionLease) {
  const key = `${lease.connectionId}:${lease.generation}`;
  const pending = refreshCompletions.get(key)?.promise;
  if (pending) await pending;
  if (!leaseIsCurrent(lease)) return;
  // The old observation may have started its queued successor in finally.
  const successor = refreshCompletions.get(key)?.promise;
  if (successor) await successor;
  else await refreshNow(lease);
}

function scheduleRefresh(lease = captureConnectionLease()) {
  if (state.connectionPaused || !leaseIsCurrent(lease)) return;
  const key = `${lease.connectionId}:${lease.generation}`;
  const previous = refreshTimers.get(key);
  if (previous) clearTimeout(previous);
  refreshTimers.set(
    key,
    setTimeout(() => {
      refreshTimers.delete(key);
      if (leaseIsCurrent(lease)) void refreshNow(lease);
    }, 80),
  );
}
export {
  refreshTimers,
  refreshingConnectionKeys,
  queuedConnectionKeys,
  focusActionChains,
  enqueueFocusAction,
  stampPendingFocusWorkspace,
  clearPendingFocusWorkspace,
  settlePendingFocusWorkspace,
  refreshNow,
  refreshAfterCurrent,
  scheduleRefresh,
};
