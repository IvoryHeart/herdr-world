import {
  type QualifiedRuntimeTarget,
  type StoreConnectionLease,
} from "./types";
import {
  state,
  leaseIsCurrent,
  captureConnectionLease,
  set,
  action,
  leaseSnapshot,
  setForConnection,
  store,
} from "../store";
import {
  scheduleRefresh,
  refreshNow,
  refreshAfterCurrent,
  enqueueFocusAction,
} from "./refresh";
import { type ConnectionClient, bridge } from "../api";
import { type PaneLayout, type Workspace } from "../types";
import { rememberTabLayout } from "../tabLayout";
import {
  projectBrowserLayout,
  browserPaneInDirection,
} from "../browserNavigation";
import { connectionSnapshot } from "./sessions";
import {
  browserSelectionIsCurrent,
  adoptBrowserTarget,
  navigateBrowser,
} from "./creation";
import { OperationalContext } from "./react";
import {
  tabCloseBlockReason,
  tabPinsFor,
  paneCloseBlockReason,
} from "../tabPins";
import { endpointMethodReason } from "../endpointAvailability";

function qualifiedRuntimeTargetIsCurrent(
  target: QualifiedRuntimeTarget,
): boolean {
  const connection = state.connections.find(
    (candidate) => candidate.id === target.connectionId,
  );
  return (
    !state.connectionPaused &&
    state.status === "connected" &&
    connection?.state === "ready" &&
    connection.generation === target.runtimeGeneration
  );
}

function qualifiedLeaseIsCurrent(
  target: QualifiedRuntimeTarget & { isCurrent?(): boolean },
  lease: StoreConnectionLease,
): boolean {
  return (
    target.isCurrent?.() !== false &&
    lease.connectionId === target.connectionId &&
    lease.client.connectionId === target.connectionId &&
    lease.client.acceptsServerGeneration(target.runtimeGeneration) &&
    leaseIsCurrent(lease) &&
    qualifiedRuntimeTargetIsCurrent(target)
  );
}

function assertQualifiedLeaseCurrent(
  target: QualifiedRuntimeTarget,
  lease?: StoreConnectionLease,
) {
  const current = lease
    ? qualifiedLeaseIsCurrent(target, lease)
    : qualifiedRuntimeTargetIsCurrent(target);
  if (!current) {
    throw new Error(
      "The selected host changed before the Office action completed",
    );
  }
}

async function qualifiedAction<T>(
  target: QualifiedRuntimeTarget,
  fn: (lease: StoreConnectionLease) => Promise<T>,
): Promise<T> {
  assertQualifiedLeaseCurrent(target);
  const lease = captureConnectionLease(target.connectionId);
  assertQualifiedLeaseCurrent(target, lease);
  const result = await fn(lease);
  assertQualifiedLeaseCurrent(target, lease);
  scheduleRefresh(lease);
  return result;
}
function notifyPinnedTabClose(reason: string) {
  set({
    notice: {
      kind: "info",
      message: "Tab is pinned",
      detail: reason,
      autoDismissMs: 4000,
    },
  });
}

function swapPanePositions(
  params:
    | { pane_id: string; direction: "left" | "right" | "up" | "down" }
    | { source_pane_id: string; target_pane_id: string },
  client?: ConnectionClient,
) {
  return action(
    async (lease) => {
      if (!leaseIsCurrent(lease))
        throw new Error("Pane move owner is no longer available");
      const result = await lease.client.call("pane.swap", params);
      const swap = result?.swap ?? result;
      const layout = swap?.layout as PaneLayout | undefined;
      // Swapping preserves pane IDs, so keep any newer user selection.
      rememberTabLayout(lease.connectionId, lease.generation, layout ?? null);
      const snapshot = leaseSnapshot(lease);
      if (layout && snapshot.layout?.tab_id === layout.tab_id)
        setForConnection(lease, {
          layout:
            snapshot.navigationMode === "browser-local"
              ? projectBrowserLayout(layout, snapshot.selectedPaneId)
              : layout,
        });
      await refreshNow(lease);
      return result;
    },
    { client },
  );
}

