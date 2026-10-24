import {
  type BrowserNavigation,
  selectBrowserTarget,
  projectBrowserNavigation,
  projectBrowserLayout,
} from "../browserNavigation";
import {
  type StoreConnectionLease,
  type State,
  type QualifiedRuntimeTarget,
} from "./types";
import {
  leaseSnapshot,
  state,
  store,
  captureConnectionLease,
  setForConnection,
  leaseIsCurrent,
} from "../store";
import {
  creationPendingReason,
  useCreationProgress,
  type CreationSource,
  retainCreationSource,
} from "../creationRequests";
import { endpointMethodReason } from "../endpointAvailability";
import { useStoreSelector } from "./react";
import { refreshAfterCurrent, refreshNow } from "./refresh";
import {
  assertQualifiedLeaseCurrent,
  qualifiedLeaseIsCurrent,
} from "./operations";
import { provisionalTabLayout, tabLayoutFor } from "../tabLayout";
import { type Pane, type Tab, type Workspace } from "../types";

function browserSelectionIsCurrent(
  navigation: BrowserNavigation,
  lease?: StoreConnectionLease,
) {
  const current = lease
    ? leaseSnapshot(lease).browserNavigation
    : state.browserNavigation;
  const workspaceId = navigation.workspaceId;
  const tabId = workspaceId ? navigation.tabIds[workspaceId] : undefined;
  return (
    current.revision === navigation.revision &&
    current.workspaceId === workspaceId &&
    (!workspaceId || current.tabIds[workspaceId] === tabId) &&
    (!tabId || current.paneIds[tabId] === navigation.paneIds[tabId])
  );
}

export function endpointCreationReason(
  snapshot: Pick<
    State,
    | "navigationMode"
    | "workspaces"
    | "browserNavigation"
    | "panes"
    | "endpointAvailability"
    | "terminalAttachments"
    | "activeConnectionId"
    | "serverRuntimeGeneration"
  >,
  method: "tab.create" | "workspace.create",
  workspaceId = snapshot.browserNavigation.workspaceId,
  sourcePaneId?: string,
): string | null {
  const pending = creationPendingReason(
    {
      connectionId: snapshot.activeConnectionId,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
    },
    method === "tab.create" ? "tab" : "workspace",
    workspaceId,
  );
  if (pending) return pending;
  if (snapshot.navigationMode === "shared") return null;
  // Empty bootstrap deliberately uses the validated control API, not an endpoint.
  if (method === "workspace.create" && snapshot.workspaces.length === 0)
    return null;
  const source = browserCreationSource(
    workspaceId ?? null,
    snapshot,
    sourcePaneId,
  );
  const pane = snapshot.panes.find((pane) => pane.pane_id === source?.pane_id);
  const advertisement = pane
    ? (snapshot.terminalAttachments[pane.terminal_id]?.advertisement ??
      snapshot.endpointAvailability[pane.terminal_id])
    : null;
  if (advertisement) {
    const reason =
      endpointMethodReason(
        snapshot.navigationMode,
        advertisement,
        "pane.focus",
      ) ?? endpointMethodReason(snapshot.navigationMode, advertisement, method);
    if (reason) return reason;
  }
  if (!source)
    return "No current source terminal is available in this workspace.";
  const attachment = snapshot.terminalAttachments[source.terminal_id];
  return attachment && !attachment.ready
    ? "Endpoint availability is loading. Preparing the source terminal."
    : null;
}

export function useEndpointCreationReason(
  method: "tab.create" | "workspace.create",
  workspaceId?: string,
) {
  useCreationProgress();
  return useStoreSelector((snapshot) =>
    endpointCreationReason(snapshot, method, workspaceId),
  );
}

