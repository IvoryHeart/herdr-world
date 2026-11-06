import { refreshBridgeStatus } from "./store/catalogue";
import {
  holdFocusedOwner,
  refreshHeldOwners,
  sharedAcquisitionEnabled,
} from "./store/focusedInterest";
import {
  focusTaskNotification,
  notificationPaneMatches,
  matchesCapturedAgentSession,
  type NotificationFocusOptions,
} from "./store/notificationFocus";
import { installStoreControls } from "./store/controls";
import {
  emptyServerSessionState,
  nextRecentPaneIds,
  SERVER_SESSION_KEYS,
  serverSessionFromState,
  connectionSnapshot,
  retireConnectionSessionObservations,
  jsonDeepEqual,
  activateConnectionState,
  type CatalogSessionReconciliation,
  mergeConnectionCatalog,
  reconcileConnectionCatalogSessions,
  serverSessionEqual,
  connectionEventIsActive,
  numberedCreatedTabRename,
} from "./store/sessions";
import {
  type State,
  type ServerSessionState,
  type StoreConnectionLease,
  type Notice,
  type QualifiedRuntimeTarget,
  type WorkspaceSourceTarget,
  type QualifiedFocusTarget,
  type TaskNotificationTarget,
  type WorktreeRemovedTarget,
  type PopupInfo,
} from "./store/types";
import { worldLocalStorage, subscribeLocalStorage } from "./browserStorage";
import {
  STARTUP_DEFAULT_CONNECTION_ID,
  copyStartupProfileStorage,
} from "./connectionStorage";
import {
  storedTaskNotificationsEnabled,
  storedTaskNotificationPreferences,
  notificationPermission,
  TASK_NOTIFICATIONS_KEY,
  taskCompletionTracker,
  notifyHerdrTask,
  notifyRangerTask,
  taskNotificationTargetIsCurrent,
  TASK_NOTIFICATION_PREFERENCES_KEY,
} from "./store/notifications";
import {
  storedAutomaticUpdateChecksEnabled,
  storedPendingRestartVersion,
  startPolling,
  reloadWhenUpdatedServerIsReady,
  consumePendingHerdrUpgrade,
  handlePreferenceStorageChange,
  redirectToLogin,
  stopPolling,
  checkForUpdate,
  retireUpdateChecks,
  dismissUpdate,
  AUTOMATIC_UPDATE_CHECKS_KEY,
  applyAutomaticUpdateChecksEnabled,
  storePendingRestartVersion,
  startUpdatePolling,
  updateTimer,
} from "./store/updates";
import {
  bridge,
  type ConnectionSummary,
  parseConnectionSummary,
  type ConnectionClient,
  UncertainRequestError,
  type ConnectionStatus,
  type PopupStatePush,
  type HerdrEventMsg,
} from "./api";
import {
  scheduleRefresh,
  refreshNow,
  clearPendingFocusWorkspace,
  settlePendingFocusWorkspace,
  focusActionChains,
  queuedConnectionKeys,
  stampPendingFocusWorkspace,
  enqueueFocusAction,
  refreshingConnectionKeys,
} from "./store/refresh";
import { disposeTerminalConnection } from "./terminalConnection";
import { isReconnectRetryableError } from "./reconnectRetry";
import {
  clearTerminalRelayViewports,
  terminalRelayViewportForTab,
} from "./terminalResize";
import { retainTabLayoutOwners } from "./tabLayout";
import { parseHerdrTaskNotification } from "./herdrTaskNotification";
import { publishLastStepCompletion } from "./lastStepCompletionStore";
import {
  parseEndpointAdvertisement,
  endpointMethodReason,
} from "./endpointAvailability";
import {
  navigateBrowser,
  prepareQualifiedCreation,
  assertCreationSourceCurrent,
  browserSelectionIsCurrent,
  adoptBrowserTarget,
} from "./store/creation";
import { creationFailureMessage, coordinateCreation } from "./creationRequests";
import {
  assertQualifiedLeaseCurrent,
  qualifiedLeaseIsCurrent,
  notifyPinnedTabClose,
  qualifiedRuntimeTargetIsCurrent,
  qualifiedAction,
  swapPanePositions,
  movePaneTo,
  type PaneSide,
} from "./store/operations";
import {
  tabCloseBlockReason,
  tabPinsFor,
  paneCloseBlockReason,
} from "./tabPins";
import { clearTerminalComposerDrafts } from "./terminalComposer";
import { moveTabInList } from "./tabReorder";
import {
  type Pane,
  type GitDiffEntry,
  type Workspace,
  type PaneLayout,
} from "./types";
import {
  type GitFileAction,
  gitFileActionLabel,
  gitFileActionSuccessMessage,
  type GitRepoAction,
  type GitWorkingCounts,
  gitRepoActionSuccessMessage,
} from "./gitActions";
import {
  type WorktreeHookRunResult,
  summarizeDirectHookResult,
  WORKTREE_REMOVED_EVENT,
  type WorktreeRemovalCleanup,
  worktreeRemovalCompletionNotice,
} from "./store/worktree";
import { prepareTaskNotifications } from "./taskNotifications";
import { syncTaskPush, type TaskNotificationPreferences } from "./taskPush";
import {
  projectBrowserLayout,
  browserPaneInDirection,
} from "./browserNavigation";
import { resetChimeBursts } from "./chimes/chimeCenter";

let herdrUpgradePollMs = 1000;
// A verified download, a live handoff and a plugin rebuild.
const HERDR_UPGRADE_TIMEOUT_MS = 15 * 60_000;

const initialSession = emptyServerSessionState();
const initial: State = {
  status: "disconnected",
  connectionPaused:
    typeof localStorage !== "undefined" &&
    worldLocalStorage.getItem("connectionPaused") === "true",
  bridgeStatus: null,
  connections: [],
  catalogueReady: false,
  defaultConnectionId: STARTUP_DEFAULT_CONNECTION_ID,
  activeConnectionId: STARTUP_DEFAULT_CONNECTION_ID,
  connectionGeneration: 0,
  sessionsByConnectionId: {
    [STARTUP_DEFAULT_CONNECTION_ID]: initialSession,
  },
  ...initialSession,
  notice: null,
  taskNotificationsEnabled: storedTaskNotificationsEnabled(),
  taskNotificationPreferences: storedTaskNotificationPreferences(),
  taskNotificationTransport:
    worldLocalStorage.getItem("taskNotificationTransport") === "push"
      ? "push"
      : "local",
  taskNotificationBusy: false,
  taskNotificationPermission: notificationPermission(),
  automaticUpdateChecksEnabled: storedAutomaticUpdateChecksEnabled(),
  updateInfo: null,
  updateInstalling: false,
  herdrUpgrading: false,
  pendingRestartVersion: storedPendingRestartVersion(),
  dismissedUpdateVersion: null,
};

let state = initial;
const listeners = new Set<() => void>();
let noticeSeq = 0;
function emit() {
  listeners.forEach((l) => l());
}

function set(patch: Partial<State>) {
  if (patch.notice) {
    patch = { ...patch, notice: { ...patch.notice, id: ++noticeSeq } };
  }
  if (
    patch.selectedPaneId !== undefined ||
    patch.panes !== undefined ||
    patch.layout !== undefined
  ) {
    const selectedForHistory =
      patch.selectedPaneId !== undefined
        ? patch.selectedPaneId
        : state.selectedPaneId;
    const layoutForHistory =
      patch.layout !== undefined ? patch.layout : state.layout;
    patch = {
      ...patch,
      recentPaneIds: nextRecentPaneIds(
        selectedForHistory ?? layoutForHistory?.focused_pane_id,
        patch.recentPaneIds ?? state.recentPaneIds,
        patch.panes ?? state.panes,
      ),
    };
  }
  const sessionPatch: Partial<ServerSessionState> = {};
  let hasSessionPatch = false;
  for (const key of SERVER_SESSION_KEYS) {
    if (!(key in patch)) continue;
    hasSessionPatch = true;
    Object.assign(sessionPatch, { [key]: patch[key] });
  }
  if (hasSessionPatch) {
    const updatedSession = {
      ...(state.sessionsByConnectionId[state.activeConnectionId] ??
        serverSessionFromState(state)),
      ...sessionPatch,
    };
    patch = {
      ...patch,
      sessionsByConnectionId: {
        ...state.sessionsByConnectionId,
        ...patch.sessionsByConnectionId,
        [state.activeConnectionId]: updatedSession,
      },
    };
  }
  state = { ...state, ...patch };
  emit();
}

function captureConnectionLease(
  connectionId = state.activeConnectionId,
): StoreConnectionLease {
  const runtimeGeneration = catalogReadyForConnection
    ? (state.connections.find((connection) => connection.id === connectionId)
        ?.generation ?? null)
    : null;
  return {
    connectionId,
    generation: runtimeGeneration ?? state.connectionGeneration,
    client: bridge.connection(connectionId, runtimeGeneration),
  };
}

function leaseIsCurrent(lease: StoreConnectionLease): boolean {
  return !state.connectionPaused && lease.client.isCurrent();
}

function leaseSnapshot(lease: StoreConnectionLease): State {
  return connectionSnapshot(state, lease.connectionId);
}