export type PaneSide = "left" | "right" | "up" | "down";

function movePaneTo(
  paneId: string,
  destination:
    | { type: "new_tab"; workspace_id: string }
    | {
        type: "tab";
        tab_id: string;
        split: "right" | "down";
        target_pane_id: string;
      },
  swapWithPaneId?: string,
  client?: ConnectionClient,
) {
  if (client && !client.isCurrent()) return Promise.resolve(undefined);
  const snapshot = client
    ? connectionSnapshot(state, client.connectionId)
    : state;
  const navigation = snapshot.browserNavigation;
  return action(
    async (lease) => {
      const result = await lease.client.call("pane.move", {
        pane_id: paneId,
        destination,
        focus: snapshot.navigationMode !== "browser-local",
      });
      const moved = result?.move_result ?? result;
      // A move can reissue the pane ID, so follow the one Herdr reports.
      const movedPaneId =
        typeof moved?.pane?.pane_id === "string" ? moved.pane.pane_id : paneId;
      if (leaseIsCurrent(lease) && browserSelectionIsCurrent(navigation, lease))
        adoptBrowserTarget(lease, { pane: moved?.pane });
      if (swapWithPaneId && leaseIsCurrent(lease)) {
        try {
          await lease.client.call("pane.swap", {
            source_pane_id: movedPaneId,
            target_pane_id: swapWithPaneId,
          });
        } catch (error) {
          // The move already landed, so report only the side that failed.
          if (leaseIsCurrent(lease))
            setForConnection(lease, {
              notice: {
                kind: "error",
                message: "Pane moved to the other side",
                detail: (error as Error).message,
              },
            });
        }
      }
      return result;
    },
    {
      client,
      refresh: "immediate",
      failureNotice: (error) => ({
        kind: "error",
        message: "Pane move failed",
        detail: error.message,
      }),
    },
  );
}

