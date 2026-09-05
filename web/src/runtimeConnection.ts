import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { applyActivityMessage, parseActivityEventData, replayActivityMessages } from "./activity";
import type { ActivityLogEntry } from "./activity";
import type { BridgeId, BridgeRuntime } from "./bridge";
import { bridgeWebSocketProtocols, refreshBridgeAuthentication } from "./bridgeApi";
import { createSnapshotRefreshController } from "./refreshCoordinator";
import { fetchRuntimeSnapshot, RuntimeCache } from "./runtimeClient";
import type { RuntimeLoadState } from "./runtimeClient";
import type { Snapshot } from "./types";
import { officeDebug } from "./officeDebug";

const SNAPSHOT_REFRESH_INTERVAL_MS = 10_000;
const EVENT_REFRESH_COALESCE_MS = 250;
const SHARED_SELECTION_SETTLE_TIMEOUT_MS = 2_000;

export type BridgeConnectionState = {
  connectionKey: string;
  snapshot: Snapshot | null;
  loadState: RuntimeLoadState;
};

export type BridgeConnectionRef = {
  profileConnectionKey: string;
  connectionKey: string;
  snapshot: Snapshot | null;
  activityGeneration: number;
  resyncBarrierGeneration: number;
  activityLog: ActivityLogEntry[];
  sharedSelectionOverride: {
    paneId: string;
    expiresAtMs: number;
  } | null;
  recoveryRequired: boolean;
  awaitingCapabilityHandshake: boolean;
};

type RuntimeConnectionProps = {
  runtime: BridgeRuntime;
  requiredCapabilities: readonly string[];
  followSharedSelection: boolean;
  connectionRefs: MutableRefObject<Record<string, BridgeConnectionRef>>;
  runtimeCache: RuntimeCache<Snapshot>;
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>;
  onRecoveryDetected: (bridgeId: BridgeId) => void;
  onPaneSelection: (bridgeId: BridgeId, paneId: string, workspaceId?: string) => void;
  onAgentActivityChanged: (bridgeId: BridgeId) => void;
  onAgentPinsChanged: (bridgeId: BridgeId) => void;
  onNotesChanged: (bridgeId: BridgeId) => void;
};