function setForConnection(
  lease: StoreConnectionLease,
  patch: Partial<State>,
): boolean {
  if (!leaseIsCurrent(lease)) return false;
  if (lease.connectionId === state.activeConnectionId) set(patch);
  else {
    const session = { ...leaseSnapshot(lease) };
    const sessionPatch: Partial<ServerSessionState> = {};
    for (const key of SERVER_SESSION_KEYS) {
      if (key in patch) Object.assign(sessionPatch, { [key]: patch[key] });
    }
    const updated = { ...serverSessionFromState(session), ...sessionPatch };
    updated.recentPaneIds = nextRecentPaneIds(
      updated.selectedPaneId,
      updated.recentPaneIds,
      updated.panes,
    );
    state = {
      ...state,
      ...(patch.agentActivityHistory && {
        agentActivityHistory: patch.agentActivityHistory,
      }),
      sessionsByConnectionId: {
        ...state.sessionsByConnectionId,
        [lease.connectionId]: updated,
      },
    };
    emit();
    if (patch.notice) set({ notice: patch.notice });
  }
  return true;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
let initialized = false;
let catalogRequestSeq = 0;
export function nextCatalogRequest() {
  return ++catalogRequestSeq;
}
let appliedCatalogRequestSeq = 0;
let catalogReadyForConnection = false;
let terminalReattachPending = false;
let connectionRecoveryIntent: "resume" | "reconnect" | null = null;
let taskNotificationPreferenceVersion = 0;

function reportTaskNotificationFailure(error: unknown, version: number) {
  if (version !== taskNotificationPreferenceVersion) return;
  taskNotificationPreferenceVersion++;
  set({
    taskNotificationsEnabled: false,
    taskNotificationBusy: false,
    taskNotificationPermission: notificationPermission(),
    notice: {
      kind: "error",
      message: "Task notifications are unavailable",
      detail: error instanceof Error ? error.message : String(error),
    },
  });
  worldLocalStorage.setItem(TASK_NOTIFICATIONS_KEY, "false");
}

function selectConnectionNow(connectionId: string, refresh = true): boolean {
  if (!connectionId || connectionId === state.activeConnectionId) return false;
  if (
    state.connections.length > 0 &&
    !state.connections.some((connection) => connection.id === connectionId)
  ) {
    return false;
  }
  if (
    state.activeConnectionId === STARTUP_DEFAULT_CONNECTION_ID &&
    typeof localStorage !== "undefined"
  ) {
    copyStartupProfileStorage(worldLocalStorage, connectionId);
  }
  const generation = bridge.setActiveConnection(connectionId);
  state = activateConnectionState(state, connectionId, generation);
  emit();
  if (
    refresh &&
    initialized &&
    !state.connectionPaused &&
    state.status === "connected"
  ) {
    startPolling();
    void refreshNow(captureConnectionLease());
    // Popup state is tracked per connection on the bridge, so a switch needs
    // its own query: otherwise only the connection that was active when the
    // socket came up ever reports one.
    void store.watchPopup();
  }
  return true;
}

function resetActiveConnectionLease(
  connections: ConnectionSummary[],
  defaultConnectionId: string,
  reconciliation: CatalogSessionReconciliation,
) {
  disposeTerminalConnection(
    {
      connectionId: state.activeConnectionId,
      generation: state.serverRuntimeGeneration ?? state.connectionGeneration,
    },
    false,
  );

  taskCompletionTracker.reset(state.activeConnectionId);
  const generation = bridge.advanceActiveConnectionGeneration();
  const runtimeGeneration =
    connections.find((connection) => connection.id === state.activeConnectionId)
      ?.generation ?? null;
  const activeSession =
    reconciliation.activeSession ?? emptyServerSessionState(runtimeGeneration);
  state = {
    ...state,
    ...activeSession,
    connections,
    defaultConnectionId,
    connectionGeneration: generation,
    catalogueReady: true,
    sessionsByConnectionId: {
      ...reconciliation.sessionsByConnectionId,
      [state.activeConnectionId]: activeSession,
    },
    notice: null,
  };
  emit();
  if (initialized && !state.connectionPaused && state.status === "connected") {
    startPolling();
    void refreshNow(captureConnectionLease());
  }
}

export function applyConnectionCatalog(
  result: unknown,
  requestSeq: number,
  epoch = bridge.connectionEpoch,
) {
  if (
    epoch !== bridge.connectionEpoch ||
    state.status !== "connected" ||
    state.connectionPaused ||
    requestSeq < appliedCatalogRequestSeq ||
    !result ||
    typeof result !== "object"
  ) {
    return false;
  }
  const catalog = result as {
    default_connection_id?: unknown;
    connections?: unknown;
  };
  if (
    !Array.isArray(catalog.connections) ||
    catalog.connections.some(
      (value) => parseConnectionSummary(value) === null,
    ) ||
    new Set(
      catalog.connections.map((value) => parseConnectionSummary(value)!.id),
    ).size !== catalog.connections.length
  )
    return false;
  appliedCatalogRequestSeq = requestSeq;
  const readinessChanged = !state.catalogueReady;
  const defaultConnectionId =
    typeof catalog.default_connection_id === "string" &&
    catalog.default_connection_id.length > 0
      ? catalog.default_connection_id
      : state.defaultConnectionId;
  const connections = Array.isArray(catalog.connections)
    ? mergeConnectionCatalog(state.connections, catalog.connections)
    : state.connections;
  if (Array.isArray(catalog.connections)) {
    catalogReadyForConnection = true;
    bridge.setConnectionRuntimeGenerations(connections);
  }
  const nextActive = connections.find(
    (connection) => connection.id === state.activeConnectionId,
  );
  retainTabLayoutOwners(connections);
  const reconciliation = reconcileConnectionCatalogSessions(state, connections);
  for (const previous of state.connections) {
    const next = connections.find((candidate) => candidate.id === previous.id);
    if (
      !next ||
      next.generation !== previous.generation ||
      (previous.state === "ready" && next.state !== "ready")
    ) {
      disposeTerminalConnection(
        { connectionId: previous.id, generation: previous.generation },
        false,
      );
    }
  }
  for (const connectionId of reconciliation.invalidatedConnectionIds) {
    taskCompletionTracker.reset(connectionId);
  }
  if (nextActive && reconciliation.activeRuntimeChanged) {
    resetActiveConnectionLease(
      connections,
      defaultConnectionId,
      reconciliation,
    );
    return true;
  }

  // Steady-state catalog polls rebuild identical DTOs every tick. Publish
  // only real changes so unchanged slices keep their references and idle
  // polls do not re-render every subscriber.
  const stableConnections = jsonDeepEqual(state.connections, connections)
    ? state.connections
    : connections;
  const previousSessions = state.sessionsByConnectionId;
  const nextSessions = reconciliation.sessionsByConnectionId;
  let sessionsChanged =
    reconciliation.invalidatedConnectionIds.length > 0 ||
    Object.keys(nextSessions).length !== Object.keys(previousSessions).length;
  const stableSessions: Record<string, ServerSessionState> = {};
  for (const [id, session] of Object.entries(nextSessions)) {
    const previous = previousSessions[id];
    if (previous && serverSessionEqual(previous, session)) {
      stableSessions[id] = previous;
    } else {
      stableSessions[id] = session;
      sessionsChanged = true;
    }
  }
  if (
    stableConnections === state.connections &&
    !sessionsChanged &&
    defaultConnectionId === state.defaultConnectionId
  ) {
    if (readinessChanged) set({ catalogueReady: true });
    if (!nextActive) selectConnectionNow(defaultConnectionId);
    return true;
  }

  state = {
    ...state,
    ...(reconciliation.activeSession ?? {}),
    connections: stableConnections,
    catalogueReady: true,
    defaultConnectionId,
    sessionsByConnectionId: stableSessions,
  };
  emit();
  if (!nextActive) selectConnectionNow(defaultConnectionId);
  return true;
}

async function refreshConnectionCatalog(): Promise<boolean> {
  if (state.connectionPaused || state.status !== "connected") return false;
  const requestSeq = ++catalogRequestSeq;
  const epoch = bridge.connectionEpoch;
  try {
    const admitted = applyConnectionCatalog(
      await bridge.call("connections.list"),
      requestSeq,
      epoch,
    );
    if (!admitted && sharedAcquisitionEnabled()) void refreshBridgeStatus();
    return admitted;
  } catch {
    if (sharedAcquisitionEnabled()) void refreshBridgeStatus();
    // Legacy services retain their next status poll.
    return false;
  }
}

export function rearmTerminalAttachmentsAfterCatalog(
  catalogReady: boolean,
): boolean {
  if (
    !terminalReattachPending ||
    !catalogReady ||
    state.status !== "connected" ||
    state.connectionPaused
  ) {
    return false;
  }
  terminalReattachPending = false;
  const sessionsByConnectionId = Object.fromEntries(
    Object.entries(state.sessionsByConnectionId).map(([id, session]) => [
      id,
      {
        ...session,
        terminalAttachEpoch: session.terminalAttachEpoch + 1,
        endpointAvailability: {},
        terminalAttachments: {},
        lastRefresh: 0,
      },
    ]),
  );
  state = {
    ...state,
    sessionsByConnectionId,
    terminalAttachEpoch: state.terminalAttachEpoch + 1,
    terminalAttachments: {},
    lastRefresh: 0,
  };
  emit();
  return true;
}

const RECONNECT_RETRY_WAIT_MS = 10_000;
const RECONNECT_RETRY_POLL_MS = 100;

async function waitForReconnectReady(): Promise<boolean> {
  const deadline = Date.now() + RECONNECT_RETRY_WAIT_MS;
  // The connection catalog carrying the runtime generation lands shortly
  // after the socket reconnects; a fresh lease only reports current once
  // scoped routing is usable, so poll instead of trusting the status flip.
  while (Date.now() < deadline) {
    if (
      state.status === "connected" &&
      !state.connectionPaused &&
      captureConnectionLease().client.isCurrent()
    ) {
      return true;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RECONNECT_RETRY_POLL_MS),
    );
  }
  return false;
}

async function action<T>(
  fn: (lease: StoreConnectionLease) => Promise<T>,
  options: {
    refresh?: "scheduled" | "immediate" | "none";
    pendingFocusWorkspaceSeq?: number;
    failureNotice?: (error: Error) => Notice;
    retryOnReconnect?: boolean;
    client?: ConnectionClient;
  } = {},
): Promise<T | undefined> {
  if (state.connectionPaused) {
    // The caller may have already stamped a focus marker; the attempt never
    // starts here, so release it instead of stranding it unsettled.
    if (options.pendingFocusWorkspaceSeq !== undefined) {
      clearPendingFocusWorkspace(options.pendingFocusWorkspaceSeq);
    }
    set({
      notice: {
        kind: "info",
        message: "Connection is paused",
        detail: "Resume the connection before sending actions to Herdr.",
      },
    });
    return undefined;
  }
  const attempt = (
    activeLease: StoreConnectionLease,
  ): Promise<{ ok: true; value: T } | { ok: false; error: Error }> =>
    fn(activeLease).then(
      (value) => ({ ok: true, value }) as const,
      (error: Error) => ({ ok: false, error }) as const,
    );
  let activeLease = options.client
    ? {
        connectionId: options.client.connectionId,
        generation:
          options.client.serverRuntimeGeneration ?? options.client.generation,
        client: options.client,
      }
    : captureConnectionLease();
  const hostLabel =
    state.connections.find((owner) => owner.id === activeLease.connectionId)
      ?.label ?? activeLease.connectionId;
  let outcome = await attempt(activeLease);
  // A focus action fired while the bridge socket is reconnecting fails before
  // reaching the server, which makes clicks right after returning to the app
  // look dropped. Retry it once on the fresh connection with a new lease.
  if (
    !outcome.ok &&
    options.retryOnReconnect &&
    isReconnectRetryableError(outcome.error) &&
    !state.connectionPaused &&
    (await waitForReconnectReady()) &&
    !state.connectionPaused
  ) {
    activeLease = captureConnectionLease(activeLease.connectionId);
    outcome = await attempt(activeLease);
  }
  if (!outcome.ok) {
    // Releasing the focus marker must not depend on the lease surviving: the
    // attempt is over, and a dead lease (pause, disconnect, connection
    // switch) would otherwise strand the marker in a cached session whose
    // steady-state restore never marks it settled.
    if (options.pendingFocusWorkspaceSeq !== undefined) {
      clearPendingFocusWorkspace(options.pendingFocusWorkspaceSeq);
    }
    const error = outcome.error;
    if (error instanceof UncertainRequestError) {
      if (leaseIsCurrent(activeLease))
        setForConnection(activeLease, { error: error.message });
      set({
        notice: {
          kind: "error",
          message: "Action outcome is uncertain",
          detail: `A change on ${hostLabel} may have completed. ${options.failureNotice?.(error).detail ?? error.message}`,
        },
      });
      return undefined;
    }
    if (!leaseIsCurrent(activeLease)) return undefined;
    const notice = options.failureNotice?.(error);
    setForConnection(activeLease, {
      error: error.message,
      notice: notice
        ? {
            ...notice,
            detail: options.client
              ? `${hostLabel}: ${notice.detail ?? error.message}`
              : notice.detail,
          }
        : state.notice,
    });
    return undefined;
  }
  // The action completed, so the attempt is settled even when the lease died
  // before the client observed it; the next fresh observation decides.
  if (options.pendingFocusWorkspaceSeq !== undefined) {
    settlePendingFocusWorkspace(options.pendingFocusWorkspaceSeq);
  }
  if (!leaseIsCurrent(activeLease)) return undefined;
  if (options.refresh === "immediate") {
    void refreshNow(activeLease);
  } else if (options.refresh !== "none") {
    scheduleRefresh(activeLease);
  }
  return outcome.value;
}