/** Commands captured by a component's owning runtime, never by sibling focus. */
export function operationalStore(context: OperationalContext) {
  const client = bridge.connection(
    context.connectionId,
    context.runtimeGeneration,
  );
  const lease = {
    connectionId: context.connectionId,
    generation: context.runtimeGeneration,
    client,
  };
  const request = async (method: string, params: Record<string, unknown>) => {
    assertQualifiedLeaseCurrent(context, lease);
    const result = await client.call(method, params);
    assertQualifiedLeaseCurrent(context, lease);
    scheduleRefresh(lease);
    return result;
  };
  const call = (method: string, params: Record<string, unknown>) =>
    action(() => request(method, params), {
      client,
      refresh: "none",
      failureNotice: (error) => ({
        kind: "error",
        message: "Command failed",
        detail: error.message,
      }),
    });
  const worktreeResult = async <T>(
    pending: Promise<T | undefined>,
  ): Promise<T> => {
    const result = await pending;
    assertQualifiedLeaseCurrent(context, lease);
    if (result === undefined)
      throw new Error(
        "Worktree operation returned no admitted result. Its outcome may be uncertain; it was not replayed.",
      );
    return result;
  };
  return {
    get: () => connectionSnapshot(state, context.connectionId),
    subscribe: store.subscribe,
    movePaneToNewTab: (paneId: string) =>
      store.movePaneToNewTab(paneId, client),
    movePaneToTab: (paneId: string, tabId: string) =>
      store.movePaneToTab(paneId, tabId, client),
    movePaneBeside: (source: string, target: string, side: PaneSide) =>
      store.movePaneBeside(source, target, side, client),
    moveTab: (tabId: string, insertIndex: number) =>
      store.moveTab(tabId, insertIndex, client),
    movePane: (paneId: string, direction: "left" | "right" | "up" | "down") =>
      swapPanePositions({ pane_id: paneId, direction }, client),
    swapPanes: (sourcePaneId: string, targetPaneId: string) => {
      const snapshot = leaseSnapshot(lease);
      const source = snapshot.panes.find(
        (pane) => pane.pane_id === sourcePaneId,
      );
      const target = snapshot.panes.find(
        (pane) => pane.pane_id === targetPaneId,
      );
      if (
        !source ||
        !target ||
        source.tab_id !== target.tab_id ||
        source.workspace_id !== target.workspace_id ||
        sourcePaneId === targetPaneId
      )
        return Promise.resolve();
      return swapPanePositions(
        { source_pane_id: sourcePaneId, target_pane_id: targetPaneId },
        client,
      );
    },
    guardTabClose: (tabId: string) => {
      const reason = tabCloseBlockReason(
        tabId,
        tabPinsFor(context.connectionId),
      );
      if (reason) notifyPinnedTabClose(reason);
      return !reason;
    },
    guardPaneClose: (paneId: string) => {
      const reason = paneCloseBlockReason(
        paneId,
        leaseSnapshot(lease).panes,
        tabPinsFor(context.connectionId),
      );
      if (reason) notifyPinnedTabClose(reason);
      return !reason;
    },
    notify: store.notify,
    clearNotice: store.clearNotice,
    setTerminalEndpoint: store.setTerminalEndpoint,
    beginTerminalAttachment: store.beginTerminalAttachment,
    completeTerminalAttachment: store.completeTerminalAttachment,
    revokeTerminalAttachment: store.revokeTerminalAttachment,
    refresh: () => refreshNow(lease),
    terminalScrollReason: (terminalId: string, mouseReporting = false) =>
      mouseReporting
        ? null
        : endpointMethodReason(
            leaseSnapshot(lease).navigationMode,
            leaseSnapshot(lease).endpointAvailability[terminalId],
            "pane.scroll",
          ),
    focusPane: (paneId: string) => {
      if (!leaseIsCurrent(lease)) return Promise.resolve(false);
      const pane = leaseSnapshot(lease).panes.find(
        (pane) => pane.pane_id === paneId,
      );
      return pane
        ? store.focusQualifiedTarget({
            ...context,
            workspaceId: pane.workspace_id,
            paneId,
          })
        : Promise.resolve(false);
    },
    focusPaneDirection: (
      paneId: string,
      direction: "left" | "right" | "up" | "down",
    ) => {
      assertQualifiedLeaseCurrent(context, lease);
      const target = browserPaneInDirection(
        leaseSnapshot(lease).layout,
        paneId,
        direction,
      );
      if (leaseSnapshot(lease).navigationMode === "browser-local")
        return target
          ? store.focusQualifiedTarget({
              ...context,
              workspaceId:
                leaseSnapshot(lease).panes.find(
                  (pane) => pane.pane_id === target,
                )?.workspace_id ?? "",
              paneId: target,
            })
          : Promise.resolve(false);
      return call("pane.focus_direction", { pane_id: paneId, direction });
    },
    resizePane: (
      paneId: string,
      direction: "left" | "right" | "up" | "down",
      amount: number,
    ) => call("pane.resize", { pane_id: paneId, direction, amount }),
    splitPane: async (paneId: string, direction: "right" | "down") => {
      const navigation = leaseSnapshot(lease).browserNavigation;
      const result = await call("pane.split", {
        target_pane_id: paneId,
        direction,
        focus: leaseSnapshot(lease).navigationMode !== "browser-local",
      });
      assertQualifiedLeaseCurrent(context, lease);
      if (browserSelectionIsCurrent(navigation, lease)) {
        adoptBrowserTarget(lease, result);
        if (typeof result?.pane?.pane_id === "string")
          setForConnection(lease, { selectedPaneId: result.pane.pane_id });
      }
      return result;
    },
    zoomPane: (paneId: string) => call("pane.zoom", { pane_id: paneId }),
    closePane: (paneId: string) => {
      const reason = paneCloseBlockReason(
        paneId,
        leaseSnapshot(lease).panes,
        tabPinsFor(context.connectionId),
      );
      if (reason) {
        notifyPinnedTabClose(reason);
        return Promise.resolve();
      }
      return call("pane.close", { pane_id: paneId });
    },
    closePopup: () => call("popup.close", {}),
    togglePluginPopup: (
      pluginId: string,
      actionId: string,
      context: Record<string, unknown> = {},
    ) =>
      action(
        async () => {
          assertQualifiedLeaseCurrent(
            {
              connectionId: lease.connectionId,
              runtimeGeneration: lease.generation,
            },
            lease,
          );
          try {
            await request("popup.close", {});
            return;
          } catch (error) {
            if (!String(error).includes("popup_not_open")) throw error;
          }
          assertQualifiedLeaseCurrent(
            {
              connectionId: lease.connectionId,
              runtimeGeneration: lease.generation,
            },
            lease,
          );
          if (typeof context.workspace_id === "string")
            await request("workspace.focus", {
              workspace_id: context.workspace_id,
            });
          return request("plugin.action.invoke", {
            plugin_id: pluginId,
            action_id: actionId,
            context,
          });
        },
        {
          client,
          refresh: "none",
          failureNotice: (error) => ({
            kind: "error",
            message: "Plugin action failed",
            detail: error.message,
          }),
        },
      ),
    focusWorkspace: (workspaceId: string) =>
      leaseIsCurrent(lease)
        ? store.focusQualifiedTarget({ ...context, workspaceId, paneId: null })
        : Promise.resolve(false),
    focusTab: (tabId: string) => {
      if (!leaseIsCurrent(lease)) return Promise.resolve(false);
      const snapshot = leaseSnapshot(lease);
      const tab = snapshot.tabs.find((tab) => tab.tab_id === tabId);
      if (!tab) return Promise.resolve(false);
      if (snapshot.navigationMode === "browser-local")
        return navigateBrowser(tab.workspace_id, tabId, undefined, lease).then(
          async () => {
            const current = leaseSnapshot(lease);
            if (
              leaseIsCurrent(lease) &&
              !current.panes.some(
                (pane) =>
                  pane.tab_id === tabId &&
                  pane.pane_id === current.selectedPaneId,
              )
            )
              await refreshAfterCurrent(lease);
            return leaseIsCurrent(lease);
          },
        );
      if (tab.focused && snapshot.layout?.tab_id === tabId) {
        const pane =
          snapshot.panes.find(
            (pane) => pane.tab_id === tabId && pane.focused,
          ) ??
          snapshot.panes.find(
            (pane) =>
              pane.tab_id === tabId &&
              pane.pane_id === snapshot.layout?.focused_pane_id,
          );
        // Restore current native/layout focus without rebuilding the tab.
        if (pane)
          return store.focusQualifiedTarget({
            ...context,
            workspaceId: tab.workspace_id,
            paneId: pane.pane_id,
          });
      }
      return enqueueFocusAction(async () => {
        if (!leaseIsCurrent(lease)) return false;
        await lease.client.call("workspace.focus", {
          workspace_id: tab.workspace_id,
        });
        if (!leaseIsCurrent(lease)) return false;
        await lease.client.call("tab.focus", { tab_id: tabId });
        if (!leaseIsCurrent(lease)) return false;
        // Observe the destination layout before replacing the selection;
        // restoring the current tab must not transiently remove its pane.
        await refreshAfterCurrent(lease);
        const layout = leaseSnapshot(lease).layout;
        if (leaseIsCurrent(lease) && layout?.tab_id === tabId)
          setForConnection(lease, { selectedPaneId: layout.focused_pane_id });
        return leaseIsCurrent(lease);
      }, lease.connectionId);
    },
    createTab: (
      workspaceId: string,
      options: { numberedLabel?: boolean; label?: string } = {},
    ) => {
      assertQualifiedLeaseCurrent(context, lease);
      return store.createQualifiedTab(context, workspaceId, options);
    },
    renameWorkspace: (workspaceId: string, label: string) =>
      call("workspace.rename", { workspace_id: workspaceId, label }),
    closeWorkspace: (workspaceId: string) =>
      call("workspace.close", { workspace_id: workspaceId }),
    closeWorkspaceOrThrow: (workspaceId: string) =>
      request("workspace.close", { workspace_id: workspaceId }),
    moveWorkspace: (workspaceId: string, insertIndex: number) =>
      call("workspace.move", {
        workspace_id: workspaceId,
        insert_index: insertIndex,
      }),
    renameTab: (tabId: string, label: string) =>
      call("tab.rename", { tab_id: tabId, label }),
    closeTab: (tabId: string) => {
      const reason = tabCloseBlockReason(
        tabId,
        tabPinsFor(context.connectionId),
      );
      if (reason) {
        notifyPinnedTabClose(reason);
        return Promise.resolve();
      }
      return call("tab.close", { tab_id: tabId });
    },
    gitPullWorkspace: (workspaceId: string) =>
      store.gitPullWorkspace(workspaceId, client),
    createWorktree: async (workspaceId: string, branch: string) => {
      assertQualifiedLeaseCurrent(context, lease);
      return worktreeResult(store.createWorktree(workspaceId, branch, client));
    },
    openWorktree: async (workspaceId: string, target: string, focus = true) => {
      assertQualifiedLeaseCurrent(context, lease);
      return worktreeResult(
        store.openWorktree(workspaceId, target, focus, client),
      );
    },
    openWorktreeFromCwd: async (cwd: string, target: string, focus = true) => {
      assertQualifiedLeaseCurrent(context, lease);
      return worktreeResult(
        store.openWorktreeFromCwd(cwd, target, focus, client),
      );
    },
    removeWorktree: async (
      workspaceId: string,
      force = false,
      workspaceHint?: Workspace,
    ) => {
      assertQualifiedLeaseCurrent(context, lease);
      return worktreeResult(
        store.removeWorktree(workspaceId, force, workspaceHint, client),
      );
    },
    setRepoWorktreeHooksEnabled: (key: string, enabled: boolean) =>
      call("settings.update_repo", {
        key,
        settings: { worktree_hooks_enabled: enabled },
      }),
    setWorkspaceAutoSyncEnabled: (workspaceId: string, enabled: boolean) =>
      call("settings.workspace_auto_sync.update", {
        workspace_id: workspaceId,
        enabled,
      }),
    setWorkspaceAutoSyncConfigEnabled: (key: string, enabled: boolean) =>
      call("settings.workspace_auto_sync.update_key", { key, enabled }),
    createWorkspace: (label?: string, cwd?: string) => {
      if (!leaseIsCurrent(lease)) return Promise.resolve(false);
      return store.createQualifiedWorkspace(context, label, cwd);
    },
    runGitFileAction: (...args: Parameters<typeof store.runGitFileAction>) =>
      store.runGitFileAction(args[0], args[1], args[2], client),
    runGitFileActionBatch: (
      ...args: Parameters<typeof store.runGitFileActionBatch>
    ) => store.runGitFileActionBatch(args[0], args[1], args[2], client),
    runGitRepoAction: (...args: Parameters<typeof store.runGitRepoAction>) =>
      store.runGitRepoAction(args[0], args[1], args[2], client),
  };
}
export {
  qualifiedRuntimeTargetIsCurrent,
  qualifiedLeaseIsCurrent,
  assertQualifiedLeaseCurrent,
  qualifiedAction,
  notifyPinnedTabClose,
  swapPanePositions,
  movePaneTo,
};