function browserCreationSource(
  workspaceId: string | null,
  snapshot: Pick<State, "browserNavigation" | "panes"> = state,
  sourcePaneId?: string,
) {
  const tabId = workspaceId
    ? snapshot.browserNavigation.tabIds[workspaceId]
    : undefined;
  const paneId = tabId ? snapshot.browserNavigation.paneIds[tabId] : undefined;
  const preferred = sourcePaneId
    ? snapshot.panes.find(
        (pane) =>
          pane.pane_id === sourcePaneId && pane.workspace_id === workspaceId,
      )
    : undefined;
  if (sourcePaneId && !preferred) return null;
  const pane =
    preferred ??
    snapshot.panes.find(
      (pane) =>
        pane.pane_id === paneId &&
        pane.workspace_id === workspaceId &&
        pane.tab_id === tabId,
    ) ??
    snapshot.panes.find((pane) => pane.workspace_id === workspaceId);
  return pane
    ? {
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        pane_id: pane.pane_id,
        terminal_id: pane.terminal_id,
      }
    : null;
}

async function prepareQualifiedCreation(
  target: QualifiedRuntimeTarget,
  lease: StoreConnectionLease,
  method: "tab.create" | "workspace.create",
  sourceWorkspaceId?: string,
  sourcePaneId?: string,
) {
  let snapshot = leaseSnapshot(lease);
  if (
    snapshot.serverRuntimeGeneration !== target.runtimeGeneration ||
    !snapshot.lastRefresh ||
    snapshot.error
  ) {
    await refreshAfterCurrent(lease);
    assertQualifiedLeaseCurrent(target, lease);
    snapshot = leaseSnapshot(lease);
    if (
      snapshot.serverRuntimeGeneration !== target.runtimeGeneration ||
      !snapshot.lastRefresh ||
      snapshot.error
    )
      throw new Error(
        snapshot.error ??
          "The destination host's navigation mode is not available yet.",
      );
  }
  if (snapshot.navigationMode === "shared")
    return { browserLocal: false, source: null, release: () => {} };
  if (method === "workspace.create" && snapshot.workspaces.length === 0)
    return { browserLocal: true, source: null, release: () => {} };
  const workspaceId =
    sourceWorkspaceId ??
    snapshot.browserNavigation.workspaceId ??
    snapshot.workspaces[0]?.workspace_id ??
    null;
  const nativeSource = browserCreationSource(
    workspaceId,
    snapshot,
    sourcePaneId,
  );
  if (!nativeSource)
    throw new Error(
      "No current source terminal is available in the destination workspace.",
    );
  const source: CreationSource = { ...nativeSource, ...target };
  const advertisement = snapshot.endpointAvailability[source.terminal_id];
  if (advertisement) {
    const reason =
      endpointMethodReason("browser-local", advertisement, "pane.focus") ??
      endpointMethodReason("browser-local", advertisement, method);
    if (reason) throw new Error(reason);
  }
  const release = retainCreationSource(source);
  let attachmentAttempt: number | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let unsubscribe = () => {};
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "Source terminal preparation timed out; nothing was created.",
            ),
          ),
        20_000,
      );
      function finish(error?: Error) {
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error);
        else resolve();
      }
      function check() {
        if (!qualifiedLeaseIsCurrent(target, lease))
          return finish(
            new Error(
              "The destination host changed during terminal preparation.",
            ),
          );
        const current = leaseSnapshot(lease);
        if (
          !current.panes.some(
            (pane) =>
              pane.pane_id === source.pane_id &&
              pane.terminal_id === source.terminal_id &&
              pane.tab_id === source.tab_id &&
              pane.workspace_id === source.workspace_id,
          )
        )
          return finish(
            new Error("The source terminal moved or closed before creation."),
          );
        const attachment = current.terminalAttachments[source.terminal_id];
        if (!attachment?.ready) return;
        const reason =
          endpointMethodReason(
            "browser-local",
            attachment.advertisement,
            "pane.focus",
          ) ??
          endpointMethodReason(
            "browser-local",
            attachment.advertisement,
            method,
          );
        if (!reason) attachmentAttempt = attachment.attempt;
        finish(reason ? new Error(reason) : undefined);
      }
      unsubscribe = store.subscribe(check);
      check();
    });
    assertQualifiedLeaseCurrent(target, lease);
    return {
      browserLocal: true,
      source: nativeSource,
      release,
      attachmentAttempt,
    };
  } catch (error) {
    release();
    throw error;
  }
}