function handleBridgeStatus(s: ConnectionStatus) {
  if (s === "disconnected") {
    set({ tabMoveSupported: false, endpointAvailability: {} });
    catalogReadyForConnection = false;
    terminalReattachPending = true;
    bridge.setConnectionRuntimeGenerations([]);
    clearTerminalRelayViewports();
    focusActionChains.clear();
    queuedConnectionKeys.clear();
  }
  const completedRecovery =
    s === "connected" && !state.connectionPaused && state.notice?.loading
      ? connectionRecoveryIntent
      : null;
  if (s === "connected") connectionRecoveryIntent = null;
  const completedRecoveryMessage =
    completedRecovery === "reconnect"
      ? "Browser reconnected"
      : "Browser sync resumed";
  set(
    completedRecovery
      ? {
          status: s,
          connectionGeneration: state.connectionGeneration,
          notice: {
            kind: "success",
            message: completedRecoveryMessage,
            autoDismissMs: 5000,
          },
        }
      : {
          status: s,
          connectionGeneration:
            s === "disconnected"
              ? bridge.clientGeneration
              : state.connectionGeneration,
          bridgeStatus: s === "connected" ? state.bridgeStatus : null,
        },
  );
  if (s === "connected" && !state.connectionPaused) {
    // Polling may have been stopped by the hello-driven initial
    // connection switch; every settled connection must re-arm it.
    startPolling();
    void refreshConnectionCatalog().then((catalogReady) => {
      if (
        !catalogReady ||
        state.status !== "connected" ||
        state.connectionPaused
      ) {
        return;
      }
      rearmTerminalAttachmentsAfterCatalog(true);
      void refreshNow();
      void refreshBridgeStatus();
      // Popup state is pushed only on change, so ask once per
      // settled connection.
      void store.watchPopup();
    });
    if (state.pendingRestartVersion) {
      void reloadWhenUpdatedServerIsReady(state.pendingRestartVersion);
    } else if (consumePendingHerdrUpgrade()) {
      void store.upgradeHerdr({ automatic: true });
    }
  }
}

function handlePopupPush(push: PopupStatePush) {
  if (
    !state.connectionPaused &&
    state.connections.some(
      (connection) =>
        connection.id === push.connection_id &&
        connection.state === "ready" &&
        connection.generation === push.connection_generation,
    )
  ) {
    setForConnection(captureConnectionLease(push.connection_id), {
      popup: push.popup,
    });
  }
}

function handleHerdrEvent(event: HerdrEventMsg) {
  if (
    !state.connectionPaused &&
    (connectionEventIsActive(
      state,
      event.connection_id,
      event.connection_generation,
    ) ||
      state.connections.some(
        (connection) =>
          connection.id === event.connection_id &&
          connection.state === "ready" &&
          connection.generation === event.connection_generation,
      ))
  ) {
    if (event.event === "herdr-world.task_notification") {
      const notification = parseHerdrTaskNotification(event.data);
      if (notification) notifyHerdrTask(event.connection_id, notification);
      return;
    }
    if (
      event.event === "workspace.last_step_completed" &&
      typeof event.data.workspace_id === "string"
    ) {
      publishLastStepCompletion(event.connection_id, event.data.workspace_id);
    }
    scheduleRefresh(captureConnectionLease(event.connection_id));
  }
}

let terminalAttachmentAttempt = 0;

