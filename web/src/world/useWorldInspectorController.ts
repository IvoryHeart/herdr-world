import { useCreationProgress } from "../creationRequests";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type WorkspaceSurfaceSelection } from "../App";
import { worldLocalStorage } from "../browserStorage";
import { paneShortcutAction } from "../paneShortcuts";
import {
  adjacentTabId,
  closeShortcutTarget,
  tabShortcutAction,
} from "../tabShortcuts";
import { connectionSnapshot, operationalStore, store } from "../store";
import {
  type InspectorView,
  readInspectorPreferences,
  resourceScopeForWorkspace,
} from "../workspaceResource";
import { worldRuntimeStore, type WorldRuntimePriority } from "./runtimeStore";
import { buildWorldObject, type WorldObjectNode } from "./worldObject";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import {
  reconcileWorldInspectorConversation,
  worldInspectorForNode,
  worldInspectorWindowId,
  worldInspectorWindowIdForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";
import { inspectorPaneInput } from "./inspectorTerminalHandoff";
import {
  worldSelectionIsCurrent,
  worldNodeForWorkspaceSurfaceSelection,
  worldNodeForInspectorConversation,
  worldNodeForInspectorPaneFocus,
  worldIntentViews,
  worldInspectorContext,
  worldIntentInitialView,
  snapshotPriorityForConversation,
  snapshotPriorityForSurface,
  shouldCloseWorldInspector,
  focusWorldNode,
  reconcileObservedInspectors,
} from "./worldInspectorSelection";
import { type WorldControlPlaneProps } from "./worldControlPlaneContract";
import { useWorldObservation } from "./useWorldObservation";
import { useWorldInspectorWindows } from "./useWorldInspectorWindows";
import { useWorldCreatedTerminal } from "./useWorldCreatedTerminal";

export function useWorldInspectorController(props: WorldControlPlaneProps) {
  const {
    creationIntentRevision,
    view,
    active,
    inspectorConversations,
    dockedInspectorId,
    onDockedInspectorIdChange,
    onInspectorConversationsChange,
    onInspectorTerminalPortal,
    onWorkspaceSurfaceSelectionReady,
    onInspectorPaneFocusReady,
    onActiveInspectorChange,
    onVisualArrangementControlReady,
    onPresentedWorldChange,
  } = props;
  const {
    runtime,
    watchlistStore,
    watchlist,
    pinnedOnly,
    setPinnedOnly,
    deskReadingPane,
    connectionSelection,
    operationalSnapshot,
    hostsFilter,
    hasSelectedConnection,
    selectedWorldConnection,
    selectedWorldObservationActionable,
    aggregateWorld,
    world,
    presentedWorld,
    watchStatus,
    officeInspectorPresentation,
  } = useWorldObservation({ onPresentedWorldChange });

  const [selection, setSelection] = useState<WorldObjectNode | null>(null);
  const [pendingSurfacePriority, setPendingSurfacePriority] =
    useState<WorldRuntimePriority | null>(null);
  const intentRequestRef = creationIntentRevision;
  const creationProgress = useCreationProgress();
  const inspectorFocusIntentRef = useRef(0);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const [floatingInspectorPortals, setFloatingInspectorPortals] = useState<
    Record<string, HTMLDivElement | null>
  >({});
  const [intentOpening, setIntentOpening] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [, setSelectedVisualAnchor] = useState<OfficeCanvasAnchor | null>(null);
  const [visualConversationAnchors, setVisualConversationAnchors] =
    useState<Record<string, OfficeCanvasAnchor> | null>(null);
  const [floatingWindowAnchors, setFloatingWindowAnchors] = useState<
    Record<string, WorldConnectorTargetBounds | null>
  >({});
  const worldViewLayoutRef = useRef<HTMLDivElement | null>(null);
  const inspectorConversationsRef = useRef(inspectorConversations);
  const onInspectorConversationsChangeRef = useRef(
    onInspectorConversationsChange,
  );
  const onInspectorTerminalPortalRef = useRef(onInspectorTerminalPortal);
  const dockedInspectorIdRef = useRef(dockedInspectorId);
  const floatingInspectorPortalsRef = useRef(floatingInspectorPortals);
  inspectorConversationsRef.current = inspectorConversations;
  onInspectorConversationsChangeRef.current = onInspectorConversationsChange;
  onInspectorTerminalPortalRef.current = onInspectorTerminalPortal;
  dockedInspectorIdRef.current = dockedInspectorId;
  floatingInspectorPortalsRef.current = floatingInspectorPortals;
  const currentSelection = selection
    ? (aggregateWorld.nodeById.get(selection.id) ?? null)
    : null;
  const currentSelectionGeneration = worldSelectionIsCurrent(
    selection,
    currentSelection,
  );
  const selected = currentSelectionGeneration ? currentSelection : selection;
  const selectedId = currentSelectionGeneration
    ? (selection?.id ?? null)
    : null;
  const {
    setWindowLayer,
    windowStage,
    compactArrangement,
    managedWindows,
    windowCommand,
    activeInspectorId,
    contextRailInspector,
    visibleFloatingInspectorIds,
    visibleFloatingInspectors,
    raiseInspector,
    revealInspector,
    conversationNodeIds,
  } = useWorldInspectorWindows({
    view,
    active,
    inspectorConversations,
    onDockedInspectorIdChange,
    onActiveInspectorChange,
    onVisualArrangementControlReady,
    connectionSelection,
    aggregateWorld,
    world,
    officeInspectorPresentation,
    selection,
    setSelection,
    pendingSurfacePriority,
    intentRequestRef,
    inspectorConversationsRef,
    onInspectorConversationsChangeRef,
    onInspectorTerminalPortalRef,
  });

  const conversationFor = (
    node: WorldObjectNode,
    requestedView: InspectorView | null,
    candidateWorld = aggregateWorld,
  ) => {
    if (node.kind === "host") return null;
    const view = worldIntentInitialView(node, requestedView);
    const context = worldInspectorContext(node);
    if (!view || !context) return null;
    const workspaceId =
      node.kind === "space" ? node.nativeId : node.workspaceId;
    const workspace =
      connectionSnapshot(store.get(), node.connectionId).workspaces.find(
        (candidate) => candidate.workspace_id === workspaceId,
      ) ??
      candidateWorld.spaces.find(
        (space) =>
          space.connectionId === node.connectionId &&
          space.generation === node.generation &&
          space.nativeId === workspaceId &&
          space.actionable,
      )?.workspace;
    if (!workspace) return null;
    const preferences = readInspectorPreferences(
      worldLocalStorage,
      resourceScopeForWorkspace(node.connectionId, workspace),
    );
    return worldInspectorForNode(node, view, worldIntentViews(node), context, {
      dock: preferences.dock,
      expanded: preferences.expanded,
      size:
        preferences.dock === "right"
          ? preferences.rightSize
          : preferences.bottomSize,
    });
  };

  const focusInspectorTerminal = (windowId: string) => {
    const focusIntent = ++inspectorFocusIntentRef.current;
    const expected = inspectorConversationsRef.current.find(
      (candidate) => worldInspectorWindowId(candidate) === windowId,
    );
    if (!expected?.paneId) return;
    if (
      document.documentElement.dataset.layout === "mobile" ||
      window.matchMedia?.("(any-pointer: coarse)").matches
    ) {
      return;
    }
    const attempt = (remaining: number) => {
      if (inspectorFocusIntentRef.current !== focusIntent) return;
      if (
        document.querySelector(
          '.world-hosts-menu, .command-popover, .modal-backdrop, [role="menu"]',
        )
      )
        return;
      const conversation = inspectorConversationsRef.current.find(
        (candidate) => worldInspectorWindowId(candidate) === windowId,
      );
      const snapshot = conversation
        ? connectionSnapshot(store.get(), conversation.connectionId)
        : null;
      if (
        !conversation ||
        !snapshot ||
        conversation.view !== "terminal" ||
        !conversation.paneId ||
        conversation.paneId !== expected.paneId ||
        conversation.terminalId !== expected.terminalId ||
        snapshot.serverRuntimeGeneration !== conversation.runtimeGeneration ||
        snapshot.selectedPaneId !== conversation.paneId ||
        !snapshot.panes.some(
          (pane) =>
            pane.pane_id === conversation.paneId &&
            pane.terminal_id === conversation.terminalId &&
            pane.workspace_id === conversation.workspaceId &&
            pane.tab_id === conversation.tabId,
        )
      )
        return;
      const target = floatingInspectorPortalsRef.current[windowId];
      const input = inspectorPaneInput(target, conversation.paneId);
      if (input) {
        input.focus({ preventScroll: true });
        return;
      }
      if (remaining > 0) {
        window.setTimeout(() => attempt(remaining - 1), 0);
      }
    };
    requestAnimationFrame(() => attempt(2));
  };

  const bindSelectionIntentAbort = (
    signal: AbortSignal | undefined,
    requestId: number,
  ) => {
    if (!signal) return () => {};
    const abort = () => {
      if (intentRequestRef.current !== requestId) return;
      intentRequestRef.current += 1;
      setIntentOpening(false);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    return () => signal.removeEventListener("abort", abort);
  };

  const applySelection = async (
    id: string | null,
    requestedView: InspectorView | null = null,
    focusTarget = true,
    candidateWorld = world,
    signal?: AbortSignal,
    agentSessionId?: string,
  ): Promise<boolean> => {
    if (signal?.aborted) return false;
    const next = id ? (candidateWorld.nodeById.get(id) ?? null) : null;
    const inspectorView =
      requestedView ??
      (next?.kind === "space"
        ? "files"
        : next?.capabilities.openTerminal
          ? "terminal"
          : null);
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
    if (!next || next.kind === "host" || !next.actionable) {
      setSelection(next);
      setIntentOpening(false);
      return true;
    }
    const existing = inspectorConversations.find(
      (conversation) =>
        worldInspectorWindowId(conversation) ===
        worldInspectorWindowIdForNode(next),
    );
    if (existing) {
      setIntentOpening(true);
      const unbindAbort = bindSelectionIntentAbort(signal, requestId);
      try {
        if (focusTarget) await focusWorldNode(next, store, agentSessionId);
        if (signal?.aborted || intentRequestRef.current !== requestId)
          return false;
        const currentConversations = inspectorConversationsRef.current;
        const currentExisting = currentConversations.find(
          (conversation) =>
            worldInspectorWindowId(conversation) ===
            worldInspectorWindowIdForNode(next),
        );
        if (!currentExisting) return false;
        setSelection(next);
        const observed = conversationFor(next, inspectorView, candidateWorld);
        if (!observed) return false;
        const reconciled = reconcileWorldInspectorConversation(
          currentExisting,
          observed,
        );
        const admitted =
          inspectorView && reconciled.availableViews.includes(inspectorView)
            ? { ...reconciled, view: inspectorView }
            : reconciled;
        windowCommand({ type: "focus", id: worldInspectorWindowId(admitted) });
        if (admitted !== currentExisting) {
          const nextConversations = currentConversations.map((conversation) =>
            worldInspectorWindowId(conversation) ===
            worldInspectorWindowId(currentExisting)
              ? admitted
              : conversation,
          );
          inspectorConversationsRef.current = nextConversations;
          onInspectorConversationsChange(nextConversations);
        }
        if (admitted.view === "terminal") {
          // A preview (focusTarget false) shows the terminal without taking
          // keyboard focus; only an explicit open focuses it.
          if (focusTarget)
            focusInspectorTerminal(worldInspectorWindowId(admitted));
        }
      } catch (cause) {
        if (intentRequestRef.current === requestId) {
          setIntentError(
            cause instanceof Error ? cause.message : String(cause),
          );
        }
        return false;
      } finally {
        unbindAbort();
        if (intentRequestRef.current === requestId) setIntentOpening(false);
      }
      return true;
    }
    const conversation = conversationFor(next, inspectorView, candidateWorld);
    if (!conversation) return false;
    setIntentOpening(true);
    const unbindAbort = bindSelectionIntentAbort(signal, requestId);
    try {
      if (focusTarget) await focusWorldNode(next, store, agentSessionId);
      if (signal?.aborted || intentRequestRef.current !== requestId)
        return false;
      const currentConversations = inspectorConversationsRef.current;
      setSelection(next);
      const admittedConversation = {
        ...conversation,
        focusedListAdmissionAt: performance.now(),
      };
      const nextConversations = [...currentConversations, admittedConversation];
      inspectorConversationsRef.current = nextConversations;
      onInspectorConversationsChange(nextConversations);
      dockedInspectorIdRef.current = null;
      onDockedInspectorIdChange(null);
      if (admittedConversation.view === "terminal") {
        // A preview (focusTarget false) shows the terminal without taking
        // keyboard focus; only an explicit open focuses it.
        if (focusTarget)
          focusInspectorTerminal(worldInspectorWindowId(admittedConversation));
      }
    } catch (cause) {
      if (intentRequestRef.current === requestId) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    } finally {
      unbindAbort();
      if (intentRequestRef.current === requestId) setIntentOpening(false);
    }
    return true;
  };
  useLayoutEffect(() => {
    const focusPane = (windowId: string, paneId: string) => {
      const conversation = inspectorConversationsRef.current.find(
        (candidate) => worldInspectorWindowId(candidate) === windowId,
      );
      if (!conversation) return;
      const sibling = worldNodeForInspectorPaneFocus(
        aggregateWorld,
        conversation,
        paneId,
      );
      if (!sibling) return;
      if (windowId === dockedInspectorIdRef.current) {
        void applySelection(sibling.id, null, true, aggregateWorld);
      } else {
        void focusFloatingInspector(
          conversation,
          true,
          undefined,
          sibling,
        ).catch(() => undefined);
      }
    };
    onInspectorPaneFocusReady(focusPane);
    return () => onInspectorPaneFocusReady(null);
  });
  const notificationHandlerRef = useRef<
    (target: import("../taskNotifications").TaskNotificationTarget) => void
  >(() => {});
  const [inspectorClose, setInspectorClose] = useState<{
    conversation: WorldInspectorConversation;
    operations: ReturnType<typeof operationalStore>;
    target: { type: "pane" | "tab"; id: string };
  } | null>(null);
  notificationHandlerRef.current = (target) => {
    void store.focusTaskNotificationTarget(target).then((admitted) => {
      if (!admitted) return;
      void workspaceSurfaceSelectionHandlerRef.current({
        ...target,
        view: "terminal",
      });
    });
  };
  useEffect(() => {
    const receive = (event: Event) => {
      if (active)
        notificationHandlerRef.current(
          (
            event as CustomEvent<
              import("../taskNotifications").TaskNotificationTarget
            >
          ).detail,
        );
    };
    window.addEventListener("herdr-world:visual-notification", receive);
    return () =>
      window.removeEventListener("herdr-world:visual-notification", receive);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      const conversation =
        inspectorConversationsRef.current.find(
          (candidate) =>
            worldInspectorWindowId(candidate) === activeInspectorId,
        ) ??
        inspectorConversationsRef.current.find(
          (candidate) =>
            worldInspectorWindowId(candidate) === dockedInspectorIdRef.current,
        );
      if (
        !conversation ||
        document.querySelector(".modal-backdrop, .command-popover")
      )
        return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (
        element?.closest("input, select, [contenteditable=true]") ||
        (element?.closest("textarea") && !element.closest(".xterm"))
      )
        return;
      const owner = {
        connectionId: conversation.connectionId,
        runtimeGeneration: conversation.runtimeGeneration,
      };
      const operations = operationalStore(owner);
      const tabAction = tabShortcutAction(event);
      const paneAction = paneShortcutAction(event);
      let action: Promise<unknown> | undefined;
      if (tabAction === "close" && conversation.tabId) {
        event.preventDefault();
        event.stopPropagation();
        const target = closeShortcutTarget(
          conversation.tabId,
          operations.get().panes,
          conversation.paneId,
        );
        if (target) setInspectorClose({ conversation, operations, target });
        return;
      } else if (tabAction === "create") {
        if (event.repeat) return;
        action = store.createQualifiedTab(owner, conversation.workspaceId, {
          numberedLabel: true,
          sourcePaneId: conversation.paneId ?? undefined,
        });
      } else if (tabAction === "previous" || tabAction === "next") {
        const tabs = operations
          .get()
          .tabs.filter((tab) => tab.workspace_id === conversation.workspaceId);
        const id = adjacentTabId(tabs, conversation.tabId, tabAction);
        if (id)
          action = operations.focusTab(id).then(() => {
            const snapshot = operations.get();
            const pane = snapshot.panes.find(
              (candidate) =>
                candidate.tab_id === id &&
                candidate.pane_id === snapshot.selectedPaneId,
            );
            return pane
              ? workspaceSurfaceSelectionHandlerRef.current({
                  ...owner,
                  workspaceId: conversation.workspaceId,
                  paneId: pane.pane_id,
                  view: "terminal",
                })
              : false;
          });
      } else if (paneAction && conversation.paneId) {
        if (event.repeat && paneAction.type !== "focus") return;
        action =
          paneAction.type === "split"
            ? operations.splitPane(conversation.paneId, paneAction.direction)
            : paneAction.type === "zoom"
              ? operations.zoomPane(conversation.paneId)
              : operations.focusPaneDirection(
                  conversation.paneId,
                  paneAction.direction,
                );
      }
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      void action.catch((error) =>
        store.notify({
          kind: "error",
          message: "Inspector command failed",
          detail: String(error),
        }),
      );
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [active, activeInspectorId]);
  const selectNode = (id: string, signal?: AbortSignal) => {
    if (signal?.aborted) return Promise.resolve(false);
    const node = world.nodeById.get(id);
    const nodeId = id;
    if (
      view === "office" &&
      officeInspectorPresentation === "floating" &&
      window.innerWidth > 720 &&
      document.documentElement.dataset.layout !== "mobile" &&
      node?.kind !== "host" &&
      node?.actionable &&
      node.capabilities.openTerminal
    ) {
      const existing = inspectorConversationsRef.current.find(
        (conversation) =>
          worldInspectorWindowId(conversation) ===
          worldInspectorWindowIdForNode(node),
      );
      if (
        existing &&
        worldInspectorWindowId(existing) === dockedInspectorIdRef.current
      ) {
        return applySelection(nodeId, null, true, world, signal);
      }
      return openFloatingInspector(node, signal)
        .then(() => true)
        .catch((cause) => {
          if (!signal?.aborted) {
            setIntentError(
              cause instanceof Error ? cause.message : String(cause),
            );
          }
          return false;
        });
    }
    return applySelection(nodeId, null, true, world, signal);
  };
  const workspaceSurfaceSelectionHandlerRef = useRef<
    (selection: WorkspaceSurfaceSelection) => Promise<boolean>
  >(() => Promise.resolve(false));
  workspaceSurfaceSelectionHandlerRef.current = (surfaceSelection) => {
    if (surfaceSelection.signal?.aborted) return Promise.resolve(false);
    const node = worldNodeForWorkspaceSurfaceSelection(
      aggregateWorld,
      surfaceSelection,
    );
    if (node)
      return applySelection(
        node.id,
        surfaceSelection.view ?? null,
        true,
        aggregateWorld,
        surfaceSelection.signal,
        surfaceSelection.agentSessionId,
      );
    if (
      runtime.connections.find(
        ({ connectionId }) => connectionId === surfaceSelection.connectionId,
      )?.generation !== surfaceSelection.runtimeGeneration
    ) {
      return Promise.resolve(false);
    }
    const priority = snapshotPriorityForSurface(surfaceSelection);
    setPendingSurfacePriority(priority);
    return worldRuntimeStore
      .ensurePriorities([
        priority,
        ...inspectorConversations.map(snapshotPriorityForConversation),
      ])
      .then(() => {
        if (surfaceSelection.signal?.aborted) return false;
        const refreshedWorld = buildWorldObject(
          worldRuntimeStore.get().connections,
          connectionSelection.activeConnectionId,
        );
        const refreshedNode = worldNodeForWorkspaceSurfaceSelection(
          refreshedWorld,
          surfaceSelection,
        );
        return refreshedNode
          ? applySelection(
              refreshedNode.id,
              surfaceSelection.view ?? null,
              true,
              refreshedWorld,
              surfaceSelection.signal,
              surfaceSelection.agentSessionId,
            )
          : false;
      })
      .catch((cause) => {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
        return false;
      })
      .finally(() => setPendingSurfacePriority(null));
  };
  useLayoutEffect(() => {
    const handler = (surfaceSelection: WorkspaceSurfaceSelection) =>
      workspaceSurfaceSelectionHandlerRef.current(surfaceSelection);
    onWorkspaceSurfaceSelectionReady(handler);
    return () => onWorkspaceSurfaceSelectionReady(null);
  }, [onWorkspaceSurfaceSelectionReady]);

  const closeIntent = () => {
    intentRequestRef.current += 1;
    setIntentOpening(false);
    setIntentError(null);
    setSelection(null);
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
  };

  useEffect(() => {
    // A failed or timed-out aggregate observation cannot prove a tab closed.
    // The focused connection lease still retires windows on host/generation change.
    let changed = false;
    const retained = inspectorConversations.flatMap((conversation) => {
      const current = worldNodeForInspectorConversation(
        aggregateWorld,
        conversation,
      );
      const focusedTopology = connectionSnapshot(
        operationalSnapshot,
        conversation.connectionId,
      );
      const owner = operationalSnapshot.connections.find(
        (connection) => connection.id === conversation.connectionId,
      );
      // The World projection is bounded and can omit an open tab. Only the
      // focused Herdr list can confirm that its tab or workspace is gone.
      const focusedListIsCurrent =
        focusedTopology.status === "connected" &&
        focusedTopology.lastTopologyObservationStartedAt >
          (conversation.focusedListAdmissionAt ?? 0) &&
        focusedTopology.serverRuntimeGeneration ===
          conversation.runtimeGeneration;
      const stillOpen = conversation.tabId
        ? focusedTopology.tabs.some(
            (tab) =>
              tab.tab_id === conversation.tabId &&
              tab.workspace_id === conversation.workspaceId,
          )
        : focusedTopology.workspaces.some(
            (workspace) => workspace.workspace_id === conversation.workspaceId,
          );
      if (
        owner?.generation !== conversation.runtimeGeneration ||
        owner.state !== "ready" ||
        (focusedListIsCurrent && !stillOpen)
      ) {
        changed = true;
        return [];
      }
      if (
        !current ||
        current.generation !== conversation.runtimeGeneration ||
        !current.actionable
      ) {
        return [conversation];
      }
      const view = worldIntentInitialView(current, null);
      const context = worldInspectorContext(current);
      const observed =
        view && context
          ? worldInspectorForNode(
              current,
              view,
              worldIntentViews(current),
              context,
              {
                dock: conversation.dock,
                expanded: conversation.expanded,
                size: conversation.size,
              },
            )
          : null;
      if (!observed) {
        changed = true;
        return [];
      }
      const next = reconcileWorldInspectorConversation(conversation, observed);
      if (next !== conversation) changed = true;
      return [next];
    });
    if (changed) {
      const retainedIds = new Set(retained.map(worldInspectorWindowId));
      const selectedConversation = selection
        ? inspectorConversations.find(({ nodeId }) => nodeId === selection.id)
        : null;
      const selectedWindowId = selectedConversation
        ? worldInspectorWindowId(selectedConversation)
        : null;
      const selectedInspectorRetired =
        selectedWindowId !== null && !retainedIds.has(selectedWindowId);
      for (const conversation of inspectorConversations) {
        if (!retainedIds.has(worldInspectorWindowId(conversation))) {
          onInspectorTerminalPortal(worldInspectorWindowId(conversation), null);
        }
      }
      onInspectorConversationsChange((current) =>
        reconcileObservedInspectors(current, inspectorConversations, retained),
      );
      if (dockedInspectorId && !retainedIds.has(dockedInspectorId)) {
        onDockedInspectorIdChange(null);
      }
      if (selectedInspectorRetired) {
        intentRequestRef.current += 1;
        setIntentOpening(false);
        setIntentError(null);
        setSelection(null);
        setSelectedVisualAnchor(null);
        setVisualConversationAnchors(null);
      } else if (selectedWindowId) {
        const replacement = retained.find(
          (conversation) =>
            worldInspectorWindowId(conversation) === selectedWindowId,
        );
        if (replacement && replacement.nodeId !== selection?.id) {
          setSelection(world.nodeById.get(replacement.nodeId) ?? null);
        }
      }
    }
  }, [
    dockedInspectorId,
    intentRequestRef,
    operationalSnapshot,
    aggregateWorld,
    hasSelectedConnection,
    inspectorConversations,
    onDockedInspectorIdChange,
    onInspectorConversationsChange,
    onInspectorTerminalPortal,
    selectedWorldObservationActionable,
    selectedWorldConnection,
    selection,
    world,
  ]);

  const openFloatingInspector = async (
    node: WorldObjectNode,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) {
      throw new Error("Inspector activation was superseded");
    }
    const existing = inspectorConversations.find(
      (conversation) =>
        worldInspectorWindowId(conversation) ===
        worldInspectorWindowIdForNode(node),
    );
    if (existing) {
      const requestedView = existing.availableViews.includes("terminal")
        ? "terminal"
        : undefined;
      if (worldInspectorWindowId(existing) === dockedInspectorId) {
        if (
          !(await focusFloatingInspector(
            existing,
            true,
            requestedView,
            node,
            signal,
          ))
        ) {
          throw new Error("Inspector activation was superseded");
        }
        if (dockedInspectorIdRef.current === worldInspectorWindowId(existing)) {
          onDockedInspectorIdChange(null);
        }
        focusInspectorTerminal(worldInspectorWindowId(existing));
        return;
      }
      if (
        !(await focusFloatingInspector(
          existing,
          true,
          requestedView,
          node,
          signal,
        ))
      ) {
        throw new Error("Inspector activation was superseded");
      }
      focusInspectorTerminal(worldInspectorWindowId(existing));
      return;
    }
    const conversation = conversationFor(node, "terminal");
    if (!conversation) throw new Error("This Inspector is no longer available");
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setIntentOpening(true);
    const unbindAbort = bindSelectionIntentAbort(signal, requestId);
    try {
      await focusWorldNode(node);
      if (signal?.aborted || intentRequestRef.current !== requestId) {
        throw new Error("Inspector activation was superseded");
      }
      setSelection(node);
      const admittedConversation = {
        ...conversation,
        focusedListAdmissionAt: performance.now(),
      };
      const nextConversations = [
        ...inspectorConversationsRef.current,
        admittedConversation,
      ];
      inspectorConversationsRef.current = nextConversations;
      onInspectorConversationsChange(nextConversations);
      focusInspectorTerminal(worldInspectorWindowId(admittedConversation));
    } finally {
      unbindAbort();
      if (intentRequestRef.current === requestId) setIntentOpening(false);
    }
  };

  // Preview an agent in the Desk's reading pane without moving keyboard focus
  // out of the queue; opening (above) also focuses its terminal.
  const previewTerminalById = async (id: string) => {
    if (!world.nodeById.get(id)) return;
    await applySelection(id, "terminal", false, world);
  };
  const closeDeskReading = () => {
    if (contextRailInspector) closeInspector(contextRailInspector);
  };

  const openTerminalById = async (
    id: string,
    signal?: AbortSignal,
    candidateWorld = world,
  ) => {
    if (signal?.aborted) throw new Error("Terminal activation was superseded");
    const node = candidateWorld.nodeById.get(id);
    if (!node) throw new Error("This terminal is no longer available");
    try {
      const existing = inspectorConversationsRef.current.find(
        (conversation) =>
          worldInspectorWindowId(conversation) ===
          worldInspectorWindowIdForNode(node),
      );
      if (
        // On wide screens the Desk reads agents in the docked Inspector beside
        // its queue; phones keep the full-screen floating Inspector.
        (view === "desk" && deskReadingPane) ||
        (view === "office" &&
          (officeInspectorPresentation === "docked" ||
            (existing &&
              worldInspectorWindowId(existing) ===
                dockedInspectorIdRef.current)))
      ) {
        if (
          !(await applySelection(id, "terminal", true, candidateWorld, signal))
        ) {
          throw new Error("This terminal could not be opened");
        }
        return;
      }
      await openFloatingInspector(node, signal);
    } catch (cause) {
      if (!signal?.aborted)
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };
  useWorldCreatedTerminal({ active, intentRequestRef, openTerminalById });

  const closeInspector = (conversation: WorldInspectorConversation) => {
    intentRequestRef.current++;
    const remaining = inspectorConversationsRef.current.filter(
      (candidate) =>
        worldInspectorWindowId(candidate) !==
        worldInspectorWindowId(conversation),
    );
    inspectorConversationsRef.current = remaining;
    onInspectorConversationsChange(remaining);
    onInspectorTerminalPortal(worldInspectorWindowId(conversation), null);
    setFloatingInspectorPortals((current) => ({
      ...current,
      [worldInspectorWindowId(conversation)]: null,
    }));
    if (dockedInspectorIdRef.current === worldInspectorWindowId(conversation)) {
      dockedInspectorIdRef.current = null;
      onDockedInspectorIdChange(null);
    }
    if (selected?.id === conversation.nodeId) setSelection(null);
  };

  const focusFloatingInspector = async (
    conversation: WorldInspectorConversation,
    focusTarget = true,
    requestedView?: InspectorView,
    selectedNode?: WorldObjectNode,
    signal?: AbortSignal,
    reveal = true,
  ): Promise<boolean> => {
    if (signal?.aborted) return false;
    const target =
      selectedNode ?? aggregateWorld.nodeById.get(conversation.nodeId);
    if (!target) throw new Error("This Inspector is no longer available");
    const requestId = focusTarget
      ? intentRequestRef.current + 1
      : intentRequestRef.current;
    if (focusTarget) {
      intentRequestRef.current = requestId;
      setIntentError(null);
      setIntentOpening(true);
    }
    const unbindAbort = focusTarget
      ? bindSelectionIntentAbort(signal, requestId)
      : () => {};
    try {
      if (focusTarget) await focusWorldNode(target);
      if (signal?.aborted || intentRequestRef.current !== requestId)
        return false;
      const current = inspectorConversationsRef.current;
      const observedConversation = current.find(
        (candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation),
      );
      if (!observedConversation) return false;
      const observed = conversationFor(target, requestedView ?? null);
      if (!observed) return false;
      const reconciled = reconcileWorldInspectorConversation(
        observedConversation,
        observed,
      );
      const currentConversation =
        requestedView && reconciled.availableViews.includes(requestedView)
          ? { ...reconciled, view: requestedView }
          : reconciled;
      if (currentConversation !== observedConversation) {
        const nextConversations = current.map((candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation)
            ? currentConversation
            : candidate,
        );
        inspectorConversationsRef.current = nextConversations;
        onInspectorConversationsChange(nextConversations);
      }
      setSelection(target);
      raiseInspector(worldInspectorWindowId(conversation));
      if (focusTarget && reveal) {
        revealInspector(worldInspectorWindowId(conversation));
      }
      if (focusTarget && currentConversation.view === "terminal") {
        focusInspectorTerminal(worldInspectorWindowId(conversation));
      }
      return true;
    } catch (cause) {
      if (intentRequestRef.current === requestId) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      }
      throw cause;
    } finally {
      unbindAbort();
      if (focusTarget && intentRequestRef.current === requestId) {
        setIntentOpening(false);
      }
    }
  };

  const retireInspectors = () => {
    for (const conversation of inspectorConversations) {
      onInspectorTerminalPortal(worldInspectorWindowId(conversation), null);
    }
    onInspectorConversationsChange([]);
    onDockedInspectorIdChange(null);
  };

  const selectedLeaseCurrent =
    selected &&
    connectionSelection.connections.some(
      (owner) =>
        owner.id === selected.connectionId &&
        owner.state === "ready" &&
        owner.generation === selected.generation,
    );
  useEffect(() => {
    if (
      selected &&
      (!selectedLeaseCurrent || shouldCloseWorldInspector(selected))
    ) {
      intentRequestRef.current += 1;
      setIntentOpening(false);
    }
  }, [selectedLeaseCurrent, selected, intentRequestRef]);

  const showSelectionProfile = Boolean(
    selected &&
      (selected.kind === "host" ||
        !currentSelectionGeneration ||
        !selected.actionable),
  );
  return {
    ...props,
    watchlistStore,
    watchlist,
    pinnedOnly,
    setPinnedOnly,
    deskReadingPane,
    connectionSelection,
    operationalSnapshot,
    hostsFilter,
    aggregateWorld,
    world,
    presentedWorld,
    setSelection,
    watchStatus,
    intentRequestRef,
    creationProgress,
    inspectorFocusIntentRef,
    contextRailRef,
    floatingInspectorPortals,
    setFloatingInspectorPortals,
    intentOpening,
    setIntentOpening,
    intentError,
    setIntentError,
    setSelectedVisualAnchor,
    visualConversationAnchors,
    setVisualConversationAnchors,
    floatingWindowAnchors,
    setFloatingWindowAnchors,
    worldViewLayoutRef,
    inspectorConversationsRef,
    currentSelectionGeneration,
    selected,
    selectedId,
    setWindowLayer,
    windowStage,
    compactArrangement,
    managedWindows,
    windowCommand,
    contextRailInspector,
    visibleFloatingInspectorIds,
    visibleFloatingInspectors,
    raiseInspector,
    revealInspector,
    conversationNodeIds,
    applySelection,
    inspectorClose,
    setInspectorClose,
    selectNode,
    closeIntent,
    previewTerminalById,
    closeDeskReading,
    openTerminalById,
    closeInspector,
    focusFloatingInspector,
    retireInspectors,
    showSelectionProfile,
  };
}

export type WorldInspectorController = ReturnType<
  typeof useWorldInspectorController
>;
