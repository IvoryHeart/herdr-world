import {
  type ServerSessionState,
  type State,
  type StoreConnectionLease,
} from "./types";
import { emptyBrowserNavigation } from "../browserNavigation";
import { type ConnectionSummary, bridge, parseConnectionSummary } from "../api";
import { type Pane } from "../types";

const RECENT_PANE_LIMIT = 12;

export function emptyServerSessionState(
  serverRuntimeGeneration: number | null = null,
): ServerSessionState {
  return {
    serverRuntimeGeneration,
    navigationMode: "shared",
    tabMoveSupported: false,
    endpointAvailability: {},
    terminalAttachments: {},
    browserNavigation: emptyBrowserNavigation(),
    workspaces: [],
    tabs: [],
    panes: [],
    layout: null,
    selectedPaneId: null,
    recentPaneIds: [],
    popup: null,
    error: null,
    pendingFocusWorkspaceId: null,
    pendingFocusWorkspaceSeq: 0,
    pendingFocusWorkspaceSettledAt: null,
    terminalAttachEpoch: 0,
    lastRefresh: 0,
    lastTopologyObservationStartedAt: 0,
  };
}

const SERVER_SESSION_KEYS: Array<keyof ServerSessionState> = [
  "serverRuntimeGeneration",
  "navigationMode",
  "tabMoveSupported",
  "endpointAvailability",
  "terminalAttachments",
  "browserNavigation",
  "workspaces",
  "tabs",
  "panes",
  "layout",
  "selectedPaneId",
  "recentPaneIds",
  "error",
  "pendingFocusWorkspaceId",
  "pendingFocusWorkspaceSeq",
  "pendingFocusWorkspaceSettledAt",
  "terminalAttachEpoch",
  "lastRefresh",
  "lastTopologyObservationStartedAt",
];

function serverSessionFromState(snapshot: State): ServerSessionState {
  return {
    serverRuntimeGeneration: snapshot.serverRuntimeGeneration,
    navigationMode: snapshot.navigationMode,
    tabMoveSupported: snapshot.tabMoveSupported,
    endpointAvailability: snapshot.endpointAvailability,
    terminalAttachments: snapshot.terminalAttachments,
    browserNavigation: snapshot.browserNavigation,
    workspaces: snapshot.workspaces,
    tabs: snapshot.tabs,
    panes: snapshot.panes,
    layout: snapshot.layout,
    selectedPaneId: snapshot.selectedPaneId,
    recentPaneIds: snapshot.recentPaneIds,
    popup: snapshot.popup,
    error: snapshot.error,
    pendingFocusWorkspaceId: snapshot.pendingFocusWorkspaceId,
    pendingFocusWorkspaceSeq: snapshot.pendingFocusWorkspaceSeq,
    pendingFocusWorkspaceSettledAt: snapshot.pendingFocusWorkspaceSettledAt,
    terminalAttachEpoch: snapshot.terminalAttachEpoch,
    lastRefresh: snapshot.lastRefresh,
    lastTopologyObservationStartedAt: snapshot.lastTopologyObservationStartedAt,
  };
}