export const store = {
  beginTerminalAttachment(client: ConnectionClient, terminalId: string) {
    const attempt = ++terminalAttachmentAttempt;
    if (!client.isCurrent()) return attempt;
    const lease = {
      connectionId: client.connectionId,
      generation: client.serverRuntimeGeneration ?? client.generation,
      client,
    };
    setForConnection(lease, {
      terminalAttachments: {
        ...leaseSnapshot(lease).terminalAttachments,
        [terminalId]: { attempt, ready: false },
      },
      endpointAvailability: {
        ...leaseSnapshot(lease).endpointAvailability,
        [terminalId]: null,
      },
    });
    return attempt;
  },
  completeTerminalAttachment(
    client: ConnectionClient,
    terminalId: string,
    attempt: number,
    advertisement: unknown,
  ) {
    const lease = {
      connectionId: client.connectionId,
      generation: client.serverRuntimeGeneration ?? client.generation,
      client,
    };
    const snapshot = leaseSnapshot(lease);
    if (
      !client.isCurrent() ||
      snapshot.terminalAttachments[terminalId]?.attempt !== attempt
    )
      return;
    setForConnection(lease, {
      terminalAttachments: {
        ...snapshot.terminalAttachments,
        [terminalId]: {
          attempt,
          ready: true,
          advertisement: parseEndpointAdvertisement(advertisement),
        },
      },
      endpointAvailability: {
        ...snapshot.endpointAvailability,
        [terminalId]: parseEndpointAdvertisement(advertisement),
      },
    });
  },
  revokeTerminalAttachment(
    client: ConnectionClient,
    terminalId: string,
    attempt?: number,
  ) {
    const lease = {
      connectionId: client.connectionId,
      generation: client.serverRuntimeGeneration ?? client.generation,
      client,
    };
    const snapshot = leaseSnapshot(lease);
    if (
      !client.isCurrent() ||
      (attempt !== undefined &&
        snapshot.terminalAttachments[terminalId]?.attempt !== attempt)
    )
      return false;
    const attachments = { ...snapshot.terminalAttachments };
    delete attachments[terminalId];
    setForConnection(lease, {
      terminalAttachments: attachments,
      endpointAvailability: {
        ...snapshot.endpointAvailability,
        [terminalId]: null,
      },
    });
    return true;
  },
  setTerminalEndpoint(
    client: ConnectionClient,
    terminalId: string,
    advertisement: unknown,
  ) {
    if (!client.isCurrent()) return;
    const lease = {
      connectionId: client.connectionId,
      generation: client.serverRuntimeGeneration ?? client.generation,
      client,
    };
    setForConnection(lease, {
      endpointAvailability: {
        ...leaseSnapshot(lease).endpointAvailability,
        [terminalId]: parseEndpointAdvertisement(advertisement),
      },
    });
  },
  terminalScrollReason(terminalId: string, mouseReporting = false) {
    if (mouseReporting) return null; // Wheel input uses the negotiated semantic codec.
    return endpointMethodReason(
      state.navigationMode,
      state.endpointAvailability[terminalId],
      "pane.scroll",
    );
  },
  get: () => state,
  getConnection: (connectionId: string) =>
    connectionSnapshot(state, connectionId),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  init() {
    if (initialized) return;
    initialized = true;
    void store.restoreTaskNotifications();
    subscribeLocalStorage(handlePreferenceStorageChange);
    bridge.onHello((hello) => {
      const defaultConnectionId = hello.default_connection_id;
      set({ defaultConnectionId });
      if (
        state.activeConnectionId === STARTUP_DEFAULT_CONNECTION_ID &&
        defaultConnectionId !== state.activeConnectionId
      ) {
        selectConnectionNow(defaultConnectionId, false);
      }
      if (state.status === "connected" && !state.connectionPaused) {
        void refreshConnectionCatalog();
      }
    });
    bridge.onStatus((s) => {
      if (s !== "connected") {
        catalogReadyForConnection = false;
        set({ catalogueReady: false });
      }
      if (s === "disconnected") {
        for (const connection of state.connections) {
          disposeTerminalConnection(
            { connectionId: connection.id, generation: connection.generation },
            false,
          );
        }
        set(retireConnectionSessionObservations(state));
        catalogReadyForConnection = false;
        terminalReattachPending = true;
        bridge.setConnectionRuntimeGenerations([]);
        clearTerminalRelayViewports();

        queuedConnectionKeys.clear();
      }
      const completedRecovery =
        s === "connected" && !state.connectionPaused && state.notice?.loading
          ? connectionRecoveryIntent
          : null;
      if (s === "connected") connectionRecoveryIntent = null;
      const completedRecoveryMessage =
        completedRecovery === "reconnect"
          ? "Browser reconnected"
          : "Browser sync resumed";
      set(
        completedRecovery
          ? {
              status: s,
              connectionGeneration: state.connectionGeneration,
              notice: {
                kind: "success",
                message: completedRecoveryMessage,
                autoDismissMs: 5000,
              },
            }
          : {
              status: s,
              connectionGeneration:
                s === "disconnected"
                  ? bridge.clientGeneration
                  : state.connectionGeneration,
              bridgeStatus: s === "connected" ? state.bridgeStatus : null,
            },
      );
      if (s === "connected" && !state.connectionPaused) {
        // Polling may have been stopped by the hello-driven initial
        // connection switch; every settled connection must re-arm it.
        startPolling();
        void refreshConnectionCatalog().then((catalogReady) => {
          if (
            !catalogReady ||
            state.status !== "connected" ||
            state.connectionPaused
          ) {
            return;
          }
          rearmTerminalAttachmentsAfterCatalog(true);
          void refreshNow();
          void refreshBridgeStatus();
          // Popup state is pushed only on change, so ask once per
          // settled connection.
          void store.watchPopup();
        });
        if (state.pendingRestartVersion) {
          void reloadWhenUpdatedServerIsReady(state.pendingRestartVersion);
        }
      }
    });
    bridge.onEvent(handleHerdrEvent);
    bridge.onAssistantNotification(notifyRangerTask);
    bridge.onPopup(handlePopupPush);
    installStoreControls();
    // Catch up after a hidden/frozen page, keyboard focus or network recovery.
    const refreshOnReturn = () => {
      if (state.connectionPaused || state.status !== "connected") return;
      // Mobile OSes can silently kill the socket while the page is frozen;
      // probe now so reconnect and terminal re-attach start immediately
      // instead of waiting for the next heartbeat tick.
      bridge.probeConnectionNow();
      if (sharedAcquisitionEnabled()) refreshHeldOwners();
      else void refreshNow();
      void refreshBridgeStatus();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) refreshOnReturn();
      });
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", refreshOnReturn);
      window.addEventListener("online", refreshOnReturn);
    }
    // If the server requires a password and the session is missing/expired,
    // bounce to the login page instead of spinning on a failing socket.
    fetch("/api/health", {
      credentials: "same-origin",
      cache: "no-store",
    }).then((r) => {
      if (r.status === 401) {
        redirectToLogin();
        return;
      }
      if (state.pendingRestartVersion) {
        void reloadWhenUpdatedServerIsReady(state.pendingRestartVersion);
      }
      if (!state.connectionPaused) {
        bridge.connect();
        startPolling();
      }
    });
  },

  refresh: refreshNow,
  holdFocusedOwner,

  /** Refresh bridge-global profile/status metadata without changing selection. */
  refreshConnections: refreshConnectionCatalog,

  /** Programmatic switch seam for the M5 selector. */
  selectConnection(connectionId: string) {
    return selectConnectionNow(connectionId);
  },

  pauseConnection(
    detail = "This browser will stop syncing until you resume it.",
  ) {
    connectionRecoveryIntent = null;
    worldLocalStorage.setItem("connectionPaused", "true");
    stopPolling();
    disposeTerminalConnection(
      {
        connectionId: state.activeConnectionId,
        generation: state.connectionGeneration,
      },
      true,
    );
    bridge.disconnect();
    set({
      connectionPaused: true,
      catalogueReady: false,
      status: "disconnected",
      connectionGeneration: bridge.clientGeneration,
      bridgeStatus: null,
      terminalAttachEpoch: state.terminalAttachEpoch + 1,
      notice: {
        kind: "info",
        message: "Connection paused",
        detail,
      },
    });
  },

  pauseOtherClients() {
    return action(async (lease) => {
      const result = await bridge.call("bridge.pause_others");
      const pausedClients = Number(result?.paused_clients ?? 0);
      setForConnection(lease, {
        notice: {
          kind: pausedClients > 0 ? "success" : "info",
          message:
            pausedClients === 1
              ? "Paused 1 other browser"
              : `Paused ${pausedClients} other browsers`,
          autoDismissMs: 5000,
        },
      });
      void refreshBridgeStatus();
      return result;
    });
  },

  resumeConnection() {
    connectionRecoveryIntent = state.connectionPaused ? "resume" : "reconnect";
    worldLocalStorage.setItem("connectionPaused", "false");
    set({
      connectionPaused: false,
      error: null,
      notice: {
        kind: "info",
        message:
          connectionRecoveryIntent === "reconnect"
            ? "Reconnecting browser"
            : "Resuming browser sync",
        loading: true,
      },
    });
    bridge.connect();
    startPolling();
  },

  selectPane(paneId: string) {
    if (state.navigationMode === "browser-local")
      return store.focusPane(paneId);
    set({
      selectedPaneId: paneId,
      error: null,
    });
  },

  focusTab(tabId: string) {
    if (state.navigationMode === "browser-local") {
      const tab = state.tabs.find((tab) => tab.tab_id === tabId);
      return tab ? navigateBrowser(tab.workspace_id, tabId) : Promise.resolve();
    }
    const workspaceId = state.tabs.find(
      (t) => t.tab_id === tabId,
    )?.workspace_id;
    const targetPane =
      state.panes.find((pane) => pane.tab_id === tabId && pane.focused) ??
      state.panes.find((pane) => pane.tab_id === tabId);
    const pendingFocusSeq = workspaceId
      ? stampPendingFocusWorkspace(workspaceId)
      : undefined;
    return action(
      (lease) =>
        enqueueFocusAction(async () => {
          const relaySize = terminalRelayViewportForTab(
            lease.connectionId,
            lease.generation,
            tabId,
          );
          if (relaySize) {
            // Pre-size background runtimes for the target tab while the current
            // tab's direct attachments are still locked. The bridge confirms the
            // projected viewport through pane.layout before focus proceeds, so
            // the target is stable before it becomes visible.
            await lease.client
              .call("terminal.relay_resize", {
                cols: relaySize.cols,
                rows: relaySize.rows,
                ...(targetPane ? { pane_id: targetPane.pane_id } : {}),
              })
              .catch(() => null);
          }
          if (workspaceId) {
            await lease.client.call("workspace.focus", {
              workspace_id: workspaceId,
            });
          }
          return lease.client.call("tab.focus", { tab_id: tabId });
        }),
      {
        refresh: "immediate",
        pendingFocusWorkspaceSeq: pendingFocusSeq,
        retryOnReconnect: true,
      },
    );
  },

  createTab(workspaceId: string, options: { numberedLabel?: boolean } = {}) {
    const lease = captureConnectionLease();
    const owner = {
      connectionId: state.activeConnectionId,
      runtimeGeneration:
        state.connections.find(
          (connection) => connection.id === state.activeConnectionId,
        )?.generation ?? -1,
    };
    return store
      .createQualifiedTab(owner, workspaceId, options)
      .catch((error) => {
        setForConnection(lease, {
          notice: {
            kind: "error",
            message: creationFailureMessage(error, "Tab"),
            detail: String(error),
          },
        });
        return undefined;
      });
  },

  createQualifiedTab(
    target: QualifiedRuntimeTarget,
    workspaceId: string,
    options: { numberedLabel?: boolean; sourcePaneId?: string } = {},
  ) {
    const navigation = connectionSnapshot(
      state,
      target.connectionId,
    ).browserNavigation;
    return coordinateCreation(
      target,
      "tab",
      workspaceId,
      async (dispatching) => {
        assertQualifiedLeaseCurrent(target);
        const lease = captureConnectionLease(target.connectionId);
        assertQualifiedLeaseCurrent(target, lease);
        const prepared = await prepareQualifiedCreation(
          target,
          lease,
          "tab.create",
          workspaceId,
          options.sourcePaneId,
        );
        let result: unknown;
        try {
          assertCreationSourceCurrent(target, lease, prepared);
          dispatching();
          result = await lease.client.call("tab.create", {
            workspace_id: workspaceId,
            focus: !prepared.browserLocal,
            ...(prepared.browserLocal
              ? {
                  browser_source: prepared.source,
                }
              : {}),
          });
        } finally {
          prepared.release();
        }
        if (!qualifiedLeaseIsCurrent(target, lease)) return result;
        scheduleRefresh(lease);
        if (browserSelectionIsCurrent(navigation, lease))
          adoptBrowserTarget(lease, result);
        if (!options.numberedLabel) return result;

        const rename = numberedCreatedTabRename(result);
        if (!rename) return result;
        try {
          await lease.client.call("tab.rename", {
            tab_id: rename.tabId,
            label: rename.label,
          });
        } catch (error) {
          setForConnection(lease, {
            notice: {
              kind: "error",
              message: "Tab created, but naming failed",
              detail: String(error),
            },
          });
        }
        return result;
      },
    );
  },

  /** Returns false and explains why when a pin protects the tab. */
  guardTabClose(tabId: string) {
    const reason = tabCloseBlockReason(
      tabId,
      tabPinsFor(state.activeConnectionId),
    );
    if (!reason) return true;
    notifyPinnedTabClose(reason);
    return false;
  },

  /** Returns false and explains why when the pane is a pinned tab's last. */
  guardPaneClose(paneId: string) {
    const reason = paneCloseBlockReason(
      paneId,
      state.panes,
      tabPinsFor(state.activeConnectionId),
    );
    if (!reason) return true;
    notifyPinnedTabClose(reason);
    return false;
  },

  closeTab(tabId: string) {
    if (!store.guardTabClose(tabId)) return Promise.resolve();
    const paneIds = state.panes
      .filter((pane) => pane.tab_id === tabId)
      .map((pane) => pane.pane_id);
    return action(async (lease) => {
      const result = await lease.client.call("tab.close", { tab_id: tabId });
      clearTerminalComposerDrafts(
        lease.connectionId,
        lease.generation,
        paneIds,
      );
      return result;
    });
  },

  renameTab(tabId: string, label: string) {
    return action((lease) =>
      lease.client.call("tab.rename", { tab_id: tabId, label }),
    );
  },

  /** Move a tab within its workspace (Herdr tab.move insert-before index). */
  moveTab(tabId: string, insertIndex: number, client?: ConnectionClient) {
    return action(
      async (lease) => {
        if (!leaseIsCurrent(lease))
          throw new Error("Tab move owner is no longer available");
        const snapshot = leaseSnapshot(lease);
        // A host Spaces has not observed yet (Town reorders any host's desks)
        // has no recorded support: Herdr answers for itself.
        if (snapshot.lastRefresh > 0 && !snapshot.tabMoveSupported)
          throw new Error(
            "This Herdr connection does not support tab reordering.",
          );
        // Settle the strip in its new order before Herdr's list comes back.
        const previousTabs = snapshot.tabs;
        if (previousTabs.some((tab) => tab.tab_id === tabId))
          setForConnection(lease, {
            tabs: moveTabInList(previousTabs, tabId, insertIndex),
          });
        try {
          return await lease.client.call("tab.move", {
            tab_id: tabId,
            insert_index: insertIndex,
          });
        } catch (error) {
          if (leaseSnapshot(lease).tabs !== previousTabs)
            void refreshNow(lease);
          throw error;
        }
      },
      { refresh: "immediate", client },
    );
  },

  focusWorkspace(
    workspaceId: string,
    options: { retryOnReconnect?: boolean } = {},
  ) {
    if (state.navigationMode === "browser-local") {
      return state.workspaces.some(
        (workspace) => workspace.workspace_id === workspaceId,
      )
        ? navigateBrowser(workspaceId)
        : Promise.resolve();
    }
    const pendingFocusSeq = stampPendingFocusWorkspace(workspaceId);
    return action(
      (lease) =>
        enqueueFocusAction(() =>
          lease.client.call("workspace.focus", { workspace_id: workspaceId }),
        ),
      {
        refresh: "immediate",
        pendingFocusWorkspaceSeq: pendingFocusSeq,
        retryOnReconnect: options.retryOnReconnect ?? true,
      },
    );
  },

  focusWorkspaceSource: (target: WorkspaceSourceTarget) =>
    store.focusQualifiedTarget({ ...target, paneId: target.paneId ?? null }),
  loadConnectionSession: (connectionId: string) =>
    refreshNow(captureConnectionLease(connectionId), true),
  async focusQualifiedTarget(target: QualifiedFocusTarget): Promise<boolean> {
    if (!qualifiedRuntimeTargetIsCurrent(target)) return false;
    const lease = captureConnectionLease(target.connectionId);
    const navigationRevision = target.navigationRevision;
    let navigationDispatched = false;
    const current = () =>
      qualifiedLeaseIsCurrent(target, lease) &&
      (navigationRevision === undefined ||
        navigationDispatched ||
        leaseSnapshot(lease).navigationMode !== "browser-local" ||
        leaseSnapshot(lease).browserNavigation.revision === navigationRevision);
    if (
      current() &&
      !leaseSnapshot(lease).workspaces.some(
        (workspace) => workspace.workspace_id === target.workspaceId,
      )
    ) {
      await refreshNow(lease, true);
    }
    if (
      !current() ||
      !leaseSnapshot(lease).workspaces.some(
        (workspace) => workspace.workspace_id === target.workspaceId,
      )
    )
      return false;
    return enqueueFocusAction(async () => {
      if (!current()) return false;
      let pane: Pane | null = null;
      if (target.paneId) {
        const response = await lease.client.call("pane.get", {
          pane_id: target.paneId,
        });
        pane = response?.pane ?? null;
        if (
          !current() ||
          !notificationPaneMatches(target, pane) ||
          typeof pane.tab_id !== "string"
        )
          return false;
      }
      if (target.agentSessionId || target.agentSession) {
        const session = await lease.client.call("agent_session.get", {
          pane_id: target.paneId,
        });
        if (
          !current() ||
          (target.agentSessionId !== undefined &&
            (session?.session?.value ?? session?.agent_session?.value) !==
              target.agentSessionId) ||
          !matchesCapturedAgentSession(
            target.agentSession,
            session?.session ?? session?.agent_session,
          )
        )
          return false;
      }
      if (leaseSnapshot(lease).navigationMode === "browser-local") {
        navigationDispatched = true;
        void navigateBrowser(
          target.workspaceId,
          pane?.tab_id,
          pane?.pane_id,
          lease,
        );
      } else {
        await lease.client.call("workspace.focus", {
          workspace_id: target.workspaceId,
        });
        if (!current()) return false;
        if (pane) {
          await lease.client.call("tab.focus", { tab_id: pane.tab_id });
          if (!current()) return false;
          setForConnection(lease, { selectedPaneId: pane.pane_id });
        }
        void refreshNow(lease);
      }
      return (
        current() &&
        (!target.paneId ||
          leaseSnapshot(lease).selectedPaneId === target.paneId)
      );
    }, target.connectionId).catch((error) => {
      setForConnection(lease, {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
  },

  async focusTaskNotificationTarget(
    target: TaskNotificationTarget,
    options: NotificationFocusOptions = {},
  ) {
    return focusTaskNotification(target, options, {
      targetIsCurrent: () => taskNotificationTargetIsCurrent(state, target),
      captureLease: () => captureConnectionLease(target.connectionId),
      navigationRevision: (lease) =>
        leaseSnapshot(lease).browserNavigation.revision,
      isCurrent: leaseIsCurrent,
      focus: store.focusQualifiedTarget,
      activate: (id) => {
        selectConnectionNow(id, false);
        return state.activeConnectionId === id;
      },
      unavailable: () =>
        store.notify({
          kind: "error",
          message: "Notification target is unavailable",
          detail:
            "The owning runtime, workspace, pane or agent session changed.",
        }),
    });
  },

  async activateQualifiedSpacesTarget(target: QualifiedFocusTarget) {
    if (
      !(await store.focusQualifiedTarget(target)) ||
      !qualifiedRuntimeTargetIsCurrent(target)
    )
      return false;
    return selectConnectionNow(target.connectionId, false);
  },

  createWorkspace(label?: string, cwd?: string) {
    const lease = captureConnectionLease();
    const owner = {
      connectionId: state.activeConnectionId,
      runtimeGeneration:
        state.connections.find(
          (connection) => connection.id === state.activeConnectionId,
        )?.generation ?? -1,
    };
    return store.createQualifiedWorkspace(owner, label, cwd).catch((error) => {
      setForConnection(lease, {
        notice: {
          kind: "error",
          message: creationFailureMessage(error, "Workspace"),
          detail: String(error),
        },
      });
      return undefined;
    });
  },

  createQualifiedWorkspace(
    target: QualifiedRuntimeTarget,
    label?: string,
    cwd?: string,
    options: { sourceWorkspaceId?: string } = {},
  ) {
    const navigation = connectionSnapshot(
      state,
      target.connectionId,
    ).browserNavigation;
    return coordinateCreation(
      target,
      "workspace",
      JSON.stringify([options.sourceWorkspaceId, label, cwd]),
      async (dispatching) => {
        assertQualifiedLeaseCurrent(target);
        const lease = captureConnectionLease(target.connectionId);
        assertQualifiedLeaseCurrent(target, lease);
        const prepared = await prepareQualifiedCreation(
          target,
          lease,
          "workspace.create",
          options.sourceWorkspaceId,
        );
        let result: unknown;
        try {
          assertCreationSourceCurrent(target, lease, prepared);
          dispatching();
          result = await lease.client.call("workspace.create", {
            label,
            cwd,
            focus: !prepared.browserLocal,
            ...(prepared.browserLocal
              ? {
                  browser_source: prepared.source,
                }
              : {}),
          });
        } finally {
          prepared.release();
        }
        if (qualifiedLeaseIsCurrent(target, lease)) {
          scheduleRefresh(lease);
          if (browserSelectionIsCurrent(navigation, lease))
            adoptBrowserTarget(lease, result);
        }
        return result;
      },
    );
  },

  renameWorkspace(workspaceId: string, label: string) {
    return action((lease) =>
      lease.client.call("workspace.rename", {
        workspace_id: workspaceId,
        label,
      }),
    );
  },

  renameQualifiedWorkspace(
    target: QualifiedRuntimeTarget,
    workspaceId: string,
    label: string,
  ) {
    return qualifiedAction(target, (lease) =>
      lease.client.call("workspace.rename", {
        workspace_id: workspaceId,
        label,
      }),
    );
  },

  closeWorkspace(workspaceId: string) {
    return action(
      (lease) =>
        lease.client.call("workspace.close", { workspace_id: workspaceId }),
      {
        failureNotice: (error) => ({
          kind: "error",
          message: error.message.startsWith("workspace_group_close_required:")
            ? "Workspace belongs to a group"
            : "Workspace close failed",
          detail: error.message.startsWith("workspace_group_close_required:")
            ? "Nothing was closed. To close this workspace and its linked workspaces, explicitly close the group in the Herdr CLI with --group."
            : error.message,
        }),
      },
    );
  },

  closeQualifiedWorkspace(target: QualifiedRuntimeTarget, workspaceId: string) {
    return qualifiedAction(target, (lease) =>
      lease.client.call("workspace.close", { workspace_id: workspaceId }),
    );
  },

  moveWorkspace(workspaceId: string, insertIndex: number) {
    return action(
      (lease) =>
        lease.client.call("workspace.move", {
          workspace_id: workspaceId,
          insert_index: insertIndex,
        }),
      { refresh: "immediate" },
    );
  },

  gitPullWorkspace(workspaceId: string, client?: ConnectionClient) {
    return action(
      async (lease) => {
        setForConnection(lease, {
          notice: {
            kind: "info",
            message: "Running git pull",
            detail: "git pull --ff-only",
            detailMode: "output",
            detailTitle: "Command",
            loading: true,
          },
        });
        const result = await lease.client.call("git.pull", {
          workspace_id: workspaceId,
        });
        const output = [result?.stdout, result?.stderr]
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          )
          .join("\n")
          .trim();
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: "Git pull completed",
            detail: output ? output.slice(0, 1400) : "Already up to date.",
            detailMode: output ? "output" : "text",
            detailTitle: output ? "git pull --ff-only" : undefined,
          },
        });
        return result;
      },
      {
        refresh: "immediate",
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: "Git pull failed",
          detail: error.message,
          detailMode: "output",
          detailTitle: "git pull --ff-only",
        }),
      },
    );
  },

  runGitFileAction(
    workspaceId: string,
    gitAction: GitFileAction,
    entry: Pick<GitDiffEntry, "path" | "old_path" | "mtime_ms" | "size">,
    client?: ConnectionClient,
  ) {
    const label = gitFileActionLabel(gitAction);
    return action(
      async (lease) => {
        const result = await lease.client.call("git.file_action", {
          workspace_id: workspaceId,
          action: gitAction,
          path: entry.path,
          old_path: entry.old_path,
          mtime_ms: entry.mtime_ms,
          size: entry.size,
        });
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: gitFileActionSuccessMessage(gitAction),
            detail: entry.path,
            autoDismissMs: 5000,
          },
        });
        return result;
      },
      {
        refresh: "immediate",
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: `${label} failed`,
          detail: error.message,
          detailMode: "text",
        }),
      },
    );
  },

  runGitFileActionBatch(
    workspaceId: string,
    gitAction: GitFileAction,
    entries: Pick<GitDiffEntry, "path" | "old_path" | "mtime_ms" | "size">[],
    client?: ConnectionClient,
  ) {
    const label = gitFileActionLabel(gitAction);
    let completed = 0;
    return action(
      async (lease) => {
        try {
          for (const entry of entries) {
            await lease.client.call("git.file_action", {
              workspace_id: workspaceId,
              action: gitAction,
              path: entry.path,
              old_path: entry.old_path,
              mtime_ms: entry.mtime_ms,
              size: entry.size,
            });
            completed += 1;
          }
        } catch (error) {
          if (completed && leaseIsCurrent(lease)) void refreshNow(lease);
          throw error;
        }
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: `${gitFileActionSuccessMessage(gitAction)} (${completed} ${completed === 1 ? "file" : "files"})`,
            autoDismissMs: 5000,
          },
        });
        return completed;
      },
      {
        refresh: "immediate",
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: `${label} failed`,
          detail: `${completed} of ${entries.length} files completed. ${error.message}`,
          detailMode: "text",
        }),
      },
    );
  },

  runGitRepoAction(
    workspaceId: string,
    gitAction: GitRepoAction,
    expectedCounts?: Partial<GitWorkingCounts>,
    client?: ConnectionClient,
  ) {
    return action(
      async (lease) => {
        const result = await lease.client.call("git.repo_action", {
          workspace_id: workspaceId,
          action: gitAction,
          expected_counts: expectedCounts,
        });
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: gitRepoActionSuccessMessage(gitAction),
            autoDismissMs: 5000,
          },
        });
        return result;
      },
      {
        refresh: "immediate",
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: "Git action failed",
          detail: error.message,
          detailMode: "text",
        }),
      },
    );
  },

  createWorktree(
    workspaceId: string,
    branch: string,
    client?: ConnectionClient,
  ) {
    const navigation = connectionSnapshot(
      state,
      client?.connectionId ?? state.activeConnectionId,
    ).browserNavigation;
    return action(
      async (lease) => {
        setForConnection(lease, {
          notice: {
            kind: "info",
            message: "Creating worktree",
            detail: `Updating origin's default branch before creating ${branch}.`,
            loading: true,
          },
        });
        const result = await lease.client.call("worktree.create", {
          workspace_id: workspaceId,
          branch,
          focus: leaseSnapshot(lease).navigationMode !== "browser-local",
        });
        if (browserSelectionIsCurrent(navigation, lease))
          adoptBrowserTarget(lease, result);
        const setupHook = result?.setup_hook as
          | WorktreeHookRunResult
          | undefined;
        const setupNotice = setupHook
          ? summarizeDirectHookResult(setupHook)
          : null;
        if (setupNotice) {
          setForConnection(lease, { notice: setupNotice });
        } else {
          const commit = String(result?.base_sync?.commit ?? "").slice(0, 12);
          const base = String(
            result?.base_sync?.base ?? "origin's default branch",
          );
          setForConnection(lease, {
            notice: {
              kind: "success",
              message: "Worktree created",
              detail: commit
                ? `${branch} starts from ${base} at ${commit}.`
                : `${branch} starts from the latest ${base}.`,
              autoDismissMs: 5000,
            },
          });
        }
        return result;
      },
      {
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: "Failed to create worktree",
          detail: error.message,
        }),
      },
    );
  },

  openWorktree(
    workspaceId: string,
    target: string,
    focus = true,
    client?: ConnectionClient,
  ) {
    const navigation = connectionSnapshot(
      state,
      client?.connectionId ?? state.activeConnectionId,
    ).browserNavigation;
    const trimmed = target.trim();
    const locator = trimmed.startsWith("/")
      ? { path: trimmed }
      : { branch: trimmed };
    return action(
      async (lease) => {
        const result = await lease.client.call("worktree.open", {
          workspace_id: workspaceId,
          ...locator,
          focus:
            focus && leaseSnapshot(lease).navigationMode !== "browser-local",
        });
        if (focus && browserSelectionIsCurrent(navigation, lease))
          adoptBrowserTarget(lease, result);
        const openedHook = result?.opened_hook as
          | WorktreeHookRunResult
          | undefined;
        const openedNotice = openedHook
          ? summarizeDirectHookResult(openedHook)
          : null;
        if (openedNotice) setForConnection(lease, { notice: openedNotice });
        return result;
      },
      { client },
    );
  },

  // A linked checkout can remain open after its main workspace is closed.
  // Herdr accepts the repository root as the source in that state, allowing
  // the GUI to reopen main without inventing or guessing a workspace ID.
  openWorktreeFromCwd(
    cwd: string,
    target: string,
    focus = true,
    client?: ConnectionClient,
  ) {
    const navigation = connectionSnapshot(
      state,
      client?.connectionId ?? state.activeConnectionId,
    ).browserNavigation;
    const trimmed = target.trim();
    const locator = trimmed.startsWith("/")
      ? { path: trimmed }
      : { branch: trimmed };
    return action(
      async (lease) => {
        const result = await lease.client.call("worktree.open", {
          cwd,
          ...locator,
          focus:
            focus && leaseSnapshot(lease).navigationMode !== "browser-local",
        });
        if (focus && browserSelectionIsCurrent(navigation, lease))
          adoptBrowserTarget(lease, result);
        const openedHook = result?.opened_hook as
          | WorktreeHookRunResult
          | undefined;
        const openedNotice = openedHook
          ? summarizeDirectHookResult(openedHook)
          : null;
        if (openedNotice) setForConnection(lease, { notice: openedNotice });
        return result;
      },
      { client },
    );
  },

  removeWorktree(
    workspaceId: string,
    force = false,
    workspaceHint?: Workspace,
    client?: ConnectionClient,
  ) {
    return action(
      async (lease) => {
        const removedWorkspace =
          leaseSnapshot(lease).workspaces.find(
            (workspace) => workspace.workspace_id === workspaceId,
          ) ?? workspaceHint;
        setForConnection(lease, {
          notice: {
            kind: "info",
            message: "Removing worktree",
            detail: "Running teardown hook if configured.",
            loading: true,
          },
        });
        const result = await lease.client.call(
          "worktree.remove",
          {
            workspace_id: workspaceId,
            force,
          },
          // Hooks are part of this RPC and can legitimately run longer than
          // Herdr's own bounded remove call. Let disconnects end the browser
          // wait instead of reporting a timeout while deletion continues.
          null,
        );
        const beforeRemoveHook = result?.before_remove_hook as
          | WorktreeHookRunResult
          | undefined;
        const beforeRemoveNotice = beforeRemoveHook
          ? summarizeDirectHookResult(beforeRemoveHook)
          : null;
        if (beforeRemoveNotice) {
          setForConnection(lease, { notice: beforeRemoveNotice });
        }
        if (result?.skipped_remove) {
          if (!beforeRemoveNotice) setForConnection(lease, { notice: null });
          return result;
        }

        await refreshNow(lease);
        setForConnection(lease, {
          terminalAttachEpoch: leaseSnapshot(lease).terminalAttachEpoch + 1,
        });
        if (removedWorkspace && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent<WorktreeRemovedTarget>(WORKTREE_REMOVED_EVENT, {
              detail: {
                connectionId: lease.connectionId,
                generation: lease.generation,
                workspace: removedWorkspace,
              },
            }),
          );
        }
        const removedHook = result?.removed_hook as
          | WorktreeHookRunResult
          | undefined;
        const removedNotice = removedHook
          ? summarizeDirectHookResult(removedHook)
          : null;
        const cleanup = result?.cleanup as WorktreeRemovalCleanup | undefined;
        const completionNotice = worktreeRemovalCompletionNotice(
          cleanup,
          removedNotice,
        );
        if (completionNotice) {
          setForConnection(lease, { notice: completionNotice });
        } else if (!beforeRemoveNotice) {
          setForConnection(lease, {
            notice: {
              kind: "success",
              message: "Worktree removed",
            },
          });
        }
        return result;
      },
      {
        client,
        failureNotice: (error) => ({
          kind: "error",
          message: "Failed to remove worktree",
          detail: error.message,
        }),
      },
    );
  },

  setRepoWorktreeHooksEnabled(key: string, enabled: boolean) {
    return action(async (lease) => {
      const result = await lease.client.call("settings.update_repo", {
        key,
        settings: { worktree_hooks_enabled: enabled },
      });
      await refreshNow(lease);
      return result;
    });
  },

  setWorkspaceAutoSyncEnabled(workspaceId: string, enabled: boolean) {
    return action(
      async (lease) => {
        const result = await lease.client.call(
          "settings.workspace_auto_sync.update",
          {
            workspace_id: workspaceId,
            enabled,
          },
        );
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: enabled
              ? "Automatic branch updates enabled"
              : "Automatic branch updates disabled",
            detail: enabled
              ? "A sync will run now, then every 10 minutes while this workspace remains open."
              : undefined,
            autoDismissMs: 5000,
          },
        });
        return result;
      },
      {
        refresh: "none",
        failureNotice: (error) => ({
          kind: "error",
          message: "Failed to update automatic sync settings",
          detail: error.message,
        }),
      },
    );
  },

  setWorkspaceAutoSyncConfigEnabled(key: string, enabled: boolean) {
    return action(
      async (lease) => {
        const result = await lease.client.call(
          "settings.workspace_auto_sync.update_key",
          { key, enabled },
        );
        setForConnection(lease, {
          notice: {
            kind: "success",
            message: enabled
              ? "Automatic branch updates enabled"
              : "Automatic branch updates disabled",
            detail: key,
            autoDismissMs: 5000,
          },
        });
        return result;
      },
      {
        refresh: "none",
        failureNotice: (error) => ({
          kind: "error",
          message: "Failed to update automatic sync settings",
          detail: error.message,
        }),
      },
    );
  },

  clearNotice() {
    set({ notice: null });
  },

  notify(notice: Notice) {
    set({ notice });
  },

  async restoreTaskNotifications() {
    const version = ++taskNotificationPreferenceVersion;
    set({ taskNotificationBusy: true });
    try {
      if (state.taskNotificationsEnabled) await prepareTaskNotifications();
      const transport = await syncTaskPush(
        state.taskNotificationsEnabled,
        state.taskNotificationPreferences,
      );
      if (version !== taskNotificationPreferenceVersion) return;
      worldLocalStorage.setItem("taskNotificationTransport", transport);
      set({ taskNotificationTransport: transport });
    } catch (error) {
      if (version === taskNotificationPreferenceVersion)
        set({
          notice: {
            kind: "error",
            message: "Background notification sync failed",
            detail: (error as Error).message,
          },
        });
    } finally {
      if (version === taskNotificationPreferenceVersion)
        set({ taskNotificationBusy: false });
    }
  },

  async setTaskNotificationPreference(
    kind: keyof TaskNotificationPreferences,
    enabled: boolean,
  ) {
    const version = ++taskNotificationPreferenceVersion;
    const preferences = {
      ...state.taskNotificationPreferences,
      [kind]: enabled,
    };
    set({ taskNotificationBusy: true });
    try {
      const transport = await syncTaskPush(
        state.taskNotificationsEnabled,
        preferences,
      );
      if (version !== taskNotificationPreferenceVersion) return;
      worldLocalStorage.setItem("taskNotificationTransport", transport);
      worldLocalStorage.setItem(
        TASK_NOTIFICATION_PREFERENCES_KEY,
        JSON.stringify(preferences),
      );
      set({
        taskNotificationPreferences: preferences,
        taskNotificationTransport: transport,
      });
    } catch (error) {
      if (version === taskNotificationPreferenceVersion)
        set({
          notice: {
            kind: "error",
            message: "Notification preference was not saved",
            detail: (error as Error).message,
          },
        });
    } finally {
      if (version === taskNotificationPreferenceVersion)
        set({ taskNotificationBusy: false });
    }
  },

  async setTaskNotificationsEnabled(enabled: boolean) {
    const version = ++taskNotificationPreferenceVersion;
    set({ taskNotificationBusy: true });
    if (!enabled) {
      try {
        await syncTaskPush(false, state.taskNotificationPreferences);
      } catch (error) {
        if (version === taskNotificationPreferenceVersion)
          set({
            taskNotificationBusy: false,
            notice: {
              kind: "error",
              message: "Notification revocation failed",
              detail: (error as Error).message,
            },
          });
        return;
      }
      worldLocalStorage.setItem(TASK_NOTIFICATIONS_KEY, "false");
      set({
        taskNotificationsEnabled: false,
        taskNotificationBusy: false,
        taskNotificationTransport: "local",
        taskNotificationPermission: notificationPermission(),
        notice: {
          kind: "info",
          message: "Task notifications disabled",
          autoDismissMs: 5000,
        },
      });
      return;
    }

    if (notificationPermission() === "unsupported") {
      worldLocalStorage.setItem(TASK_NOTIFICATIONS_KEY, "false");
      set({
        taskNotificationsEnabled: false,
        taskNotificationBusy: false,
        taskNotificationPermission: "unsupported",
        notice: {
          kind: "error",
          message: "Browser notifications are not supported",
          detail:
            "This browser or deployment context does not expose the Notification API.",
        },
      });
      return;
    }

    let permission = Notification.permission;
    try {
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
    } catch (e) {
      worldLocalStorage.setItem(TASK_NOTIFICATIONS_KEY, "false");
      set({
        taskNotificationsEnabled: false,
        taskNotificationBusy: false,
        taskNotificationPermission: notificationPermission(),
        notice: {
          kind: "error",
          message: "Notification permission failed",
          detail: (e as Error).message,
        },
      });
      return;
    }

    const granted = permission === "granted";
    let transport: "local" | "push" = "local";
    if (granted) {
      try {
        await prepareTaskNotifications();
        if (version !== taskNotificationPreferenceVersion) return;
        transport = await syncTaskPush(
          true,
          state.taskNotificationPreferences,
          true,
        );
      } catch (error) {
        reportTaskNotificationFailure(error, version);
        return;
      }
    }
    worldLocalStorage.setItem(
      TASK_NOTIFICATIONS_KEY,
      granted ? "true" : "false",
    );
    set({
      taskNotificationsEnabled: granted,
      taskNotificationTransport: transport,
      taskNotificationBusy: false,
      taskNotificationPermission: permission,
      notice: granted
        ? {
            kind: "success",
            message: "Task notifications enabled",
            detail: "Herdr World will notify you when an agent task completes.",
            autoDismissMs: 5000,
          }
        : {
            kind: "error",
            message: "Notification permission was not granted",
            detail:
              "Enable notifications for this site in the browser settings, then try again.",
          },
    });
  },

  checkForUpdate() {
    return checkForUpdate(true);
  },

  setAutomaticUpdateChecksEnabled(enabled: boolean) {
    try {
      worldLocalStorage.setItem(AUTOMATIC_UPDATE_CHECKS_KEY, String(enabled));
    } catch {
      // The in-memory preference still applies when storage is unavailable.
    }
    applyAutomaticUpdateChecksEnabled(enabled);
  },

  updateOrCheck() {
    if (
      state.updateInfo?.update_available &&
      state.updateInfo.can_auto_update
    ) {
      return this.installUpdate();
    }
    return checkForUpdate(true);
  },

  dismissUpdate,

  /**
   * Bring Herdr, the harness integrations and the Herdr World plugin up to
   * this release. After a World update this runs on its own (automatic), even
   * when Herdr itself is current, because the integrations and the plugin
   * follow the World release; it stays quiet when nothing changed.
   */
  async upgradeHerdr({ automatic = false }: { automatic?: boolean } = {}) {
    if (state.herdrUpgrading) return;
    set({
      herdrUpgrading: true,
      notice: {
        kind: "info",
        message: automatic
          ? "Updating Herdr for this release"
          : "Upgrading Herdr",
        detail:
          "Bringing Herdr, its harness integrations and the Herdr World plugin up to this release.",
        loading: true,
      },
    });
    try {
      const response = await fetch("/api/herdr/upgrade", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-herdr-world-herdr-upgrade": "1" },
      });
      const started = await response.json().catch(() => null);
      if (!response.ok) throw new Error(started?.error ?? response.statusText);
      const deadline = Date.now() + HERDR_UPGRADE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await wait(herdrUpgradePollMs);
        const job = await fetch("/api/herdr/upgrade", {
          credentials: "same-origin",
          cache: "no-store",
        })
          .then((reply) => (reply.ok ? reply.json() : null))
          .catch(() => null);
        if (!job || job.status === "running") continue;
        if (job.status === "failed") throw new Error(job.error);
        if (job.status !== "done") {
          throw new Error("Herdr World restarted before the upgrade finished.");
        }
        const failed: string[] = Array.isArray(job.failed) ? job.failed : [];
        if (automatic && !job.changed && !failed.length) {
          set({ herdrUpgrading: false, notice: null });
          return;
        }
        const restart = job.report?.server?.outcome === "restart-required";
        set({
          herdrUpgrading: false,
          notice: {
            kind: failed.length ? "error" : restart ? "info" : "success",
            message: failed.length
              ? "Herdr upgrade incomplete"
              : restart
                ? "Herdr upgraded; restart needed"
                : "Herdr is up to date",
            detail: (job.lines as string[]).join("\n"),
            detailMode: "output",
            detailTitle: "Herdr upgrade",
          },
        });
        return;
      }
      throw new Error("The Herdr upgrade did not report a result in time.");
    } catch (e) {
      set({
        herdrUpgrading: false,
        notice: {
          kind: "error",
          message: "Herdr upgrade failed",
          detail: (e as Error).message,
        },
      });
    }
  },

  async installUpdate() {
    if (state.connectionPaused) {
      set({
        notice: {
          kind: "info",
          message: "Connection is paused",
          detail: "Resume the connection before installing updates.",
        },
      });
      return;
    }
    const latestVersion = state.updateInfo?.latest_version;
    if (!latestVersion || state.updateInstalling) return;
    retireUpdateChecks();
    set({ updateInstalling: true });
    try {
      const r = await fetch("/api/update/install", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-herdr-world-update": "1" },
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        throw new Error(body?.error ?? r.statusText);
      }
      if (body?.installed) {
        const installedVersion = body.installed_version ?? latestVersion;
        if (body.restart_scheduled) {
          storePendingRestartVersion(installedVersion);
          set({
            updateInfo: null,
            updateInstalling: false,
            pendingRestartVersion: installedVersion,
            dismissedUpdateVersion: latestVersion,
            notice: {
              kind: "info",
              message: "Restarting the Herdr World process",
              detail:
                "The binary was updated. Waiting for the external process supervisor to start the new version.",
              loading: true,
            },
          });
          void reloadWhenUpdatedServerIsReady(installedVersion);
          return;
        }
        set({
          updateInfo: null,
          updateInstalling: false,
          dismissedUpdateVersion: latestVersion,
          notice: {
            kind: "success",
            message: `Herdr World ${installedVersion} installed`,
            detail: "Restart the Herdr World process to use the new version.",
          },
        });
        return;
      }
      set({
        updateInfo: null,
        updateInstalling: false,
        dismissedUpdateVersion: latestVersion,
        notice: {
          kind: "success",
          message: "Herdr World is already up to date",
        },
      });
    } catch (e) {
      set({
        updateInstalling: false,
        notice: {
          kind: "error",
          message: "Update install failed",
          detail: (e as Error).message,
        },
      });
    }
  },

  sendText(paneId: string, text: string) {
    return action((lease) =>
      lease.client.call("pane.send_text", { pane_id: paneId, text }),
    );
  },

  sendKeys(paneId: string, keys: string) {
    // Herdr expects `keys` to be a sequence of key-combo strings.
    return action((lease) =>
      lease.client.call("pane.send_keys", { pane_id: paneId, keys: [keys] }),
    );
  },

  focusPane(paneId: string) {
    const pane = state.panes.find((p) => p.pane_id === paneId);
    if (state.navigationMode === "browser-local") {
      return pane
        ? navigateBrowser(pane.workspace_id, pane.tab_id, paneId)
        : Promise.resolve();
    }
    const pendingFocusSeq = pane?.workspace_id
      ? stampPendingFocusWorkspace(pane.workspace_id)
      : undefined;
    return action(
      (lease) =>
        enqueueFocusAction(async () => {
          if (pane?.workspace_id) {
            await lease.client.call("workspace.focus", {
              workspace_id: pane.workspace_id,
            });
          }
          if (pane)
            await lease.client.call("tab.focus", { tab_id: pane.tab_id });
          setForConnection(lease, { selectedPaneId: paneId });
          return pane;
        }),
      { refresh: "immediate", pendingFocusWorkspaceSeq: pendingFocusSeq },
    );
  },

  splitPane(paneId: string, direction: "right" | "down") {
    const navigation = state.browserNavigation;
    return action(async (lease) => {
      const result = await lease.client.call("pane.split", {
        target_pane_id: paneId,
        direction,
        focus: state.navigationMode !== "browser-local",
      });
      const selectionIsCurrent = browserSelectionIsCurrent(navigation);
      if (selectionIsCurrent) adoptBrowserTarget(lease, result);
      const nextPaneId =
        typeof result?.pane?.pane_id === "string" ? result.pane.pane_id : null;
      if (nextPaneId && selectionIsCurrent)
        setForConnection(lease, { selectedPaneId: nextPaneId });
      return result;
    });
  },

  zoomPane(paneId: string) {
    return action((lease) =>
      lease.client.call("pane.zoom", { pane_id: paneId }),
    );
  },

  resizePane(
    paneId: string,
    direction: "left" | "right" | "up" | "down",
    amount: number,
  ) {
    return action(async (lease) => {
      const result = await lease.client.call("pane.resize", {
        pane_id: paneId,
        direction,
        amount,
      });
      const layout = result?.resize?.layout;
      if (layout && state.layout?.tab_id === layout.tab_id)
        setForConnection(lease, {
          layout:
            state.navigationMode === "browser-local"
              ? projectBrowserLayout(layout, state.selectedPaneId)
              : layout,
        });
      return result;
    });
  },

  /** Swap a pane with its neighbor in the given direction (Herdr pane.swap). */
  movePane(paneId: string, direction: "left" | "right" | "up" | "down") {
    return swapPanePositions({ pane_id: paneId, direction });
  },

  /** Swap two existing panes within the same tab. */
  swapPanes(sourcePaneId: string, targetPaneId: string) {
    const source = state.panes.find((pane) => pane.pane_id === sourcePaneId);
    const target = state.panes.find((pane) => pane.pane_id === targetPaneId);
    if (
      !source ||
      !target ||
      sourcePaneId === targetPaneId ||
      source.tab_id !== target.tab_id ||
      source.workspace_id !== target.workspace_id
    )
      return Promise.resolve();
    return swapPanePositions({
      source_pane_id: sourcePaneId,
      target_pane_id: targetPaneId,
    });
  },

  /** Break a pane out into a new tab of its workspace (Herdr pane.move). */
  movePaneToNewTab(paneId: string, client?: ConnectionClient) {
    const snapshot = client
      ? connectionSnapshot(state, client.connectionId)
      : state;
    const pane = snapshot.panes.find((pane) => pane.pane_id === paneId);
    const siblings = snapshot.panes.filter(
      (other) => other.tab_id === pane?.tab_id,
    );
    if (!pane || siblings.length < 2) return Promise.resolve();
    return movePaneTo(
      paneId,
      {
        type: "new_tab",
        workspace_id: pane.workspace_id,
      },
      undefined,
      client,
    );
  },

  /**
   * Move a pane beside the pane its destination tab would show: this browser's
   * remembered pane in browser-local mode, otherwise Herdr's focused pane.
   */
  movePaneToTab(paneId: string, tabId: string, client?: ConnectionClient) {
    const snapshot = client
      ? connectionSnapshot(state, client.connectionId)
      : state;
    const panes = snapshot.panes.filter((pane) => pane.tab_id === tabId);
    const remembered =
      snapshot.navigationMode === "browser-local"
        ? snapshot.browserNavigation.paneIds[tabId]
        : undefined;
    const anchor =
      panes.find((pane) => pane.pane_id === remembered) ??
      panes.find((pane) => pane.focused) ??
      panes[0];
    return anchor
      ? store.movePaneBeside(paneId, anchor.pane_id, "right", client)
      : Promise.resolve();
  },

  /**
   * Place a pane on one side of a pane in another tab of the same workspace.
   * Herdr only splits to the right or below, so left and up swap afterwards.
   */
  movePaneBeside(
    sourcePaneId: string,
    targetPaneId: string,
    side: PaneSide,
    client?: ConnectionClient,
  ) {
    const snapshot = client
      ? connectionSnapshot(state, client.connectionId)
      : state;
    const source = snapshot.panes.find((pane) => pane.pane_id === sourcePaneId);
    const target = snapshot.panes.find((pane) => pane.pane_id === targetPaneId);
    if (
      !source ||
      !target ||
      source.tab_id === target.tab_id ||
      source.workspace_id !== target.workspace_id ||
      !!paneCloseBlockReason(
        sourcePaneId,
        snapshot.panes,
        tabPinsFor(snapshot.activeConnectionId),
      )
    )
      return Promise.resolve();
    return movePaneTo(
      sourcePaneId,
      {
        type: "tab",
        tab_id: target.tab_id,
        split: side === "left" || side === "right" ? "right" : "down",
        target_pane_id: targetPaneId,
      },
      side === "left" || side === "up" ? targetPaneId : undefined,
      client,
    );
  },

  focusPaneDirection(
    paneId: string,
    direction: "left" | "right" | "up" | "down",
  ) {
    if (state.navigationMode === "browser-local") {
      const target = browserPaneInDirection(state.layout, paneId, direction);
      return target ? store.focusPane(target) : Promise.resolve();
    }
    return action(async (lease) => {
      const result = await lease.client.call("pane.focus_direction", {
        pane_id: paneId,
        direction,
      });
      const focus = result?.focus ?? result?.focus_direction ?? result;
      const focusedPaneId =
        typeof focus?.focused_pane_id === "string"
          ? focus.focused_pane_id
          : null;
      if (focusedPaneId) {
        setForConnection(lease, { selectedPaneId: focusedPaneId });
      }
      if (focus?.layout) {
        setForConnection(lease, { layout: focus.layout as PaneLayout });
      }
      await refreshNow(lease);
      return result;
    });
  },

  /**
   * Ask the bridge which popup Herdr currently has open. Pushes only fire on
   * change, so a browser that just connected, or just switched connection, has
   * to ask once.
   */
  watchPopup() {
    return action(async (lease) => {
      const result = (await lease.client.call("terminal.watch_popup", {})) as
        | { popup: PopupInfo | null }
        | undefined;
      setForConnection(lease, { popup: result?.popup ?? null });
    });
  },

  /** Close the open popup, if any (Herdr's generic popup.close method). */
  closePopup() {
    return action((lease) => lease.client.call("popup.close", {}));
  },

  /**
   * Hide the popup if one is open, otherwise invoke the plugin action that
   * opens it.
   *
   * Asks Herdr rather than trusting this client's popup state, which can lag
   * behind: opening on a stale "none" is refused with "a popup pane is already
   * open", and that refusal only ever reaches the plugin's command log, so the
   * key would look dead. "popup_not_open" is the definitive answer that
   * nothing was open and the action should run.
   */
  togglePluginPopup(
    pluginId: string,
    actionId: string,
    context: Record<string, unknown> = {},
  ) {
    return action(async (lease) => {
      try {
        await lease.client.call("popup.close", {});
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("popup_not_open")) throw error;
      }
      if (!leaseIsCurrent(lease)) return;
      // Herdr opens a popup in whichever Space it has focused, and a plugin
      // handed a different one declines: herdr-float reports "Space changed"
      // and exits successfully, so the key looks dead. Match Herdr's focus to
      // the Space the action is invoked for.
      const workspaceId = context.workspace_id;
      if (typeof workspaceId === "string" && workspaceId) {
        const focused = store.get().workspaces.find((w) => w.focused);
        if (focused?.workspace_id !== workspaceId) {
          await lease.client.call("workspace.focus", {
            workspace_id: workspaceId,
          });
          if (!leaseIsCurrent(lease)) return;
        }
      }
      await lease.client.call("plugin.action.invoke", {
        plugin_id: pluginId,
        action_id: actionId,
        context,
      });
    });
  },

  closePane(paneId: string) {
    if (!store.guardPaneClose(paneId)) return Promise.resolve();
    return action(async (lease) => {
      const result = await lease.client.call("pane.close", { pane_id: paneId });
      clearTerminalComposerDrafts(lease.connectionId, lease.generation, [
        paneId,
      ]);
      return result;
    });
  },
};