function assertCreationSourceCurrent(
  target: QualifiedRuntimeTarget,
  lease: StoreConnectionLease,
  prepared: Awaited<ReturnType<typeof prepareQualifiedCreation>>,
) {
  assertQualifiedLeaseCurrent(target, lease);
  if (!prepared.source) return;
  const source = prepared.source;
  const snapshot = leaseSnapshot(lease);
  const attachment = snapshot.terminalAttachments[source.terminal_id];
  if (
    !attachment?.ready ||
    attachment.attempt !== prepared.attachmentAttempt ||
    !snapshot.panes.some(
      (pane) =>
        pane.pane_id === source.pane_id &&
        pane.tab_id === source.tab_id &&
        pane.workspace_id === source.workspace_id &&
        pane.terminal_id === source.terminal_id,
    )
  )
    throw new Error(
      "The prepared source changed before dispatch; nothing was created.",
    );
}

function navigateBrowser(
  workspaceId: string,
  tabId?: string,
  paneId?: string,
  lease = captureConnectionLease(),
) {
  const navigation = selectBrowserTarget(
    leaseSnapshot(lease).browserNavigation,
    workspaceId,
    tabId,
    paneId,
  );
  const projected = projectBrowserNavigation(
    navigation,
    leaseSnapshot(lease).workspaces,
    leaseSnapshot(lease).tabs,
    leaseSnapshot(lease).panes,
  );
  const activeTabId = projected.browserNavigation.tabIds[workspaceId];
  const nextLayout =
    leaseSnapshot(lease).layout?.tab_id === activeTabId
      ? leaseSnapshot(lease).layout
      : provisionalTabLayout(
          tabLayoutFor(
            leaseSnapshot(lease).activeConnectionId,
            leaseSnapshot(lease).connectionGeneration,
            activeTabId,
          ),
          leaseSnapshot(lease).panes,
          activeTabId,
        );
  setForConnection(lease, {
    ...projected,
    layout: projectBrowserLayout(nextLayout, projected.selectedPaneId),
    pendingFocusWorkspaceId: null,
    pendingFocusWorkspaceSettledAt: null,
    error: null,
  });
  return refreshNow(lease);
}

/** Adopt an explicit RPC result without requiring it in an older list snapshot. */
function adoptBrowserTarget(lease: StoreConnectionLease, result: unknown) {
  if (
    !leaseIsCurrent(lease) ||
    leaseSnapshot(lease).navigationMode !== "browser-local" ||
    !result ||
    typeof result !== "object"
  )
    return;
  const target = result as {
    root_pane?: Partial<Pane>;
    pane?: Partial<Pane>;
    tab?: Partial<Tab>;
    workspace?: Partial<Workspace>;
  };
  const pane = target.root_pane ?? target.pane;
  const tabId = pane?.tab_id ?? target.tab?.tab_id;
  const workspaceId =
    pane?.workspace_id ??
    target.tab?.workspace_id ??
    target.workspace?.workspace_id;
  if (typeof workspaceId !== "string") return;
  setForConnection(lease, {
    browserNavigation: selectBrowserTarget(
      leaseSnapshot(lease).browserNavigation,
      workspaceId,
      typeof tabId === "string" ? tabId : undefined,
      typeof pane?.pane_id === "string" ? pane.pane_id : undefined,
    ),
  });
}
export {
  browserSelectionIsCurrent,
  prepareQualifiedCreation,
  assertCreationSourceCurrent,
  navigateBrowser,
  adoptBrowserTarget,
};