/** Pure state transition used by the store and deterministic partition tests. */
export function activateConnectionState(
  snapshot: State,
  connectionId: string,
  generation: number,
): State {
  if (connectionId === snapshot.activeConnectionId) {
    return { ...snapshot, connectionGeneration: generation };
  }
  const outgoingIsCataloged = snapshot.connections.some(
    (connection) => connection.id === snapshot.activeConnectionId,
  );
  const oldSession = {
    ...serverSessionFromState(snapshot),
  };
  const runtimeGeneration =
    snapshot.connections.find((connection) => connection.id === connectionId)
      ?.generation ?? null;
  const cached = snapshot.sessionsByConnectionId[connectionId];
  const restored =
    cached?.serverRuntimeGeneration === runtimeGeneration &&
    runtimeGeneration !== null
      ? cached
      : emptyServerSessionState(runtimeGeneration);
  const newSession = {
    ...restored,
    // A restored pending focus outlived its action, so treat it as settled:
    // the next fresh observation decides whether it still applies. Reuse the
    // snapshot timestamp as a stable non-null token; wall-clock time is unused.
    pendingFocusWorkspaceSettledAt: restored.pendingFocusWorkspaceId
      ? (restored.pendingFocusWorkspaceSettledAt ?? restored.lastRefresh)
      : restored.pendingFocusWorkspaceSettledAt,
  };
  return {
    ...snapshot,
    ...newSession,
    activeConnectionId: connectionId,
    connectionGeneration: generation,
    sessionsByConnectionId: {
      ...snapshot.sessionsByConnectionId,
      ...(outgoingIsCataloged
        ? { [snapshot.activeConnectionId]: oldSession }
        : {}),
      [connectionId]: newSession,
    },
    notice: null,
  };
}

export interface CatalogSessionReconciliation {
  sessionsByConnectionId: Record<string, ServerSessionState>;
  activeSession: ServerSessionState | null;
  invalidatedConnectionIds: string[];
  activeRuntimeChanged: boolean;
}

/**
 * Bind cached server resources to ConnectionManager generations. This is the
 * production catalog transition and a pure deterministic regression seam.
 */
export function reconcileConnectionCatalogSessions(
  snapshot: State,
  connections: ConnectionSummary[],
): CatalogSessionReconciliation {
  const previousById = new Map(
    snapshot.connections.map((connection) => [connection.id, connection]),
  );
  const sessionsByConnectionId: Record<string, ServerSessionState> = {};
  const invalidatedConnectionIds: string[] = [];
  let activeSession: ServerSessionState | null = null;
  let activeRuntimeChanged = false;

  for (const connection of connections) {
    const cached =
      connection.id === snapshot.activeConnectionId
        ? serverSessionFromState(snapshot)
        : snapshot.sessionsByConnectionId[connection.id];
    const previous = previousById.get(connection.id);
    const initialActiveTag =
      snapshot.connections.length === 0 &&
      connection.id === snapshot.activeConnectionId &&
      !!cached &&
      (cached.serverRuntimeGeneration === null ||
        cached.serverRuntimeGeneration === connection.generation);
    const catalogGenerationChanged =
      previous !== undefined && previous.generation !== connection.generation;
    const cachedGenerationMismatch =
      !!cached &&
      cached.serverRuntimeGeneration !== null &&
      cached.serverRuntimeGeneration !== connection.generation;
    const newCatalogEntry = previous === undefined && !initialActiveTag;
    const invalidated =
      !cached ||
      catalogGenerationChanged ||
      cachedGenerationMismatch ||
      newCatalogEntry;
    const nextSession = invalidated
      ? {
          ...emptyServerSessionState(connection.generation),
          terminalAttachEpoch: (cached?.terminalAttachEpoch ?? 0) + 1,
        }
      : {
          ...cached,
          serverRuntimeGeneration: connection.generation,
        };
    sessionsByConnectionId[connection.id] = nextSession;
    if (invalidated) invalidatedConnectionIds.push(connection.id);
    if (connection.id === snapshot.activeConnectionId) {
      activeSession = nextSession;
      activeRuntimeChanged = invalidated && !initialActiveTag;
    }
  }

  return {
    sessionsByConnectionId,
    activeSession,
    invalidatedConnectionIds,
    activeRuntimeChanged,
  };
}

export function nextRecentPaneIds(
  selectedPaneId: string | null | undefined,
  recentPaneIds: string[],
  panes: Array<Pick<Pane, "pane_id">>,
) {
  const livePaneIds = new Set(panes.map((pane) => pane.pane_id));
  const pruned = recentPaneIds.filter((paneId) => livePaneIds.has(paneId));
  if (!selectedPaneId || !livePaneIds.has(selectedPaneId)) {
    return pruned.slice(0, RECENT_PANE_LIMIT);
  }
  return [
    selectedPaneId,
    ...pruned.filter((paneId) => paneId !== selectedPaneId),
  ].slice(0, RECENT_PANE_LIMIT);
}