/** Test-only singleton seam for deterministic deferred production-store tests. */
export const __storeTesting = {
  setHerdrUpgradePollMs(ms: number) {
    herdrUpgradePollMs = ms;
  },
  notifyRangerTask,
  handleBridgeStatus,
  handleHerdrEvent,
  startUpdatePolling,
  handlePreferenceStorageChange,
  updatePollingActive: () => updateTimer !== null,
  refreshBridgeStatus,
  markTerminalReattachPending() {
    terminalReattachPending = true;
    catalogReadyForConnection = false;
    set({ catalogueReady: false });
    bridge.setConnectionRuntimeGenerations([]);
  },
  rearmTerminalAttachmentsAfterCatalog,
  replaceState(snapshot: State) {
    stopPolling();
    refreshingConnectionKeys.clear();
    queuedConnectionKeys.clear();

    taskCompletionTracker.clear();
    resetChimeBursts();
    state = {
      ...snapshot,
      catalogueReady:
        snapshot.status === "connected" &&
        !snapshot.connectionPaused &&
        (snapshot.catalogueReady ?? false),
    };
    terminalReattachPending = false;
    connectionRecoveryIntent = null;
    catalogReadyForConnection = snapshot.connections.length > 0;
    bridge.setConnectionRuntimeGenerations(snapshot.connections);
    emit();
  },
  applyCatalog(connections: ConnectionSummary[], defaultConnectionId: string) {
    const requestSeq = ++catalogRequestSeq;
    applyConnectionCatalog(
      { connections, default_connection_id: defaultConnectionId },
      requestSeq,
    );
  },
};
export {
  state,
  set,
  captureConnectionLease,
  leaseIsCurrent,
  leaseSnapshot,
  setForConnection,
  wait,
  catalogReadyForConnection,
  taskNotificationPreferenceVersion,
  reportTaskNotificationFailure,
  refreshBridgeStatus,
  action,
};