export function RuntimeConnection({
  runtime,
  requiredCapabilities,
  followSharedSelection,
  connectionRefs,
  runtimeCache,
  setConnectionStates,
  onRecoveryDetected,
  onPaneSelection,
  onAgentActivityChanged,
  onAgentPinsChanged,
  onNotesChanged,
}: RuntimeConnectionProps) {
  const httpUrlRef = useRef(runtime.httpUrl);
  const wsUrlRef = useRef(runtime.wsUrl);
  const onRecoveryDetectedRef = useRef(onRecoveryDetected);
  const onAgentActivityChangedRef = useRef(onAgentActivityChanged);
  const onAgentPinsChangedRef = useRef(onAgentPinsChanged);
  const onNotesChangedRef = useRef(onNotesChanged);
  const followSharedSelectionRef = useRef(followSharedSelection);
  const refreshOffsetRef = useRef(stableBridgeRefreshOffsetMs(runtime.id));
  const requiredCapabilityKey = requiredCapabilities.join("\u0000");

  useEffect(() => {
    httpUrlRef.current = runtime.httpUrl;
    wsUrlRef.current = runtime.wsUrl;
  }, [runtime.httpUrl, runtime.wsUrl]);

  useEffect(() => {
    followSharedSelectionRef.current = followSharedSelection;
    onRecoveryDetectedRef.current = onRecoveryDetected;
    onAgentActivityChangedRef.current = onAgentActivityChanged;
    onAgentPinsChangedRef.current = onAgentPinsChanged;
    onNotesChangedRef.current = onNotesChanged;
  }, [
    followSharedSelection,
    onRecoveryDetected,
    onAgentActivityChanged,
    onAgentPinsChanged,
    onNotesChanged,
  ]);

  useEffect(() => {
    let disposed = false;
    let interval: number | null = null;
    let intervalStartTimer: number | null = null;
    let eventRefreshTimer: number | null = null;
    let eventRefreshPending = false;
    const ref = ensureBridgeConnectionRef(connectionRefs, runtime, runtimeCache);
    const surfaceSupported = requiredCapabilities.every((capability) =>
      runtime.capabilities?.features?.includes(capability),
    );

    if (runtime.capabilityState !== "ready" || !runtime.canConnect || !surfaceSupported) {
      officeDebug("runtime-connection:waiting", {
        bridgeId: runtime.id,
        capabilityState: runtime.capabilityState,
        canConnect: runtime.canConnect,
        surfaceSupported,
        generationKey: runtime.generationKey,
      });
      runtimeCache.markUnavailable(runtime.id, runtime.generationKey);
      setConnectionStates((current) => ({
        ...current,
        [runtime.id]: {
          connectionKey: runtime.generationKey,
          snapshot: ref.snapshot,
          loadState:
            runtime.capabilityState === "idle" || runtime.capabilityState === "probing"
              ? "loading"
              : "error",
        },
      }));
      return () => {
        disposed = true;
      };
    }

    setConnectionStates((current) => {
      const existing = current[runtime.id];
      if (existing?.connectionKey === runtime.generationKey && existing.loadState === "ready") {
        return current;
      }
      return {
        ...current,
        [runtime.id]: {
          connectionKey: runtime.generationKey,
          snapshot: ref.snapshot,
          loadState: "loading",
        },
      };
    });

    const requestGenerationKey = runtime.generationKey;
    let snapshotRequestCount = 0;
    const isCurrentConnection = () =>
      !disposed &&
      isRuntimeGenerationCurrent(connectionRefs.current[runtime.id], requestGenerationKey);
    const refreshController = createSnapshotRefreshController({
      fetchSnapshot: () => {
        snapshotRequestCount += 1;
        if (snapshotRequestCount <= 5 || snapshotRequestCount % 50 === 0) {
          officeDebug("snapshot:request", {
            bridgeId: runtime.id,
            count: snapshotRequestCount,
          });
        }
        return fetchRuntimeSnapshot(httpUrlRef.current);
      },
      getGeneration: () => connectionRefs.current[runtime.id]?.activityGeneration ?? 0,
      getBarrierGeneration: () =>
        connectionRefs.current[runtime.id]?.resyncBarrierGeneration ?? 0,
      isCurrent: isCurrentConnection,
      onError: () => {
        const currentRef = connectionRefs.current[runtime.id];
        if (!isRuntimeGenerationCurrent(currentRef, requestGenerationKey)) {
          return;
        }
        markRuntimeUnavailable(runtime, currentRef, runtimeCache, setConnectionStates);
      },
      applySnapshot: (next, refreshGeneration) => {
        const currentRef = connectionRefs.current[runtime.id];
        if (!isRuntimeGenerationCurrent(currentRef, requestGenerationKey)) {
          return;
        }
        officeDebug("snapshot:admit", {
          bridgeId: runtime.id,
          generationKey: requestGenerationKey,
          refreshGeneration,
          panes: next.panes.length,
          tabs: next.tabs.length,
          workspaces: next.workspaces.length,
        });
        admitRuntimeSnapshot({
          runtime,
          snapshot: next,
          ref: currentRef,
          refreshGeneration,
          runtimeCache,
          setConnectionStates,
          onRecoveryDetected: onRecoveryDetectedRef.current,
        });
      },
    });
    const refresh = () => refreshController.request();
    const requestEventRefresh = () => {
      eventRefreshPending = true;
      if (eventRefreshTimer !== null) {
        return;
      }
      eventRefreshTimer = window.setTimeout(() => {
        eventRefreshTimer = null;
        if (!eventRefreshPending) {
          return;
        }
        eventRefreshPending = false;
        refresh();
      }, EVENT_REFRESH_COALESCE_MS);
    };
    const requestActivityResync = () => {
      const currentRef = connectionRefs.current[runtime.id];
      if (!isRuntimeGenerationCurrent(currentRef, requestGenerationKey)) {
        return;
      }
      currentRef.activityGeneration += 1;
      currentRef.resyncBarrierGeneration = currentRef.activityGeneration;
      refresh();
    };

    officeDebug("runtime-connection:admitted", {
      bridgeId: runtime.id,
      generationKey: requestGenerationKey,
      retainedSnapshot: ref.snapshot !== null,
    });
    refresh();
    const refreshOffset = refreshOffsetRef.current;
    intervalStartTimer = window.setTimeout(() => {
      refresh();
      interval = window.setInterval(refresh, SNAPSHOT_REFRESH_INTERVAL_MS);
    }, SNAPSHOT_REFRESH_INTERVAL_MS + refreshOffset);

    const events = openEventsSocket(wsUrlRef.current, "/ws/events", requestEventRefresh, {
      onClose: () => {
        void refreshBridgeAuthentication(wsUrlRef.current("/ws/events")).catch((error) => {
          officeDebug("events-socket:reauthentication-failed", {
            path: "/ws/events",
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    });
    const activity = openEventsSocket(
      wsUrlRef.current,
      "/ws/activity",
      (event) => {
        if (!isCurrentConnection()) {
          return;
        }
        const currentRef = connectionRefs.current[runtime.id];
        if (!currentRef) {
          return;
        }
        const parsed = parseActivityEventData(event.data);
        if (parsed.status === "ignored") {
          return;
        }
        if (parsed.status === "invalid_known") {
          requestActivityResync();
          return;
        }
        const result = applyActivityMessage(currentRef.snapshot, parsed.message);
        if (result.status === "applied") {
          currentRef.activityGeneration += 1;
          currentRef.activityLog = [
            ...currentRef.activityLog,
            { generation: currentRef.activityGeneration, message: parsed.message },
          ].slice(-100);
          admitDerivedSnapshot(
            runtime,
            currentRef,
            result.snapshot,
            runtimeCache,
            setConnectionStates,
          );
        } else if (result.status === "resync") {
          requestActivityResync();
        }
      },
      { onOpen: refresh },
    );
    const uiEvents = openEventsSocket(
      wsUrlRef.current,
      "/ws/ui-events",
      (event) => {
        if (!isCurrentConnection()) {
          return;
        }
        const paneId = selectionPaneId(event);
        if (paneId) {
          const currentRef = connectionRefs.current[runtime.id];
          if (!currentRef) {
            return;
          }
          currentRef.activityGeneration += 1;
          currentRef.resyncBarrierGeneration = currentRef.activityGeneration;
          currentRef.sharedSelectionOverride = {
            paneId,
            expiresAtMs: Date.now() + SHARED_SELECTION_SETTLE_TIMEOUT_MS,
          };
          const currentSnapshot = currentRef.snapshot;
          if (currentSnapshot) {
            admitDerivedSnapshot(
              runtime,
              currentRef,
              { ...currentSnapshot, selected_pane_id: paneId },
              runtimeCache,
              setConnectionStates,
            );
          }
          const pane = currentSnapshot?.panes.find((item) => item.pane_id === paneId);
          if (followSharedSelectionRef.current) {
            onPaneSelection(runtime.id, paneId, pane?.workspace_id);
          }
          refresh();
          return;
        }
        if (isNotesChangedEvent(event)) {
          onNotesChangedRef.current(runtime.id);
          return;
        }
        if (isAgentActivityChangedEvent(event)) {
          onAgentActivityChangedRef.current(runtime.id);
          return;
        }
        if (isAgentPinsChangedEvent(event)) {
          onAgentPinsChangedRef.current(runtime.id);
          return;
        }
        refresh();
      },
      { onOpen: () => onAgentActivityChangedRef.current(runtime.id) },
    );

    return () => {
      disposed = true;
      events?.close();
      activity?.close();
      uiEvents?.close();
      if (intervalStartTimer !== null) {
        window.clearTimeout(intervalStartTimer);
      }
      if (interval !== null) {
        window.clearInterval(interval);
      }
      if (eventRefreshTimer !== null) {
        window.clearTimeout(eventRefreshTimer);
      }
    };
  }, [
    connectionRefs,
    onPaneSelection,
    requiredCapabilityKey,
    runtime.canConnect,
    runtime.capabilities,
    runtime.capabilityState,
    runtime.connectionKey,
    runtime.generationKey,
    runtime.id,
    runtime.resumeToken,
    runtimeCache,
    setConnectionStates,
  ]);

  return null;
}

export function ensureBridgeConnectionRef(
  connectionRefs: MutableRefObject<Record<string, BridgeConnectionRef>>,
  runtime: BridgeRuntime,
  runtimeCache: RuntimeCache<Snapshot>,
) {
  runtimeCache.configure(runtime.id, runtime.connectionKey, runtime.generationKey);
  const existing = connectionRefs.current[runtime.id];
  if (existing?.connectionKey === runtime.generationKey) {
    return existing;
  }
  const preserveSnapshot = existing?.profileConnectionKey === runtime.connectionKey;
  const next: BridgeConnectionRef = {
    profileConnectionKey: runtime.connectionKey,
    connectionKey: runtime.generationKey,
    snapshot: preserveSnapshot ? existing.snapshot : null,
    activityGeneration: 0,
    resyncBarrierGeneration: 0,
    activityLog: [],
    sharedSelectionOverride: null,
    recoveryRequired: false,
    awaitingCapabilityHandshake: false,
  };
  connectionRefs.current[runtime.id] = next;
  return next;
}

export function isRuntimeGenerationCurrent(
  ref: BridgeConnectionRef | null | undefined,
  generationKey: string,
) {
  return Boolean(
    ref && ref.connectionKey === generationKey && !ref.awaitingCapabilityHandshake,
  );
}

export function markRuntimeUnavailable(
  runtime: BridgeRuntime,
  ref: BridgeConnectionRef,
  runtimeCache: RuntimeCache<Snapshot>,
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>,
) {
  if (ref.connectionKey !== runtime.generationKey) {
    return;
  }
  ref.recoveryRequired = true;
  runtimeCache.markUnavailable(runtime.id, runtime.generationKey);
  setConnectionStates((current) => ({
    ...current,
    [runtime.id]: {
      connectionKey: runtime.generationKey,
      snapshot: ref.snapshot,
      loadState: "error",
    },
  }));
}

export function admitRuntimeSnapshot({
  runtime,
  snapshot,
  ref,
  refreshGeneration,
  runtimeCache,
  setConnectionStates,
  onRecoveryDetected,
}: {
  runtime: BridgeRuntime;
  snapshot: Snapshot;
  ref: BridgeConnectionRef;
  refreshGeneration: number;
  runtimeCache: RuntimeCache<Snapshot>;
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>;
  onRecoveryDetected: (bridgeId: BridgeId) => void;
}) {
  if (!isRuntimeGenerationCurrent(ref, runtime.generationKey)) {
    return null;
  }
  if (ref.recoveryRequired) {
    ref.recoveryRequired = false;
    ref.awaitingCapabilityHandshake = true;
    runtimeCache.markUnavailable(runtime.id, runtime.generationKey);
    setConnectionStates((current) => ({
      ...current,
      [runtime.id]: {
        connectionKey: runtime.generationKey,
        snapshot: ref.snapshot,
        loadState: "loading",
      },
    }));
    onRecoveryDetected(runtime.id);
    return null;
  }
  const patched = applySnapshotOverlays(snapshot, ref, refreshGeneration);
  ref.snapshot = patched;
  runtimeCache.admitSnapshot(runtime.id, runtime.generationKey, patched);
  setConnectionStates((current) => ({
    ...current,
    [runtime.id]: {
      connectionKey: runtime.generationKey,
      snapshot: patched,
      loadState: "ready",
    },
  }));
  return patched;
}

function admitDerivedSnapshot(
  runtime: BridgeRuntime,
  ref: BridgeConnectionRef,
  snapshot: Snapshot,
  runtimeCache: RuntimeCache<Snapshot>,
  setConnectionStates: Dispatch<SetStateAction<Record<string, BridgeConnectionState>>>,
) {
  if (ref.recoveryRequired || !isRuntimeGenerationCurrent(ref, runtime.generationKey)) {
    return;
  }
  ref.snapshot = snapshot;
  runtimeCache.admitSnapshot(runtime.id, runtime.generationKey, snapshot);
  setConnectionStates((current) => ({
    ...current,
    [runtime.id]: {
      connectionKey: runtime.generationKey,
      snapshot,
      loadState: "ready",
    },
  }));
}

export function stableBridgeRefreshOffsetMs(bridgeId: BridgeId) {
  let hash = 0;
  for (let index = 0; index < bridgeId.length; index += 1) {
    hash = (hash * 31 + bridgeId.charCodeAt(index)) >>> 0;
  }
  return hash % SNAPSHOT_REFRESH_INTERVAL_MS;
}

export function applySnapshotOverlays(
  snapshot: Snapshot,
  ref: BridgeConnectionRef,
  refreshGeneration: number,
) {
  const patched = replayActivityMessages(snapshot, ref.activityLog, refreshGeneration);
  const selectionOverride = ref.sharedSelectionOverride;
  if (!selectionOverride) {
    return patched;
  }
  if (
    patched.selected_pane_id === selectionOverride.paneId ||
    Date.now() >= selectionOverride.expiresAtMs
  ) {
    ref.sharedSelectionOverride = null;
    return patched;
  }
  return { ...patched, selected_pane_id: selectionOverride.paneId };
}

function selectionPaneId(event: MessageEvent) {
  if (typeof event.data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown; pane_id?: unknown };
    return parsed.type === "herdr_web.selection_changed" && typeof parsed.pane_id === "string"
      ? parsed.pane_id
      : null;
  } catch {
    return null;
  }
}

function eventHasType(event: MessageEvent, type: string) {
  if (typeof event.data !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(event.data) as { type?: unknown };
    return parsed.type === type;
  } catch {
    return false;
  }
}

const isNotesChangedEvent = (event: MessageEvent) =>
  eventHasType(event, "herdr_web.notes_changed");
const isAgentActivityChangedEvent = (event: MessageEvent) =>
  eventHasType(event, "herdr_web.agent_activity_changed");
const isAgentPinsChangedEvent = (event: MessageEvent) =>
  eventHasType(event, "herdr_web.agent_pins_changed");

function openEventsSocket(
  wsUrl: (path: string, query?: URLSearchParams) => string,
  path: string,
  onEvent: (event: MessageEvent) => void,
  options: { onOpen?: () => void; onClose?: () => void } = {},
) {
  const url = wsUrl(path);
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let attempts = 0;
  let eventCount = 0;

  const connect = () => {
    if (closed) {
      return;
    }
    const next = new WebSocket(url, bridgeWebSocketProtocols(url));
    socket = next;
    next.addEventListener("open", () => {
      attempts = 0;
      officeDebug("events-socket:open", { path, url });
      options.onOpen?.();
    });
    next.addEventListener("message", (event) => {
      eventCount += 1;
      if (eventCount <= 5 || eventCount % 50 === 0) {
        officeDebug("events-socket:message", {
          path,
          count: eventCount,
          dataType: typeof event.data,
          preview: typeof event.data === "string" ? event.data.slice(0, 120) : null,
        });
      }
      onEvent(event);
    });
    next.addEventListener("close", () => {
      if (closed || socket !== next || reconnectTimer !== null) {
        return;
      }
      options.onClose?.();
      const delay = Math.min(500 * 2 ** attempts, 5_000);
      attempts += 1;
      officeDebug("events-socket:close", { path, attempts, retryDelayMs: delay });
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    });
  };

  connect();
  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      socket?.close();
    },
  };
}