export function isStoreConnectionLeaseCurrent(
  snapshot: Pick<State, "activeConnectionId" | "connectionGeneration">,
  lease: Pick<StoreConnectionLease, "connectionId" | "generation">,
): boolean {
  return (
    snapshot.activeConnectionId === lease.connectionId &&
    snapshot.connectionGeneration === lease.generation
  );
}
const connectionSnapshots = new WeakMap<State, Map<string, State>>();

/** Read a partition without changing Spaces focus or another partition. */
export function connectionSnapshot(
  snapshot: State,
  connectionId: string,
): State {
  const cached = connectionSnapshots.get(snapshot) ?? new Map<string, State>();
  connectionSnapshots.set(snapshot, cached);
  const existing = cached.get(connectionId);
  if (existing) return existing;
  if (snapshot.activeConnectionId === connectionId) {
    const projected = {
      ...snapshot,
      connectionGeneration:
        snapshot.serverRuntimeGeneration ?? snapshot.connectionGeneration,
    };
    cached.set(connectionId, projected);
    return projected;
  }
  const session =
    snapshot.sessionsByConnectionId[connectionId] ??
    emptyServerSessionState(null);
  const projected = {
    ...snapshot,
    ...session,
    activeConnectionId: connectionId,
    connectionGeneration:
      session.serverRuntimeGeneration ?? snapshot.connectionGeneration,
  };
  cached.set(connectionId, projected);
  return projected;
}

export function connectionEventIsActive(
  snapshot: Pick<State, "activeConnectionId" | "connections">,
  connectionId: string,
  connectionGeneration?: number,
  requireGeneration = bridge.hello?.capabilities
    ?.connection_runtime_generation === true,
): boolean {
  if (snapshot.activeConnectionId !== connectionId) return false;
  const expected = snapshot.connections.find(
    (connection) => connection.id === connectionId,
  )?.generation;
  if (!requireGeneration) return true;
  return expected !== undefined && expected === connectionGeneration;
}

export function terminalNavigationLoading(s: State): boolean {
  return (
    s.status === "connected" &&
    !s.connectionPaused &&
    !s.error &&
    (!!s.pendingFocusWorkspaceId ||
      (!s.layout && s.panes.some((pane) => pane.pane_id === s.selectedPaneId)))
  );
}

function pickActiveTabId(s: State): string | undefined {
  const focusedWs = s.workspaces.find((w) => w.focused);
  if (focusedWs?.active_tab_id) return focusedWs.active_tab_id;
  const focusedTab = s.tabs.find((t) => t.focused);
  return focusedTab?.tab_id ?? s.tabs[0]?.tab_id;
}

interface NumberedTabRename {
  tabId: string;
  label: string;
}

/** Builds a stable GUI label from Herdr's authoritative created-tab number. */
export function numberedCreatedTabRename(
  result: unknown,
): NumberedTabRename | null {
  if (!result || typeof result !== "object") return null;
  const response = result as { type?: unknown; tab?: unknown };
  if (response.type !== "tab_created" || !response.tab) return null;
  if (typeof response.tab !== "object") return null;

  const { tab_id: tabId, number } = response.tab as {
    tab_id?: unknown;
    number?: unknown;
  };
  if (
    typeof tabId !== "string" ||
    !tabId ||
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 1
  ) {
    return null;
  }
  return { tabId, label: `Tab ${number}` };
}

/**
 * Structural equality for JSON-shaped values. Fails open (reports unequal)
 * when a value cannot be serialized, so callers fall back to publishing.
 */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function serverSessionEqual(
  a: ServerSessionState,
  b: ServerSessionState,
): boolean {
  for (const key of SERVER_SESSION_KEYS) {
    if (a[key] === b[key]) continue;
    if (!jsonDeepEqual(a[key], b[key])) return false;
  }
  return true;
}