export {
  type ServerSessionState,
  type PopupInfo,
  type WorkspaceSourceTarget,
  type State,
  type Notice,
  type UpdateInfo,
  type BridgeStatus,
  type StoreConnectionLease,
  type WorktreeRemovedTarget,
  type TaskNotificationTarget,
  type QualifiedFocusTarget,
  type QualifiedRuntimeTarget,
} from "./store/types";

export {
  DEFAULT_NOTICE_AUTO_DISMISS_MS,
  TASK_NOTIFICATION_ACTIVATE_EVENT,
  noticeAutoDismissDelay,
  isTaskNotificationTarget,
  bindTaskNotificationActivation,
  TaskCompletionTracker,
  taskNotificationTarget,
  taskNotificationTargetIsCurrent,
  taskNotificationTag,
  taskNotificationTargetFromNotice,
  herdrTaskNotificationsActive,
} from "./store/notifications";

export {
  emptyServerSessionState,
  activateConnectionState,
  type CatalogSessionReconciliation,
  reconcileConnectionCatalogSessions,
  nextRecentPaneIds,
  isStoreConnectionLeaseCurrent,
  connectionSnapshot,
  connectionEventIsActive,
  terminalNavigationLoading,
  numberedCreatedTabRename,
  stabilizeRefreshPatch,
  mergeConnectionCatalog,
} from "./store/sessions";

export {
  WORKTREE_REMOVED_EVENT,
  summarizeDirectHookResult,
  worktreeRemovalCompletionNotice,
} from "./store/worktree";

export {
  automaticUpdateChecksEnabledFromStorage,
  type HerdrStatusUpgrade,
  herdrUpgradeOffered,
  herdrUpgradeMenuEntry,
  healthMatchesUpdateVersion,
} from "./store/updates";

export {
  OperationalContext,
  useStore,
  shallowEqual,
  useStoreSelector,
  useOperationalStore,
} from "./store/react";

export {
  endpointCreationReason,
  useEndpointCreationReason,
} from "./store/creation";

export {
  type PaneSide,
  operationalStore,
} from "./store/operations";