const REFRESH_SLICE_KEYS = [
  "workspaces",
  "tabs",
  "panes",
  "layout",
  "browserNavigation",
  "endpointAvailability",
] as const;
const REFRESH_SCALAR_KEYS = [
  "serverRuntimeGeneration",
  "navigationMode",
  "tabMoveSupported",
  "error",
  "pendingFocusWorkspaceId",
  "pendingFocusWorkspaceSettledAt",
  "selectedPaneId",
] as const;

/**
 * Reuse the previous reference for every refresh slice whose content is
 * unchanged so memoized consumers stay valid, and return null when nothing
 * changed at all so the caller can skip broadcasting a no-op state. Scalars
 * are only adopted when their value actually moved.
 */
export function stabilizeRefreshPatch(
  snapshot: State,
  next: Partial<State>,
): Partial<State> | null {
  const patch: Partial<State> = {};
  let changed = false;
  const adoptSlice = <K extends (typeof REFRESH_SLICE_KEYS)[number]>(
    key: K,
  ) => {
    if (!(key in next)) return;
    const incoming = next[key] as State[K];
    const current = snapshot[key];
    if (incoming === current || jsonDeepEqual(incoming, current)) {
      patch[key] = current;
    } else {
      patch[key] = incoming;
      changed = true;
    }
  };
  for (const key of REFRESH_SLICE_KEYS) adoptSlice(key);
  const adoptScalar = <K extends (typeof REFRESH_SCALAR_KEYS)[number]>(
    key: K,
  ) => {
    if (!(key in next)) return;
    if (next[key] === snapshot[key]) return;
    patch[key] = next[key] as State[K];
    changed = true;
  };
  for (const key of REFRESH_SCALAR_KEYS) adoptScalar(key);
  // A first/reconnect observation establishes hydration even when cached
  // topology is identical. Subsequent unchanged observations stay silent.
  if (!changed && snapshot.lastRefresh) return null;
  patch.lastRefresh = next.lastRefresh ?? Date.now();
  return patch;
}

export function mergeConnectionCatalog(
  previous: ConnectionSummary[],
  values: unknown[],
): ConnectionSummary[] {
  return values
    .map(parseConnectionSummary)
    .filter(
      (connection): connection is ConnectionSummary => connection !== null,
    )
    .map((connection) => {
      const prior = previous.find((item) => item.id === connection.id);
      if (!prior) return connection;
      if (
        connection.type !== undefined &&
        prior.type !== undefined &&
        connection.type !== prior.type
      ) {
        return {
          ...prior,
          ...connection,
          control_socket_path: connection.control_socket_path,
          client_socket_path: connection.client_socket_path,
          ssh_destination: connection.ssh_destination,
          remote_control_socket_path: connection.remote_control_socket_path,
          remote_client_socket_path: connection.remote_client_socket_path,
        };
      }
      return {
        ...prior,
        ...connection,
        type: connection.type ?? prior.type,
        read_only: connection.read_only ?? prior.read_only,
        auto_connect: connection.auto_connect ?? prior.auto_connect,
        control_socket_path:
          connection.control_socket_path ?? prior.control_socket_path,
        client_socket_path:
          connection.client_socket_path ?? prior.client_socket_path,
        ssh_destination: connection.ssh_destination ?? prior.ssh_destination,
        remote_control_socket_path:
          connection.remote_control_socket_path ??
          prior.remote_control_socket_path,
        remote_client_socket_path:
          connection.remote_client_socket_path ??
          prior.remote_client_socket_path,
      };
    });
}
export {
  SERVER_SESSION_KEYS,
  serverSessionFromState,
  pickActiveTabId,
  jsonDeepEqual,
  serverSessionEqual,
};
