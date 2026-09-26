import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import App, {
  measuredFixedPositionScale,
  type WorkspaceSurfaceSelection,
} from "../App";
import { bridge, type ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import {
  WINDOW_ARRANGEMENT_CHOICES,
  type WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import { shortcutMatches } from "../shortcutPreferences";
import { lazyWithReload } from "../lazyWithReload";
import { shallowEqual, store, useStoreSelector } from "../store";
import {
  type InspectorView,
  readInspectorPreferences,
  resourceScopeForWorkspace,
  type WorkspaceInspectorContext,
  WORLD_OBSERVABILITY_SETTINGS_EVENT,
  WORLD_OBSERVABILITY_UPDATED_EVENT,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type WorkspaceInspectorRequest,
  writeInspectorPreferences,
} from "../workspaceResource";
import {
  useWorldRuntime,
  worldRuntimeStore,
  type WorldRuntimePriority,
} from "./runtimeStore";
import {
  buildWorldObject,
  type WorldHostObject,
  type WorldObject,
  type WorldObjectNode,
  worldObjectForConnection,
  worldObjectForWatches,
  worldObjectWithWatches,
} from "./worldObject";
import { useWorldWatchlist, WorldWatchlistStore } from "./watchlistStore";
import "./world.css";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  type OfficeInspectorPresentation,
} from "./officePreferences";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import WorldIntentProfile from "./WorldIntentProfile";
import { VisualRouteActions } from "./VisualRouteActionsMenu";
import { useSpacesTabWindowArrangement } from "./useSpacesTabWindowArrangement";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import { WorldConnectionRequired, WorldTopbarStatus } from "./WorldStatus";
import {
  defaultFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import {
  terminalWindowArrangementReason,
  type TerminalWindowArrangementPreset,
  type TerminalWindowArrangementStage,
} from "./terminalWindowArrangement";
import {
  applyTerminalWindowArrangement,
  createTerminalWindowArrangementState,
  restoreTerminalWindowArrangement,
  retainTerminalWindowArrangementWindows,
  terminalWindowArrangementForLease,
  terminalWindowArrangementPlacements,
  updateTerminalWindowArrangementGeometry,
  type TerminalWindowArrangementParticipant,
} from "./terminalWindowArrangementState";
import {
  reconcileWorldInspectorConversation,
  retainWorldInspectorConversations,
  worldInspectorForNode,
  worldInspectorWindowId,
  worldInspectorWindowIdForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

export {
  retainWorldFloatingTerminals,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";

const PixelOfficeView = lazyWithReload(
  "world-pixel-office",
  () => import("./PixelOfficeView"),
);
const ConnectedTreeView = lazyWithReload(
  "world-connected-tree",
  () => import("./ConnectedTreeView"),
);
const SpatialGraphView = lazyWithReload(
  "world-spatial-graph",
  () => import("./SpatialGraphView"),
);
const WorldIntentConnector = lazyWithReload(
  "world-intent-connector",
  () => import("./WorldIntentConnector"),
);
const WorldViewErrorBoundary = lazyWithReload("world-view-boundary", () =>
  import("./WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);
const WorldFloatingTerminalWindow = lazyWithReload(
  "world-floating-inspector",
  () => import("./WorldFloatingTerminal"),
);
const OfficeObservabilityDialog = lazyWithReload("world-observability", () =>
  import("./PixelOfficeView").then((module) => ({
    default: module.OfficeObservabilityDialog,
  })),
);

export type WorldView = "spaces" | "office" | "tree" | "graph";

const SELECTED_CONNECTION_KEY = "worldSelectedConnection";
const WORLD_VIEWS: readonly WorldView[] = ["office", "spaces", "tree", "graph"];
const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  spaces: "/spaces",
  office: "/office",
  tree: "/tree",
  graph: "/graph",
};

type DockedInspectorGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type DockedInspectorMove = {
  pointerId: number;
  startX: number;
  startY: number;
  geometry: DockedInspectorGeometry;
};

type VisualInspectorPresentation =
  | { kind: "floating" }
  | { kind: "docked" }
  | { kind: "inline"; leafId: string };

const VISUAL_ARRANGEMENT_SCOPE = "visual";

export function visualInspectorArrangementStage(
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  fixedPositionScale = 1,
): TerminalWindowArrangementStage {
  return {
    left: bounds.left / fixedPositionScale + 8,
    top: bounds.top / fixedPositionScale + 8,
    width: Math.max(0, bounds.width / fixedPositionScale - 16),
    height: Math.max(0, bounds.height / fixedPositionScale - 16),
  };
}

export function fitVisualInspectorArrangementGeometry(
  geometry: FloatingTerminalGeometry,
  stage: TerminalWindowArrangementStage,
): FloatingTerminalGeometry {
  const width = Math.min(geometry.width, stage.width);
  const height = Math.min(geometry.height, stage.height);
  return {
    left: Math.max(
      stage.left,
      Math.min(geometry.left, stage.left + stage.width - width),
    ),
    top: Math.max(
      stage.top,
      Math.min(geometry.top, stage.top + stage.height - Math.min(height, 56)),
    ),
    width,
    height,
  };
}

export function moveDockedInspectorGeometry(
  geometry: DockedInspectorGeometry,
  deltaX: number,
  deltaY: number,
  bounds: { left?: number; top?: number; width: number; height: number },
): DockedInspectorGeometry {
  const minimumLeft = bounds.left ?? 0;
  const minimumTop = bounds.top ?? 0;
  return {
    ...geometry,
    left: Math.max(
      minimumLeft,
      Math.min(
        geometry.left + deltaX,
        Math.max(minimumLeft, minimumLeft + bounds.width - geometry.width),
      ),
    ),
    top: Math.max(
      minimumTop,
      Math.min(
        geometry.top + deltaY,
        Math.max(minimumTop, minimumTop + bounds.height - geometry.height),
      ),
    ),
  };
}

function inspectorViewportBounds() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
  };
}

export function parseWorldView(value: unknown): WorldView {
  return WORLD_VIEWS.includes(value as WorldView)
    ? (value as WorldView)
    : "office";
}

export function worldViewFromPath(pathname: string): WorldView {
  if (pathname === "/spaces") return "spaces";
  if (pathname === "/tree") return "tree";
  if (pathname === "/graph") return "graph";
  return "office";
}

export function worldSelectionIsCurrent(
  selected: WorldObjectNode | null,
  current: WorldObjectNode | null | undefined,
) {
  return selected !== null && current?.generation === selected.generation;
}

export function worldNodeForWorkspaceSurfaceSelection(
  world: WorldObject,
  selection: WorkspaceSurfaceSelection,
): WorldObjectNode | null {
  return (
    world.nodes.find((candidate) => {
      if (
        !candidate.selectedHost ||
        candidate.connectionId !== selection.connectionId ||
        candidate.generation !== selection.runtimeGeneration
      ) {
        return false;
      }
      if (selection.paneId) {
        return (
          (candidate.kind === "agent" || candidate.kind === "terminal") &&
          candidate.nativeId === selection.paneId &&
          candidate.workspaceId === selection.workspaceId
        );
      }
      return (
        candidate.kind === "space" &&
        candidate.nativeId === selection.workspaceId
      );
    }) ?? null
  );
}

export function worldNodeForInspectorConversation(
  world: WorldObject,
  conversation: WorldInspectorConversation,
): WorldObjectNode | null {
  const valid = (node: WorldObjectNode) =>
    node.actionable &&
    node.selectedHost &&
    node.connectionId === conversation.connectionId &&
    node.generation === conversation.runtimeGeneration &&
    worldInspectorWindowIdForNode(node) ===
      worldInspectorWindowId(conversation);
  const selected = world.nodeById.get(conversation.nodeId);
  if (selected && valid(selected)) return selected;
  if (!conversation.tabId) return null;
  const siblings = world.leaves.filter(valid);
  return siblings.find((node) => node.focused) ?? siblings[0] ?? null;
}

export function worldNodeForInspectorPaneFocus(
  world: WorldObject,
  conversation: WorldInspectorConversation,
  paneId: string,
) {
  if (!conversation.tabId) return null;
  const windowId = worldInspectorWindowId(conversation);
  return (
    world.leaves.find(
      (node) =>
        node.nativeId === paneId &&
        node.actionable &&
        node.selectedHost &&
        worldInspectorWindowIdForNode(node) === windowId,
    ) ?? null
  );
}

export function worldIntentViews(node: WorldObjectNode): InspectorView[] {
  if (node.kind === "host") return [];
  return [
    ...(node.capabilities.openTerminal ? (["terminal"] as const) : []),
    ...(node.capabilities.files ? (["files"] as const) : []),
    ...(node.capabilities.changes ? (["changes"] as const) : []),
    ...(node.kind === "agent" && node.capabilities.agentHistory
      ? (["history"] as const)
      : []),
  ];
}

export function worldInspectorContext(
  node: WorldObjectNode,
): WorkspaceInspectorContext | null {
  if (node.kind === "host") return null;
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  const statusLabel = leaf
    ? (leaf.stateLabels[leaf.status] ?? leaf.status)
    : hostStateLabel(node.hostState);
  return {
    kind: node.kind,
    label: node.label,
    stateLabel: statusLabel,
    locationLabel: leaf
      ? `${leaf.spaceLabel} · ${node.hostLabel}`
      : node.hostLabel,
    ...(leaf?.kind === "agent" ? { agent: leaf.pane.agent } : {}),
    ...(leaf?.taskSummary ? { taskSummary: leaf.taskSummary } : {}),
  };
}

export function worldIntentInitialView(
  node: WorldObjectNode,
  preferred: InspectorView | null,
): InspectorView | null {
  const views = worldIntentViews(node);
  if (preferred && views.includes(preferred)) return preferred;
  if (views.includes("terminal")) return "terminal";
  return views[0] ?? null;
}

export function worldSnapshotPriorityForNode(
  node: WorldObjectNode,
): WorldRuntimePriority | null {
  if (node.kind === "host") return null;
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return {
    connectionId: node.connectionId,
    workspaceId: leaf?.workspaceId ?? node.nativeId,
    ...(leaf ? { paneId: leaf.nativeId, terminalId: leaf.terminalId } : {}),
  };
}

function snapshotPriorityForConversation(
  conversation: WorldInspectorConversation,
): WorldRuntimePriority {
  return {
    connectionId: conversation.connectionId,
    workspaceId: conversation.workspaceId,
    ...(conversation.paneId ? { paneId: conversation.paneId } : {}),
    ...(conversation.terminalId ? { terminalId: conversation.terminalId } : {}),
  };
}

function snapshotPriorityForSurface(
  selection: WorkspaceSurfaceSelection,
): WorldRuntimePriority {
  return {
    connectionId: selection.connectionId,
    workspaceId: selection.workspaceId,
    ...(selection.paneId ? { paneId: selection.paneId } : {}),
  };
}

function initialView() {
  return worldViewFromPath(window.location.pathname);
}

export default function WorldFoundationApp() {
  const [view, setViewState] = useState<WorldView>(initialView);
  const spaces = useSpacesTabWindowArrangement(view === "spaces");
  const [visualView, setVisualView] = useState<Exclude<WorldView, "spaces">>(
    () => {
      const initial = initialView();
      return initial === "spaces" ? "office" : initial;
    },
  );
  const [topbarPortal, setTopbarPortal] = useState<HTMLElement | null>(null);
  const [viewToolbarPortal, setViewToolbarPortal] =
    useState<HTMLDivElement | null>(null);
  const [visualArrangementControl, setVisualArrangementControl] = useState<
    WindowArrangementControl | undefined
  >();
  const [inspectorConversations, setInspectorConversations] = useState<
    WorldInspectorConversation[]
  >([]);
  const [dockedInspectorId, setDockedInspectorId] = useState<string | null>(
    null,
  );
  const [inspectorTerminalPortals, setInspectorTerminalPortals] = useState<
    Record<string, HTMLDivElement | null>
  >({});
  const [officeMetricsOpen, setOfficeMetricsOpen] = useState(false);
  const workspaceSurfaceSelectionRef = useRef<
    ((selection: WorkspaceSurfaceSelection) => Promise<boolean>) | null
  >(null);
  const inspectorPaneFocusRef = useRef<
    ((windowId: string, paneId: string) => void) | null
  >(null);
  const registerWorkspaceSurfaceSelection = useCallback(
    (
      handler:
        | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
        | null,
    ) => {
      workspaceSurfaceSelectionRef.current = handler;
    },
    [],
  );
  const topbarRuntime = useWorldRuntime();
  const topbarConnectionId = useStoreSelector(
    (snapshot) => snapshot.activeConnectionId,
  );
  const topbarWorld = useMemo(
    () =>
      worldObjectForConnection(
        buildWorldObject(topbarRuntime.connections, topbarConnectionId),
        topbarConnectionId,
      ),
    [topbarConnectionId, topbarRuntime.connections],
  );
  const activeConversationLease = useStoreSelector(
    (snapshot) => ({
      connectionId: snapshot.activeConnectionId,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
    }),
    shallowEqual,
  );
  const workspaceSurfaceInspectorConversation =
    inspectorConversations.find(
      (conversation) =>
        worldInspectorWindowId(conversation) === dockedInspectorId,
    ) ?? inspectorConversations[inspectorConversations.length - 1];
  const changeWorkspaceSurfaceInspectorView = useCallback(
    (nextView: InspectorView) => {
      const conversation = workspaceSurfaceInspectorConversation;
      if (!conversation?.availableViews.includes(nextView)) return;
      setInspectorConversations((current) =>
        current.map((candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation)
            ? { ...candidate, view: nextView }
            : candidate,
        ),
      );
      const workspace = store
        .get()
        .workspaces.find(
          (candidate) => candidate.workspace_id === conversation.workspaceId,
        );
      if (!workspace) return;
      writeInspectorPreferences(worldLocalStorage, {
        scope: resourceScopeForWorkspace(conversation.connectionId, workspace),
        open: true,
        view: nextView,
        availableViews: conversation.availableViews,
        dock: conversation.dock,
        size: conversation.size,
        expanded: conversation.expanded,
        ...(conversation.paneId ? { originPaneId: conversation.paneId } : {}),
      });
    },
    [workspaceSurfaceInspectorConversation],
  );

  useLayoutEffect(() => {
    const lease =
      activeConversationLease.connectionId &&
      activeConversationLease.runtimeGeneration !== null
        ? {
            connectionId: activeConversationLease.connectionId,
            runtimeGeneration: activeConversationLease.runtimeGeneration,
          }
        : null;
    const retained = retainWorldInspectorConversations(
      inspectorConversations,
      lease,
    );
    if (retained.length === inspectorConversations.length) return;
    const retainedIds = new Set(retained.map(worldInspectorWindowId));
    setInspectorConversations(retained);
    setDockedInspectorId((current) =>
      current && retainedIds.has(current) ? current : null,
    );
    setInspectorTerminalPortals((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => retainedIds.has(nodeId)),
      ),
    );
  }, [activeConversationLease, inspectorConversations]);

  useEffect(() => {
    worldRuntimeStore.start();
    return () => worldRuntimeStore.stop();
  }, []);

  useEffect(() => {
    const open = () => setOfficeMetricsOpen(true);
    window.addEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
    return () =>
      window.removeEventListener(WORLD_OBSERVABILITY_SETTINGS_EVENT, open);
  }, []);

  useEffect(() => {
    if (window.location.pathname === "/") {
      const url = new URL(window.location.href);
      url.pathname = WORLD_VIEW_PATHS[view];
      window.history.replaceState(window.history.state, "", url);
    }
    const onPopState = () => {
      const next = worldViewFromPath(window.location.pathname);
      setViewState(next);
      if (next !== "spaces") setVisualView(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);

  const setView = (next: WorldView) => {
    setViewState(next);
    if (next !== "spaces") setVisualView(next);
    if (window.location.pathname !== WORLD_VIEW_PATHS[next]) {
      const url = new URL(window.location.href);
      url.pathname = WORLD_VIEW_PATHS[next];
      window.history.pushState(window.history.state, "", url);
    }
    if (next === "spaces") {
      requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    }
  };

  const activeArrangementControl =
    view === "spaces" ? spaces.arrangementControl : visualArrangementControl;
  useEffect(() => {
    if (!activeArrangementControl) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector(
          '.modal-backdrop, .command-popover, .context-menu, .pane-jump-backdrop, [role="menu"]',
        )
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !target.closest(".xterm") &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      const choice = WINDOW_ARRANGEMENT_CHOICES.find(({ shortcutId }) =>
        shortcutMatches(event, shortcutId),
      );
      if (!choice) return;
      event.preventDefault();
      event.stopPropagation();
      if (!activeArrangementControl.disabledReasons[choice.command])
        activeArrangementControl.onSelect(choice.command);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeArrangementControl]);

  return (
    <div className="world-foundation-shell">
      <div className="world-topbar-host" ref={setTopbarPortal} />
      <div className="world-spaces-layer is-active">
        <App
          operationalShortcutsEnabled={view === "spaces"}
          topbarPortal={topbarPortal}
          primaryViewControl={
            <div className="world-topbar-control-plane">
              <label className="world-primary-view-select">
                <select
                  aria-label="World view"
                  value={view}
                  onChange={(event) => setView(event.target.value as WorldView)}
                >
                  {WORLD_VIEWS.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate[0].toUpperCase() + candidate.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              {view !== "spaces" ? (
                <>
                  <WorldTopbarStatus
                    runtime={topbarRuntime}
                    world={topbarWorld}
                    selectedHostLabel={selectedHostStatusLabel(
                      topbarWorld.hosts.find(
                        ({ connectionId }) =>
                          connectionId === topbarConnectionId,
                      ) ?? null,
                    )}
                  />
                  <div
                    className="world-view-toolbar-host"
                    ref={setViewToolbarPortal}
                  />
                </>
              ) : null}
            </div>
          }
          workspaceSurface={
            <WorldControlPlane
              view={visualView}
              active={view !== "spaces"}
              inspectorConversations={inspectorConversations}
              dockedInspectorId={dockedInspectorId}
              onDockedInspectorIdChange={setDockedInspectorId}
              onInspectorConversationsChange={setInspectorConversations}
              onInspectorTerminalPortal={(windowId, portal) =>
                setInspectorTerminalPortals((current) =>
                  current[windowId] === portal
                    ? current
                    : { ...current, [windowId]: portal },
                )
              }
              onWorkspaceSurfaceSelectionReady={
                registerWorkspaceSurfaceSelection
              }
              onInspectorPaneFocusReady={(handler) => {
                inspectorPaneFocusRef.current = handler;
              }}
              onVisualArrangementControlReady={setVisualArrangementControl}
              viewToolbarPortal={viewToolbarPortal}
              onGoToSpaces={() => setView("spaces")}
            />
          }
          workspaceSurfaceVisible={view !== "spaces"}
          arrangementControl={activeArrangementControl}
          spacesTabWindows={spaces.spacesTabWindows}
          onFocusSpacesTabWindow={spaces.onFocusSpacesTabWindow}
          onSpacesWindowLayerReady={spaces.onSpacesWindowLayerReady}
          workspaceSurfaceInspector={
            view !== "spaces" && workspaceSurfaceInspectorConversation
              ? {
                  view: workspaceSurfaceInspectorConversation.view,
                  availableViews:
                    workspaceSurfaceInspectorConversation.availableViews,
                  onViewChange: changeWorkspaceSurfaceInspectorView,
                }
              : null
          }
          onWorkspaceSurfaceSelect={
            view !== "spaces"
              ? (selection) =>
                  workspaceSurfaceSelectionRef.current?.(selection) ??
                  Promise.resolve(false)
              : undefined
          }
          worldTerminalPresentations={
            view === "spaces"
              ? []
              : inspectorConversations.flatMap((conversation) =>
                  conversation.tabId &&
                  conversation.paneId &&
                  conversation.terminalId
                    ? [
                        {
                          ...conversation,
                          tabId: conversation.tabId,
                          paneId: conversation.paneId,
                          terminalId: conversation.terminalId,
                          portal:
                            inspectorTerminalPortals[
                              worldInspectorWindowId(conversation)
                            ] ?? null,
                          onFocusPane: (paneId: string) =>
                            inspectorPaneFocusRef.current?.(
                              worldInspectorWindowId(conversation),
                              paneId,
                            ),
                        },
                      ]
                    : [],
                )
          }
        />
        {spaces.renderWindows}
      </div>
      {officeMetricsOpen
        ? createPortal(
            <Suspense fallback={null}>
              <OfficeObservabilityDialog
                onClose={() => setOfficeMetricsOpen(false)}
                onSaved={() =>
                  window.dispatchEvent(
                    new Event(WORLD_OBSERVABILITY_UPDATED_EVENT),
                  )
                }
              />
            </Suspense>,
            document.body,
          )
        : null}
    </div>
  );
}

function WorldControlPlane({
  view,
  active,
  inspectorConversations,
  dockedInspectorId,
  onDockedInspectorIdChange,
  onInspectorConversationsChange,
  onInspectorTerminalPortal,
  onWorkspaceSurfaceSelectionReady,
  onInspectorPaneFocusReady,
  onVisualArrangementControlReady,
  viewToolbarPortal,
  onGoToSpaces,
}: {
  view: Exclude<WorldView, "spaces">;
  active: boolean;
  inspectorConversations: readonly WorldInspectorConversation[];
  dockedInspectorId: string | null;
  onDockedInspectorIdChange(windowId: string | null): void;
  onInspectorConversationsChange(
    conversations: WorldInspectorConversation[],
  ): void;
  onInspectorTerminalPortal(
    windowId: string,
    element: HTMLDivElement | null,
  ): void;
  onWorkspaceSurfaceSelectionReady(
    handler:
      | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
      | null,
  ): void;
  onInspectorPaneFocusReady(
    handler: ((windowId: string, paneId: string) => void) | null,
  ): void;
  onVisualArrangementControlReady(
    control: WindowArrangementControl | undefined,
  ): void;
  viewToolbarPortal: HTMLDivElement | null;
  onGoToSpaces(): void;
}) {
  const runtime = useWorldRuntime();
  const watchlistStore = useMemo(() => new WorldWatchlistStore(bridge), []);
  const watchlist = useWorldWatchlist(watchlistStore);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  useEffect(() => {
    watchlistStore.start();
    return () => watchlistStore.stop();
  }, [watchlistStore]);
  const connectionSelection = useStoreSelector(
    (snapshot) => ({
      activeConnectionId: snapshot.activeConnectionId,
      connections: snapshot.connections,
      defaultConnectionId: snapshot.defaultConnectionId,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
      status: snapshot.status,
    }),
    shallowEqual,
  );
  const selectionRestoredRef = useRef(false);
  const [selectionRestored, setSelectionRestored] = useState(false);

  useEffect(() => {
    if (connectionSelection.connections.length === 0) {
      selectionRestoredRef.current = false;
      setSelectionRestored(false);
      return;
    }
    if (!selectionRestoredRef.current) {
      let storedConnectionId: string | null = null;
      try {
        storedConnectionId = worldLocalStorage.getItem(SELECTED_CONNECTION_KEY);
      } catch {
        // Restricted storage falls back to the managed default/current profile.
      }
      const restoredConnectionId = chooseWorldSelectedConnection({
        activeConnectionId: connectionSelection.activeConnectionId,
        defaultConnectionId: connectionSelection.defaultConnectionId,
        storedConnectionId,
        connections: connectionSelection.connections,
      });
      if (
        restoredConnectionId &&
        restoredConnectionId !== connectionSelection.activeConnectionId
      ) {
        store.selectConnection(restoredConnectionId);
      }
      selectionRestoredRef.current = true;
      setSelectionRestored(true);
      return;
    }
    if (
      hasValidSelectedConnection(
        connectionSelection.activeConnectionId,
        connectionSelection.connections,
      )
    ) {
      try {
        worldLocalStorage.setItem(
          SELECTED_CONNECTION_KEY,
          connectionSelection.activeConnectionId,
        );
      } catch {
        // Selection remains valid for this session when storage is unavailable.
      }
    }
  }, [connectionSelection]);

  const hasSelectedConnection =
    selectionRestored &&
    hasValidSelectedConnection(
      connectionSelection.activeConnectionId,
      connectionSelection.connections,
    );
  const aggregateWorld = useMemo(
    () =>
      buildWorldObject(
        runtime.connections,
        hasSelectedConnection ? connectionSelection.activeConnectionId : null,
      ),
    [
      connectionSelection.activeConnectionId,
      hasSelectedConnection,
      runtime.connections,
    ],
  );
  const world = useMemo(
    () =>
      worldObjectForConnection(
        aggregateWorld,
        hasSelectedConnection ? connectionSelection.activeConnectionId : null,
      ),
    [
      aggregateWorld,
      connectionSelection.activeConnectionId,
      hasSelectedConnection,
    ],
  );
  const watchedWorld = useMemo(
    () => worldObjectWithWatches(world, watchlist.records),
    [watchlist.records, world],
  );
  const presentedWorld = useMemo(
    () =>
      pinnedOnly
        ? worldObjectForWatches(watchedWorld, watchlist.records)
        : watchedWorld,
    [pinnedOnly, watchedWorld, watchlist.records],
  );
  const [selection, setSelection] = useState<WorldObjectNode | null>(null);
  const selectedWatch =
    selection && (selection.kind === "agent" || selection.kind === "terminal")
      ? {
          connectionId: selection.connectionId,
          generation: selection.generation,
          terminalId: selection.terminalId,
          label: selection.label,
        }
      : null;
  const selectedPinned = Boolean(
    selectedWatch &&
      watchlist.records.some(
        (watch) =>
          watch.connectionId === selectedWatch.connectionId &&
          watch.generation === selectedWatch.generation &&
          watch.terminalId === selectedWatch.terminalId,
      ),
  );
  const watchAdmission = runtime.connections.find(
    ({ connectionId }) =>
      connectionId === connectionSelection.activeConnectionId,
  )?.snapshot?.watchAdmission;
  const watchStatus = watchlist.error
    ? watchlist.error
    : !watchlist.verified
      ? "Watches unavailable while disconnected"
      : !watchAdmission || watchAdmission.revision !== watchlist.revision
        ? "Watch availability pending"
        : `${watchAdmission.registered} pinned · ${watchAdmission.admitted} admitted · ${watchAdmission.missing} missing · ${watchAdmission.unresolved} unresolved · ${watchAdmission.admissionFailed} not admitted`;
  const watchToolbarActions = (
    <>
      <button
        type="button"
        aria-pressed={pinnedOnly}
        onClick={() => setPinnedOnly((value) => !value)}
      >
        Pinned only
      </button>
      <span className="world-view-toolbar-results" aria-live="polite">
        {watchStatus}
      </span>
      {selectedWatch ? (
        <button
          type="button"
          disabled={
            !watchlist.verified || (!selectedPinned && !selection?.actionable)
          }
          title={watchlist.error ?? undefined}
          onClick={() =>
            void watchlistStore.mutate(
              selectedPinned ? "world.watchlist.unpin" : "world.watchlist.pin",
              selectedWatch,
            )
          }
        >
          {selectedPinned ? "Unpin" : "Pin"}
        </button>
      ) : null}
    </>
  );
  const [officeInspectorPresentation, setOfficeInspectorPresentation] =
    useState<OfficeInspectorPresentation>(
      () => readOfficePreferences(worldLocalStorage).inspectorPresentation,
    );
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as
              | { inspectorPresentation?: OfficeInspectorPresentation }
              | undefined)
          : undefined;
      setOfficeInspectorPresentation(
        detail?.inspectorPresentation ??
          readOfficePreferences(worldLocalStorage).inspectorPresentation,
      );
    };
    window.addEventListener(WORLD_OFFICE_PREFERENCES_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(
        WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
        refresh,
      );
  }, []);
  const [pendingSurfacePriority, setPendingSurfacePriority] =
    useState<WorldRuntimePriority | null>(null);
  const intentRequestRef = useRef(0);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const dockedInspectorMoveRef = useRef<DockedInspectorMove | null>(null);
  const [dockedInspectorGeometry, setDockedInspectorGeometry] =
    useState<DockedInspectorGeometry | null>(null);
  const dockedInspectorGeometryRef = useRef<DockedInspectorGeometry | null>(
    null,
  );
  const [dockedInspectorMoving, setDockedInspectorMoving] = useState(false);
  const [contextRailInspectorPortal, setContextRailInspectorPortal] =
    useState<HTMLElement | null>(null);
  const [treeInlineInspectorPortal, setTreeInlineInspectorPortal] =
    useState<HTMLDivElement | null>(null);
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
  const [floatingWindowGeometries, setFloatingWindowGeometries] = useState<
    Record<string, FloatingTerminalGeometry>
  >({});
  const [visualArrangementState, setVisualArrangementState] = useState(() =>
    createTerminalWindowArrangementState<VisualInspectorPresentation>(""),
  );
  const [visualArrangementStage, setVisualArrangementStage] =
    useState<TerminalWindowArrangementStage>({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  const [excludedArrangementIds, setExcludedArrangementIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [singleManualGeometry, setSingleManualGeometry] = useState<
    Record<string, FloatingTerminalGeometry>
  >({});
  const [inlineReturnNodeId, setInlineReturnNodeId] = useState<string | null>(
    null,
  );
  const worldViewLayoutRef = useRef<HTMLDivElement | null>(null);
  const [intentOverlayAnchor, setIntentOverlayAnchor] =
    useState<WorldConnectorTargetBounds | null>(null);
  const inspectorConversationsRef = useRef(inspectorConversations);
  const dockedInspectorIdRef = useRef(dockedInspectorId);
  const floatingInspectorPortalsRef = useRef(floatingInspectorPortals);
  inspectorConversationsRef.current = inspectorConversations;
  dockedInspectorIdRef.current = dockedInspectorId;
  floatingInspectorPortalsRef.current = floatingInspectorPortals;
  const currentSelection = selection
    ? (world.nodeById.get(selection.id) ?? null)
    : null;
  const currentSelectionGeneration = worldSelectionIsCurrent(
    selection,
    currentSelection,
  );
  const selected = currentSelectionGeneration ? currentSelection : selection;
  const selectedId = currentSelectionGeneration
    ? (selection?.id ?? null)
    : null;
  const dockedInspector = inspectorConversations.find(
    (conversation) =>
      worldInspectorWindowId(conversation) === dockedInspectorId,
  );
  const dockedInspectorNode = dockedInspector
    ? (world.nodeById.get(dockedInspector.nodeId) ?? null)
    : null;
  const naturalTreeInlineInspectorNodeId =
    view === "tree" &&
    dockedInspectorNode &&
    (dockedInspectorNode.kind === "agent" ||
      dockedInspectorNode.kind === "terminal")
      ? dockedInspectorNode.id
      : null;
  const floatingInspectors = useMemo(
    () =>
      inspectorConversations.filter(
        (conversation) =>
          worldInspectorWindowId(conversation) !== dockedInspectorId,
      ),
    [dockedInspectorId, inspectorConversations],
  );
  const visualLeaseKey = JSON.stringify([
    connectionSelection.activeConnectionId,
    connectionSelection.runtimeGeneration,
  ]);
  const arrangementScope =
    visualArrangementState.leaseKey === visualLeaseKey
      ? visualArrangementState.scopes[VISUAL_ARRANGEMENT_SCOPE]
      : undefined;
  const compactArrangement =
    window.innerWidth <= 720 ||
    document.documentElement.dataset.layout === "mobile";
  const visualWindows = useMemo(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return inspectorConversations.map((conversation, index) => {
      const id = worldInspectorWindowId(conversation);
      const docked = id === dockedInspectorId;
      const inline =
        docked && view === "tree" && naturalTreeInlineInspectorNodeId !== null;
      const measured = docked
        ? (inline
            ? treeInlineInspectorPortal
            : contextRailRef.current
          )?.getBoundingClientRect()
        : null;
      const geometry = docked
        ? (dockedInspectorGeometry ??
          (measured && measured.width > 0 && measured.height > 0
            ? {
                left: measured.left,
                top: measured.top,
                width: measured.width,
                height: measured.height,
              }
            : (arrangementScope?.baselines[id]?.geometry ??
              defaultFloatingTerminalGeometry(index, viewport))))
        : (floatingWindowGeometries[id] ??
          arrangementScope?.baselines[id]?.geometry ??
          defaultFloatingTerminalGeometry(index, viewport));
      return {
        id,
        minWidth: compactArrangement
          ? Math.min(420, visualArrangementStage.width)
          : 420,
        minHeight: compactArrangement
          ? Math.min(280, visualArrangementStage.height)
          : 280,
        geometry,
        presentation: docked
          ? inline
            ? ({
                kind: "inline",
                leafId: naturalTreeInlineInspectorNodeId!,
              } as const)
            : ({ kind: "docked" } as const)
          : ({ kind: "floating" } as const),
      } satisfies TerminalWindowArrangementParticipant<VisualInspectorPresentation>;
    });
  }, [
    arrangementScope,
    compactArrangement,
    dockedInspectorGeometry,
    dockedInspectorId,
    floatingWindowGeometries,
    inspectorConversations,
    naturalTreeInlineInspectorNodeId,
    treeInlineInspectorPortal,
    view,
    visualArrangementStage.height,
    visualArrangementStage.width,
  ]);
  const selectedInspectorId = selected
    ? worldInspectorWindowIdForNode(selected)
    : null;
  const activeInspectorId = visualWindows.some(
    ({ id }) => id === selectedInspectorId,
  )
    ? selectedInspectorId
    : (dockedInspectorId ??
      visualWindows[visualWindows.length - 1]?.id ??
      null);
  const visualPlacements =
    arrangementScope?.preset && visualArrangementStage.width > 0
      ? terminalWindowArrangementPlacements(visualArrangementState, {
          leaseKey: visualLeaseKey,
          scopeKey: VISUAL_ARRANGEMENT_SCOPE,
          stage: visualArrangementStage,
          windows: visualWindows,
          activeId: activeInspectorId,
          compact: compactArrangement,
        })
      : null;
  const visualPlacementMap = new Map(
    (visualPlacements ?? [])
      .filter(({ id }) => !excludedArrangementIds.has(id))
      .map(({ id, geometry }) => [
        id,
        fitVisualInspectorArrangementGeometry(
          !compactArrangement && arrangementScope?.preset === "single"
            ? (singleManualGeometry[id] ?? geometry)
            : geometry,
          visualArrangementStage,
        ),
      ]),
  );
  const arrangedDocked =
    dockedInspectorId !== null && visualPlacementMap.has(dockedInspectorId);
  const dockedSuppressed =
    dockedInspectorId !== null &&
    (arrangementScope?.preset === "single" ||
      (arrangementScope?.preset && compactArrangement)) &&
    !arrangedDocked;
  const requestedInlineNodeId =
    inlineReturnNodeId ?? naturalTreeInlineInspectorNodeId;
  const requestedInlineNode = requestedInlineNodeId
    ? world.nodeById.get(requestedInlineNodeId)
    : null;
  const treeInlineInspectorNodeId =
    !arrangedDocked &&
    !dockedSuppressed &&
    view === "tree" &&
    requestedInlineNodeId &&
    dockedInspectorId &&
    requestedInlineNode &&
    worldInspectorWindowIdForNode(requestedInlineNode) === dockedInspectorId
      ? requestedInlineNodeId
      : null;
  const contextRailInspector =
    arrangedDocked ||
    dockedSuppressed ||
    (treeInlineInspectorNodeId && treeInlineInspectorPortal)
      ? null
      : dockedInspector;
  const dockedInspectorPortal =
    arrangedDocked || dockedSuppressed
      ? null
      : treeInlineInspectorNodeId && treeInlineInspectorPortal
        ? treeInlineInspectorPortal
        : contextRailInspectorPortal;
  const dockedInspectorPortalRef = useRef<Element | null>(null);
  dockedInspectorPortalRef.current = dockedInspectorPortal;
  const dockedInspectorNodeId = contextRailInspector?.nodeId ?? null;
  const dockedInspectorExpanded = contextRailInspector?.expanded ?? false;
  const visibleFloatingInspectors = inspectorConversations.filter(
    (conversation) => {
      const id = worldInspectorWindowId(conversation);
      if (
        arrangementScope?.preset === "single" ||
        (arrangementScope?.preset && compactArrangement)
      ) {
        return visualPlacementMap.has(id);
      }
      return id !== dockedInspectorId || visualPlacementMap.has(id);
    },
  );
  const visibleFloatingInspectorIds = new Set(
    visibleFloatingInspectors.map(worldInspectorWindowId),
  );
  const conversationNodeIds = useMemo(
    () => inspectorConversations.map(({ nodeId }) => nodeId),
    [inspectorConversations],
  );
  const snapshotPriorities = useMemo(
    () => [
      ...(pendingSurfacePriority ? [pendingSurfacePriority] : []),
      ...(selection
        ? [worldSnapshotPriorityForNode(selection)].filter(
            (priority): priority is WorldRuntimePriority => priority !== null,
          )
        : []),
      ...inspectorConversations.map(snapshotPriorityForConversation),
    ],
    [inspectorConversations, pendingSurfacePriority, selection],
  );
  dockedInspectorGeometryRef.current = dockedInspectorGeometry;

  useLayoutEffect(() => {
    worldRuntimeStore.setSelectedConnectionId(
      hasValidSelectedConnection(
        connectionSelection.activeConnectionId,
        connectionSelection.connections,
      )
        ? connectionSelection.activeConnectionId
        : null,
    );
  }, [connectionSelection.activeConnectionId, connectionSelection.connections]);

  useLayoutEffect(() => {
    worldRuntimeStore.setPriorities(snapshotPriorities);
  }, [snapshotPriorities]);

  useLayoutEffect(() => {
    const layout = worldViewLayoutRef.current;
    if (!layout || !active) return;
    const update = () => {
      const next = visualInspectorArrangementStage(
        layout.getBoundingClientRect(),
        measuredFixedPositionScale(),
      );
      setVisualArrangementStage((current) =>
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(layout);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [active, hasSelectedConnection]);

  useEffect(() => {
    setVisualArrangementState((current) =>
      terminalWindowArrangementForLease(current, visualLeaseKey),
    );
    setExcludedArrangementIds(new Set());
    setSingleManualGeometry({});
    setInlineReturnNodeId(null);
  }, [visualLeaseKey]);

  useEffect(() => {
    const openIds = inspectorConversations.map(worldInspectorWindowId);
    setVisualArrangementState((current) =>
      retainTerminalWindowArrangementWindows(current, {
        leaseKey: visualLeaseKey,
        scopeKey: VISUAL_ARRANGEMENT_SCOPE,
        openIds,
      }),
    );
  }, [inspectorConversations, visualLeaseKey]);

  const selectVisualArrangement = useCallback(
    (command: TerminalWindowArrangementPreset | "restore") => {
      const openIds = visualWindows.map(({ id }) => id);
      if (command === "restore") {
        const restored = restoreTerminalWindowArrangement(
          visualArrangementState,
          {
            leaseKey: visualLeaseKey,
            scopeKey: VISUAL_ARRANGEMENT_SCOPE,
            openIds,
          },
        );
        setVisualArrangementState(restored.state);
        setExcludedArrangementIds(new Set());
        setSingleManualGeometry({});
        if (
          dockedInspectorId !== null &&
          !restored.targets.some(({ id }) => id === dockedInspectorId)
        ) {
          return;
        }
        const previousDock = restored.targets.find(
          ({ baseline }) => baseline.presentation.kind !== "floating",
        );
        if (previousDock) {
          onDockedInspectorIdChange(previousDock.id);
          setInlineReturnNodeId(
            previousDock.baseline.presentation.kind === "inline"
              ? previousDock.baseline.presentation.leafId
              : "",
          );
        } else if (
          restored.targets.some(({ id }) => id === dockedInspectorId)
        ) {
          onDockedInspectorIdChange(null);
          setInlineReturnNodeId(null);
        }
        return;
      }
      const applied = applyTerminalWindowArrangement(visualArrangementState, {
        leaseKey: visualLeaseKey,
        scopeKey: VISUAL_ARRANGEMENT_SCOPE,
        preset: command,
        stage: visualArrangementStage,
        windows: visualWindows,
        activeId: activeInspectorId,
      });
      if (!applied.result.available) return;
      setVisualArrangementState(applied.state);
      setExcludedArrangementIds(new Set());
      setSingleManualGeometry({});
      setInlineReturnNodeId(null);
    },
    [
      activeInspectorId,
      dockedInspectorId,
      onDockedInspectorIdChange,
      visualArrangementStage,
      visualArrangementState,
      visualLeaseKey,
      visualWindows,
    ],
  );
  const visualArrangementControl = useMemo<WindowArrangementControl>(() => {
    const presets: TerminalWindowArrangementPreset[] = [
      "single",
      "cascade",
      "columns",
      "rows",
      "grid",
    ];
    const disabledReasons: WindowArrangementControl["disabledReasons"] = {};
    for (const preset of presets) {
      const reason = terminalWindowArrangementReason(
        preset,
        visualArrangementStage,
        visualWindows,
        activeInspectorId,
      );
      if (reason) disabledReasons[preset] = reason;
    }
    if (
      !arrangementScope ||
      Object.keys(arrangementScope.baselines).length === 0
    ) {
      disabledReasons.restore = "No arranged positions to restore.";
    }
    return {
      activePreset: arrangementScope?.preset ?? null,
      disabledReasons,
      onSelect: selectVisualArrangement,
    };
  }, [
    activeInspectorId,
    arrangementScope,
    selectVisualArrangement,
    visualArrangementStage,
    visualWindows,
  ]);
  useLayoutEffect(() => {
    onVisualArrangementControlReady(visualArrangementControl);
    return () => onVisualArrangementControlReady(undefined);
  }, [onVisualArrangementControlReady, visualArrangementControl]);

  useEffect(() => {
    setDockedInspectorGeometry(null);
    setDockedInspectorMoving(false);
    dockedInspectorMoveRef.current = null;
  }, [dockedInspectorId]);

  useEffect(() => {
    if (!dockedInspectorGeometry) return;
    const clampToViewport = () =>
      setDockedInspectorGeometry((current) =>
        current
          ? moveDockedInspectorGeometry(
              current,
              0,
              0,
              inspectorViewportBounds(),
            )
          : null,
      );
    window.addEventListener("resize", clampToViewport);
    window.visualViewport?.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      window.visualViewport?.removeEventListener("resize", clampToViewport);
    };
  }, [dockedInspectorGeometry]);

  useEffect(() => {
    const rail = contextRailRef.current;
    if (!rail || !dockedInspectorNodeId || dockedInspectorExpanded) {
      return;
    }
    const interactiveSelector =
      "button, a, input, textarea, select, [role='tab'], [role='separator']";
    const begin = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const handle = event.target.closest(
        ".workspace-inspector-head.is-docked-window-drag-handle",
      );
      if (!handle || event.target.closest(interactiveSelector)) return;
      event.preventDefault();
      const railBounds = rail.getBoundingClientRect();
      const geometry = {
        left: railBounds.left,
        top: railBounds.top,
        width: railBounds.width,
        height: railBounds.height,
      };
      dockedInspectorMoveRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        geometry,
      };
      try {
        rail.setPointerCapture(event.pointerId);
      } catch {
        // Window listeners keep the drag alive when capture is unavailable.
      }
      setDockedInspectorMoving(true);
    };
    const move = (event: PointerEvent) => {
      const current = dockedInspectorMoveRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      setDockedInspectorGeometry(
        moveDockedInspectorGeometry(
          current.geometry,
          event.clientX - current.startX,
          event.clientY - current.startY,
          inspectorViewportBounds(),
        ),
      );
    };
    const end = (event: PointerEvent) => {
      const current = dockedInspectorMoveRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      dockedInspectorMoveRef.current = null;
      setDockedInspectorMoving(false);
      if (rail.hasPointerCapture(event.pointerId)) {
        rail.releasePointerCapture(event.pointerId);
      }
    };
    const moveByKeyboard = (event: KeyboardEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.matches(
          ".workspace-inspector-head.is-docked-window-drag-handle",
        )
      ) {
        return;
      }
      const amount = event.shiftKey ? 1 : 16;
      const delta =
        event.key === "ArrowLeft"
          ? { x: -amount, y: 0 }
          : event.key === "ArrowRight"
            ? { x: amount, y: 0 }
            : event.key === "ArrowUp"
              ? { x: 0, y: -amount }
              : event.key === "ArrowDown"
                ? { x: 0, y: amount }
                : null;
      if (!delta) return;
      event.preventDefault();
      const railBounds = rail.getBoundingClientRect();
      const geometry = dockedInspectorGeometryRef.current ?? {
        left: railBounds.left,
        top: railBounds.top,
        width: railBounds.width,
        height: railBounds.height,
      };
      setDockedInspectorGeometry(
        moveDockedInspectorGeometry(
          geometry,
          delta.x,
          delta.y,
          inspectorViewportBounds(),
        ),
      );
    };
    rail.addEventListener("pointerdown", begin, true);
    rail.addEventListener("keydown", moveByKeyboard, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      rail.removeEventListener("pointerdown", begin, true);
      rail.removeEventListener("keydown", moveByKeyboard, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, [dockedInspectorExpanded, dockedInspectorNodeId]);

  const conversationFor = (
    node: WorldObjectNode,
    requestedView: InspectorView | null,
  ) => {
    if (node.kind === "host") return null;
    const view = worldIntentInitialView(node, requestedView);
    const context = worldInspectorContext(node);
    if (!view || !context) return null;
    const workspaceId =
      node.kind === "space" ? node.nativeId : node.workspaceId;
    const workspace = store
      .get()
      .workspaces.find((candidate) => candidate.workspace_id === workspaceId);
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
    if (
      document.documentElement.dataset.layout === "mobile" ||
      window.matchMedia?.("(any-pointer: coarse)").matches
    ) {
      return;
    }
    const attempt = (remaining: number) => {
      const target =
        dockedInspectorIdRef.current === windowId
          ? dockedInspectorPortalRef.current
          : floatingInspectorPortalsRef.current[windowId];
      const input = target?.querySelector<HTMLElement>(
        ".xterm-helper-textarea",
      );
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

  const applySelection = async (
    id: string | null,
    requestedView: InspectorView | null = null,
    focusTarget = true,
    candidateWorld = world,
  ): Promise<boolean> => {
    const next = id ? (candidateWorld.nodeById.get(id) ?? null) : null;
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
    setInlineReturnNodeId(null);
    if (
      !next ||
      next.kind === "host" ||
      !next.actionable ||
      !next.selectedHost
    ) {
      setSelection(next);
      if (dockedInspector) {
        onInspectorConversationsChange(
          inspectorConversations.filter(
            (conversation) =>
              worldInspectorWindowId(conversation) !==
              worldInspectorWindowId(dockedInspector),
          ),
        );
        onInspectorTerminalPortal(
          worldInspectorWindowId(dockedInspector),
          null,
        );
        onDockedInspectorIdChange(null);
      }
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
      try {
        if (focusTarget) await focusWorldNode(next);
        if (intentRequestRef.current !== requestId) return false;
        const currentConversations = inspectorConversationsRef.current;
        const currentExisting = currentConversations.find(
          (conversation) =>
            worldInspectorWindowId(conversation) ===
            worldInspectorWindowIdForNode(next),
        );
        if (!currentExisting) return false;
        const currentDockedInspectorId = dockedInspectorIdRef.current;
        setSelection(next);
        const observed = conversationFor(next, requestedView);
        if (!observed) return false;
        const reconciled = reconcileWorldInspectorConversation(
          currentExisting,
          observed,
        );
        const admitted =
          requestedView && reconciled.availableViews.includes(requestedView)
            ? { ...reconciled, view: requestedView }
            : reconciled;
        if (
          worldInspectorWindowId(currentExisting) !== currentDockedInspectorId
        ) {
          const displacedDocked = currentConversations.find(
            (candidate) =>
              worldInspectorWindowId(candidate) === currentDockedInspectorId,
          );
          if (displacedDocked) {
            onInspectorTerminalPortal(
              worldInspectorWindowId(displacedDocked),
              null,
            );
          }
          const nextConversations = [
            ...currentConversations.filter((candidate) => {
              const id = worldInspectorWindowId(candidate);
              return (
                id !== worldInspectorWindowId(currentExisting) &&
                id !== currentDockedInspectorId
              );
            }),
            admitted,
          ];
          inspectorConversationsRef.current = nextConversations;
          onInspectorConversationsChange(nextConversations);
          dockedInspectorIdRef.current = worldInspectorWindowId(admitted);
          onDockedInspectorIdChange(worldInspectorWindowId(admitted));
          if (admitted.view === "terminal") {
            focusInspectorTerminal(worldInspectorWindowId(admitted));
          }
          return true;
        }
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
        if (intentRequestRef.current === requestId) setIntentOpening(false);
      }
      return true;
    }
    const conversation = conversationFor(next, requestedView);
    if (!conversation) return false;
    setIntentOpening(true);
    try {
      if (focusTarget) await focusWorldNode(next);
      if (intentRequestRef.current !== requestId) return false;
      const currentConversations = inspectorConversationsRef.current;
      const currentDockedInspectorId = dockedInspectorIdRef.current;
      const currentDockedInspector = currentConversations.find(
        (conversation) =>
          worldInspectorWindowId(conversation) === currentDockedInspectorId,
      );
      setSelection(next);
      if (currentDockedInspector) {
        onInspectorTerminalPortal(
          worldInspectorWindowId(currentDockedInspector),
          null,
        );
      }
      const nextConversations = [
        ...currentConversations.filter(
          (candidate) =>
            worldInspectorWindowId(candidate) !==
              (currentDockedInspector
                ? worldInspectorWindowId(currentDockedInspector)
                : null) &&
            worldInspectorWindowId(candidate) !==
              worldInspectorWindowId(conversation),
        ),
        conversation,
      ];
      inspectorConversationsRef.current = nextConversations;
      onInspectorConversationsChange(nextConversations);
      dockedInspectorIdRef.current = worldInspectorWindowId(conversation);
      onDockedInspectorIdChange(worldInspectorWindowId(conversation));
      if (conversation.view === "terminal") {
        focusInspectorTerminal(worldInspectorWindowId(conversation));
      }
    } catch (cause) {
      if (intentRequestRef.current === requestId) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    } finally {
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
        world,
        conversation,
        paneId,
      );
      if (!sibling) return;
      if (windowId === dockedInspectorIdRef.current) {
        void applySelection(sibling.id);
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
  const selectNode = (id: string) => {
    const node = world.nodeById.get(id);
    if (
      view === "office" &&
      officeInspectorPresentation === "floating" &&
      node?.kind !== "host" &&
      node?.actionable &&
      node.selectedHost
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
        return applySelection(id);
      }
      return openFloatingInspector(node)
        .then(() => true)
        .catch((cause) => {
          setIntentError(
            cause instanceof Error ? cause.message : String(cause),
          );
          return false;
        });
    }
    return applySelection(id);
  };
  const workspaceSurfaceSelectionHandlerRef = useRef<
    (selection: WorkspaceSurfaceSelection) => Promise<boolean>
  >(() => Promise.resolve(false));
  workspaceSurfaceSelectionHandlerRef.current = (surfaceSelection) => {
    const node = worldNodeForWorkspaceSurfaceSelection(world, surfaceSelection);
    if (node) return applySelection(node.id);
    if (
      surfaceSelection.connectionId !==
        connectionSelection.activeConnectionId ||
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
        const refreshedWorld = worldObjectForConnection(
          buildWorldObject(
            worldRuntimeStore.get().connections,
            connectionSelection.activeConnectionId,
          ),
          connectionSelection.activeConnectionId,
        );
        const refreshedNode = worldNodeForWorkspaceSurfaceSelection(
          refreshedWorld,
          surfaceSelection,
        );
        return refreshedNode
          ? applySelection(refreshedNode.id, null, true, refreshedWorld)
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
    if (!hasSelectedConnection) return;
    let changed = false;
    const retained = inspectorConversations.flatMap((conversation) => {
      const current = worldNodeForInspectorConversation(world, conversation);
      if (
        !current ||
        current.generation !== conversation.runtimeGeneration ||
        !current.actionable
      ) {
        changed = true;
        return [];
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
      onInspectorConversationsChange(retained);
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
    hasSelectedConnection,
    inspectorConversations,
    onDockedInspectorIdChange,
    onInspectorConversationsChange,
    onInspectorTerminalPortal,
    selection,
    world,
  ]);

  const openFloatingInspector = async (node: WorldObjectNode) => {
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
        if (floatingInspectors.length >= 5) {
          throw new Error(
            "Five Inspectors are already floating. Close one before floating another.",
          );
        }
        if (
          !(await focusFloatingInspector(existing, true, requestedView, node))
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
        !(await focusFloatingInspector(existing, true, requestedView, node))
      ) {
        throw new Error("Inspector activation was superseded");
      }
      focusInspectorTerminal(worldInspectorWindowId(existing));
      return;
    }
    if (floatingInspectors.length >= 5) {
      throw new Error(
        "Five Inspectors are already floating. Close one before opening another.",
      );
    }
    const conversation = conversationFor(node, "terminal");
    if (!conversation) throw new Error("This Inspector is no longer available");
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setIntentOpening(true);
    try {
      await focusWorldNode(node);
      if (intentRequestRef.current !== requestId) {
        throw new Error("Inspector activation was superseded");
      }
      setSelection(node);
      onInspectorConversationsChange([
        ...inspectorConversationsRef.current,
        conversation,
      ]);
      focusInspectorTerminal(worldInspectorWindowId(conversation));
    } finally {
      if (intentRequestRef.current === requestId) setIntentOpening(false);
    }
  };

  const openTerminalById = async (id: string) => {
    const node = world.nodeById.get(id);
    if (!node) throw new Error("This terminal is no longer available");
    try {
      const existing = inspectorConversationsRef.current.find(
        (conversation) =>
          worldInspectorWindowId(conversation) ===
          worldInspectorWindowIdForNode(node),
      );
      if (
        view === "office" &&
        (officeInspectorPresentation === "docked" ||
          (existing &&
            worldInspectorWindowId(existing) === dockedInspectorIdRef.current))
      ) {
        if (!(await applySelection(id, "terminal"))) {
          throw new Error("This terminal could not be opened");
        }
        return;
      }
      await openFloatingInspector(node);
    } catch (cause) {
      setIntentError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };

  const dockFloatingInspector = async (
    conversation: WorldInspectorConversation,
  ) => {
    const target = world.nodeById.get(conversation.nodeId);
    if (!target) {
      closeInspector(conversation);
      return false;
    }
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setIntentOpening(true);
    try {
      await focusWorldNode(target);
      if (intentRequestRef.current !== requestId) return false;
      const currentConversation = inspectorConversationsRef.current.find(
        (candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation),
      );
      if (!currentConversation) return false;
      setSelection(target);
      setInlineReturnNodeId(null);
      dockedInspectorIdRef.current =
        worldInspectorWindowId(currentConversation);
      onDockedInspectorIdChange(worldInspectorWindowId(currentConversation));
      if (currentConversation.view === "terminal") {
        focusInspectorTerminal(worldInspectorWindowId(currentConversation));
      }
      return true;
    } catch (cause) {
      if (intentRequestRef.current === requestId) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      }
      return false;
    } finally {
      if (intentRequestRef.current === requestId) setIntentOpening(false);
    }
  };

  const closeInspector = (conversation: WorldInspectorConversation) => {
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
  ): Promise<boolean> => {
    const target = selectedNode ?? world.nodeById.get(conversation.nodeId);
    if (!target) throw new Error("This Inspector is no longer available");
    const requestId = focusTarget
      ? intentRequestRef.current + 1
      : intentRequestRef.current;
    if (focusTarget) {
      intentRequestRef.current = requestId;
      setIntentError(null);
      setIntentOpening(true);
    }
    try {
      if (focusTarget) await focusWorldNode(target);
      if (intentRequestRef.current !== requestId) return false;
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
      const currentFloating = current.filter(
        (conversation) =>
          worldInspectorWindowId(conversation) !== dockedInspectorIdRef.current,
      );
      if (
        currentConversation !== observedConversation ||
        (currentFloating.length
          ? worldInspectorWindowId(currentFloating[currentFloating.length - 1]!)
          : null) !== worldInspectorWindowId(conversation)
      ) {
        const nextConversations = [
          ...current.filter(
            (candidate) =>
              worldInspectorWindowId(candidate) !==
              worldInspectorWindowId(conversation),
          ),
          currentConversation,
        ];
        inspectorConversationsRef.current = nextConversations;
        onInspectorConversationsChange(nextConversations);
      }
      setSelection(target);
      setInlineReturnNodeId(null);
      if (currentConversation.view === "terminal") {
        focusInspectorTerminal(worldInspectorWindowId(conversation));
      }
      return true;
    } catch (cause) {
      if (intentRequestRef.current === requestId) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      }
      throw cause;
    } finally {
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

  useEffect(() => {
    if (
      selected &&
      (!currentSelectionGeneration || shouldCloseWorldInspector(selected))
    ) {
      intentRequestRef.current += 1;
      setIntentOpening(false);
    }
  }, [currentSelectionGeneration, selected]);

  useEffect(() => {
    const rail = contextRailRef.current;
    if (view === "tree" || !dockedInspector || !rail) {
      setIntentOverlayAnchor(null);
      return;
    }
    const update = () => {
      const bounds = rail.getBoundingClientRect();
      setIntentOverlayAnchor({
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [dockedInspector, dockedInspectorGeometry, view]);

  const showSelectionProfile = Boolean(
    selected &&
      (selected.kind === "host" ||
        !currentSelectionGeneration ||
        !selected.actionable),
  );
  const visualActions = (
    <VisualRouteActions
      selection={selected}
      world={world}
      activeConnectionId={connectionSelection.activeConnectionId}
      runtimeGeneration={connectionSelection.runtimeGeneration}
      arrangementControl={visualArrangementControl}
      onResource={(node, requestedView) =>
        applySelection(node.id, requestedView)
      }
      onGoToSpaces={async (node) => {
        const requestId = intentRequestRef.current + 1;
        intentRequestRef.current = requestId;
        setIntentError(null);
        setIntentOpening(true);
        try {
          await focusWorldNode(node);
          if (intentRequestRef.current !== requestId) return false;
          setSelection(node);
          onGoToSpaces();
          return true;
        } catch (cause) {
          if (intentRequestRef.current === requestId) {
            setIntentError(
              cause instanceof Error ? cause.message : String(cause),
            );
          }
          return false;
        } finally {
          if (intentRequestRef.current === requestId) setIntentOpening(false);
        }
      }}
      onError={setIntentError}
    />
  );

  return (
    <main
      className="world-control-plane"
      id="world"
      data-active={active ? "true" : "false"}
    >
      {!hasSelectedConnection ? (
        <WorldConnectionRequired status={connectionSelection.status} />
      ) : (
        <div
          ref={worldViewLayoutRef}
          className={`world-view-layout ${showSelectionProfile || contextRailInspector ? "has-context" : ""}`}
        >
          <section className="world-view-stage" aria-label={`${view} view`}>
            {active ? (
              <Suspense
                fallback={
                  <div className="world-view-loading">Loading view…</div>
                }
              >
                <WorldViewErrorBoundary key={view}>
                  {view === "office" ? (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">
                          Loading Office…
                        </div>
                      }
                    >
                      <PixelOfficeView
                        world={presentedWorld}
                        toolbarPortal={viewToolbarPortal}
                        toolbarActions={watchToolbarActions}
                        selectedId={selectedId}
                        onSelect={selectNode}
                        floatingTerminals={inspectorConversations}
                        onConversationNodeAnchorsChange={
                          setVisualConversationAnchors
                        }
                        onOpenTerminal={openTerminalById}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                        actions={visualActions}
                      />
                    </Suspense>
                  ) : view === "tree" ? (
                    <Suspense
                      fallback={
                        <div className="world-view-loading">Loading Tree…</div>
                      }
                    >
                      <ConnectedTreeView
                        world={presentedWorld}
                        toolbarPortal={viewToolbarPortal}
                        toolbarActions={watchToolbarActions}
                        selectedId={selectedId}
                        conversationNodeIds={conversationNodeIds}
                        inlineInspectorNodeId={treeInlineInspectorNodeId}
                        onSelect={selectNode}
                        onOpenTerminal={openTerminalById}
                        onInlineInspectorPortalChange={
                          setTreeInlineInspectorPortal
                        }
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                        onNodeAnchorsChange={setVisualConversationAnchors}
                        actions={visualActions}
                      />
                    </Suspense>
                  ) : (
                    <SpatialGraphView
                      world={presentedWorld}
                      toolbarPortal={viewToolbarPortal}
                      toolbarActions={watchToolbarActions}
                      selectedId={selectedId}
                      conversationNodeIds={conversationNodeIds}
                      onSelect={selectNode}
                      onOpenTerminal={openTerminalById}
                      onSelectedAnchorChange={setSelectedVisualAnchor}
                      onNodeAnchorsChange={setVisualConversationAnchors}
                      actions={visualActions}
                    />
                  )}
                </WorldViewErrorBoundary>
              </Suspense>
            ) : null}
          </section>
          {contextRailInspector &&
          visualConversationAnchors?.[contextRailInspector.nodeId] &&
          intentOverlayAnchor ? (
            <Suspense fallback={null}>
              <WorldIntentConnector
                source={visualConversationAnchors[contextRailInspector.nodeId]!}
                target={intentOverlayAnchor}
              />
            </Suspense>
          ) : null}
          {visibleFloatingInspectors.map((conversation) => {
            const source = visualConversationAnchors?.[conversation.nodeId];
            const target =
              floatingWindowAnchors[worldInspectorWindowId(conversation)] ??
              null;
            return source && target ? (
              <Suspense
                key={worldInspectorWindowId(conversation)}
                fallback={null}
              >
                <WorldIntentConnector source={source} target={target} />
              </Suspense>
            ) : null;
          })}
          <aside
            ref={contextRailRef}
            className={`world-context-rail ${contextRailInspector ? "has-inspector" : ""}`}
            aria-label="World context"
            data-interaction={dockedInspectorMoving ? "moving" : undefined}
            data-dock={contextRailInspector?.dock}
            data-free-position={
              dockedInspectorGeometry && !dockedInspectorExpanded
                ? "true"
                : undefined
            }
            style={
              dockedInspectorGeometry && !dockedInspectorExpanded
                ? ({
                    left: dockedInspectorGeometry.left,
                    top: dockedInspectorGeometry.top,
                    right: "auto",
                    bottom: "auto",
                    width: dockedInspectorGeometry.width,
                    height: dockedInspectorGeometry.height,
                    maxHeight: "none",
                    "--world-inspector-dock-size": `${contextRailInspector?.size ?? 520}px`,
                  } as CSSProperties)
                : ({
                    "--world-inspector-dock-size": `${contextRailInspector?.size ?? 520}px`,
                  } as CSSProperties)
            }
          >
            {selected && showSelectionProfile ? (
              <Suspense
                fallback={
                  <div className="world-selection-panel" role="status">
                    Opening intent…
                  </div>
                }
              >
                <WorldIntentProfile
                  node={selected}
                  currentGeneration={currentSelectionGeneration}
                  inspectorOpen={Boolean(dockedInspector)}
                  intentOpening={intentOpening}
                  resourceError={intentError}
                  onActivateHost={async () => {
                    window.dispatchEvent(
                      new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT),
                    );
                    retireInspectors();
                    await activateWorldNodeHost(selected);
                  }}
                  onClose={closeIntent}
                />
              </Suspense>
            ) : null}
            {!showSelectionProfile && intentError ? (
              <p className="world-panel-error" role="alert">
                {intentError}
              </p>
            ) : null}
            <div
              className="world-inspector-portal"
              ref={setContextRailInspectorPortal}
            />
          </aside>
        </div>
      )}
      <Suspense fallback={null}>
        {visibleFloatingInspectors.map((conversation, index) => (
          <WorldFloatingTerminalWindow
            key={worldInspectorWindowId(conversation)}
            conversation={conversation}
            cascadeIndex={index}
            compactActive={
              arrangementScope?.preset
                ? worldInspectorWindowId(conversation) === activeInspectorId
                : !dockedInspector && index === floatingInspectors.length - 1
            }
            arrangedGeometry={
              visualPlacementMap.get(worldInspectorWindowId(conversation)) ??
              null
            }
            persistGeometry={
              worldInspectorWindowId(conversation) !== dockedInspectorId
            }
            onGeometryObserved={(geometry) => {
              const id = worldInspectorWindowId(conversation);
              setFloatingWindowGeometries((current) =>
                current[id] &&
                current[id].left === geometry.left &&
                current[id].top === geometry.top &&
                current[id].width === geometry.width &&
                current[id].height === geometry.height
                  ? current
                  : { ...current, [id]: geometry },
              );
            }}
            onArrangedGeometryChange={(geometry) => {
              const id = worldInspectorWindowId(conversation);
              const fitted = fitVisualInspectorArrangementGeometry(
                geometry,
                visualArrangementStage,
              );
              if (arrangementScope?.preset === "single") {
                setSingleManualGeometry((current) => ({
                  ...current,
                  [id]: fitted,
                }));
              } else {
                setVisualArrangementState((current) =>
                  updateTerminalWindowArrangementGeometry(current, {
                    leaseKey: visualLeaseKey,
                    scopeKey: VISUAL_ARRANGEMENT_SCOPE,
                    id,
                    geometry: fitted,
                  }),
                );
              }
            }}
            onFocus={() => {
              void focusFloatingInspector(conversation).catch(() => undefined);
            }}
            onRaise={() => {
              void focusFloatingInspector(conversation, false);
            }}
            onAnchorChange={(anchor) =>
              setFloatingWindowAnchors((current) => {
                const id = worldInspectorWindowId(conversation);
                const previous = current[id];
                if (
                  previous === anchor ||
                  (previous &&
                    anchor &&
                    previous.left === anchor.left &&
                    previous.top === anchor.top &&
                    previous.right === anchor.right &&
                    previous.bottom === anchor.bottom)
                ) {
                  return current;
                }
                return { ...current, [id]: anchor };
              })
            }
            onPortalChange={(portal) =>
              setFloatingInspectorPortals((current) => ({
                ...current,
                [worldInspectorWindowId(conversation)]: portal,
              }))
            }
          />
        ))}
        {inspectorConversations.map((conversation) => (
          <WorldInspectorConversationView
            key={worldInspectorWindowId(conversation)}
            conversation={conversation}
            target={
              worldInspectorWindowId(conversation) === dockedInspectorId &&
              !arrangedDocked
                ? dockedInspectorPortal
                : visibleFloatingInspectorIds.has(
                      worldInspectorWindowId(conversation),
                    )
                  ? (floatingInspectorPortals[
                      worldInspectorWindowId(conversation)
                    ] ?? null)
                  : null
            }
            floating={
              worldInspectorWindowId(conversation) !== dockedInspectorId ||
              arrangedDocked
            }
            terminalActive={
              worldInspectorWindowId(conversation) === dockedInspectorId
                ? !dockedSuppressed
                : visibleFloatingInspectorIds.has(
                    worldInspectorWindowId(conversation),
                  )
            }
            embedded={
              worldInspectorWindowId(conversation) === dockedInspectorId &&
              !arrangedDocked &&
              conversation.nodeId === treeInlineInspectorNodeId
            }
            onChange={(change) => {
              if (change.dock !== undefined || change.expanded !== undefined) {
                setDockedInspectorGeometry(null);
                if (arrangementScope?.preset) {
                  setExcludedArrangementIds((current) =>
                    new Set(current).add(worldInspectorWindowId(conversation)),
                  );
                }
              }
              onInspectorConversationsChange(
                inspectorConversations.map((candidate) =>
                  worldInspectorWindowId(candidate) ===
                  worldInspectorWindowId(conversation)
                    ? { ...candidate, ...change }
                    : candidate,
                ),
              );
            }}
            onClose={() => closeInspector(conversation)}
            onDockIn={() => {
              void dockFloatingInspector(conversation).then((docked) => {
                if (docked && arrangementScope?.preset) {
                  setExcludedArrangementIds((current) =>
                    new Set(current).add(worldInspectorWindowId(conversation)),
                  );
                }
              });
            }}
            onDockOut={() => {
              if (floatingInspectors.length >= 5) {
                setIntentError(
                  "Five Inspectors are already floating. Close one before floating another.",
                );
                return;
              }
              setDockedInspectorGeometry(null);
              dockedInspectorIdRef.current = null;
              onDockedInspectorIdChange(null);
            }}
            onFocus={
              worldInspectorWindowId(conversation) === dockedInspectorId
                ? () => {
                    const target = world.nodeById.get(conversation.nodeId);
                    if (!target) return;
                    setSelection(target);
                    void focusWorldNode(target).catch((cause) =>
                      setIntentError(
                        cause instanceof Error ? cause.message : String(cause),
                      ),
                    );
                  }
                : undefined
            }
            onTerminalPortalChange={(portal) =>
              onInspectorTerminalPortal(
                worldInspectorWindowId(conversation),
                portal,
              )
            }
          />
        ))}
      </Suspense>
    </main>
  );
}

export function hasValidSelectedConnection(
  activeConnectionId: string,
  connections: readonly Pick<ConnectionSummary, "id">[],
) {
  return connections.some(({ id }) => id === activeConnectionId);
}

export function chooseWorldSelectedConnection({
  activeConnectionId,
  defaultConnectionId,
  storedConnectionId,
  connections,
}: {
  activeConnectionId: string;
  defaultConnectionId: string;
  storedConnectionId: string | null;
  connections: readonly Pick<ConnectionSummary, "id">[];
}): string | null {
  const ids = new Set(connections.map(({ id }) => id));
  if (storedConnectionId && ids.has(storedConnectionId)) {
    return storedConnectionId;
  }
  if (ids.has(defaultConnectionId)) return defaultConnectionId;
  if (ids.has(activeConnectionId)) return activeConnectionId;
  return null;
}

export function selectedHostStatusLabel(
  host: Pick<WorldHostObject, "label" | "hostState"> | null,
) {
  return host
    ? `${host.label} · ${hostStateLabel(host.hostState)}`
    : "No host selected";
}

export function shouldCloseWorldInspector(node: WorldObjectNode | null) {
  return node !== null && (!node.selectedHost || !node.actionable);
}

function hostStateLabel(state: WorldObjectNode["hostState"]) {
  switch (state) {
    case "active":
      return "Active";
    case "ready-inactive":
      return "Ready · inactive";
    case "reconnecting":
      return "Reconnecting";
    case "offline-stale":
      return "Offline · stale";
  }
}

function workspaceTarget(node: WorldObjectNode) {
  if (node.kind === "space")
    return { workspaceId: node.nativeId, paneId: null };
  if (node.kind === "agent" || node.kind === "terminal") {
    return { workspaceId: node.workspaceId, paneId: node.nativeId };
  }
  return null;
}

type WorldFocusStore = {
  get(): {
    activeConnectionId: string;
    connectionGeneration?: number;
    serverRuntimeGeneration: number | null;
    connections: Array<{
      id: string;
      state: string;
      generation: number;
    }>;
  };
  selectConnection(connectionId: string): boolean;
  refresh(): Promise<unknown>;
  focusQualifiedTarget(target: {
    connectionId: string;
    runtimeGeneration: number;
    workspaceId: string;
    paneId: string | null;
  }): Promise<boolean>;
};

type WorldEventTarget = Pick<EventTarget, "dispatchEvent">;

export async function dispatchWorldInspectorRequest(
  node: WorldObjectNode,
  view: InspectorView,
  focusStore: WorldFocusStore = store,
  eventTarget: WorldEventTarget = window,
  onAdmitted: () => void = () => {},
) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
  const availableViews = worldIntentViews(node);
  if (!availableViews.includes(view)) {
    throw new Error(`${view} is not available for this selection`);
  }
  await focusWorldNode(node, focusStore);
  if (!worldNodeLeaseIsActive(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
  const connectionGeneration = focusStore.get().connectionGeneration;
  if (
    typeof connectionGeneration !== "number" ||
    !Number.isSafeInteger(connectionGeneration)
  ) {
    throw new Error("The browser connection changed while it was opening");
  }
  onAdmitted();
  eventTarget.dispatchEvent(
    new CustomEvent<WorkspaceInspectorRequest>(
      WORKSPACE_INSPECTOR_REQUEST_EVENT,
      {
        detail: {
          connectionId: node.connectionId,
          generation: connectionGeneration,
          workspaceId: target.workspaceId,
          view,
          ...(target.paneId ? { originPaneId: target.paneId } : {}),
          availableViews,
        },
      },
    ),
  );
}

function worldNodeLeaseIsActive(
  node: WorldObjectNode,
  focusStore: WorldFocusStore,
) {
  const snapshot = focusStore.get();
  const connection = snapshot.connections.find(
    (candidate) => candidate.id === node.connectionId,
  );
  return (
    snapshot.activeConnectionId === node.connectionId &&
    snapshot.serverRuntimeGeneration === node.generation &&
    connection?.state === "ready" &&
    connection.generation === node.generation &&
    node.actionable
  );
}

export async function focusWorldNode(
  node: WorldObjectNode,
  focusStore: WorldFocusStore = store,
) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
  if (focusStore.get().activeConnectionId !== node.connectionId) {
    throw new Error(`Activate ${node.hostLabel} before opening this item`);
  }
  const connection = focusStore
    .get()
    .connections.find((candidate) => candidate.id === node.connectionId);
  if (
    !connection ||
    connection.state !== "ready" ||
    connection.generation !== node.generation ||
    !node.actionable
  ) {
    throw new Error("The selected host generation is no longer available");
  }
  if (!worldNodeLeaseIsActive(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
  const focused = await focusStore.focusQualifiedTarget({
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    workspaceId: target.workspaceId,
    paneId: target.paneId,
  });
  if (!focused) {
    throw new Error("The selected item could not be focused");
  }
  if (!worldNodeLeaseIsActive(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
}

export async function activateWorldNodeHost(
  node: WorldObjectNode,
  focusStore: WorldFocusStore = store,
) {
  if (!node.capabilities.activateHost) {
    throw new Error(`${node.hostLabel} is not ready for activation`);
  }
  const connection = focusStore
    .get()
    .connections.find((candidate) => candidate.id === node.connectionId);
  if (
    !connection ||
    connection.state !== "ready" ||
    connection.generation !== node.generation
  ) {
    throw new Error("The observed host generation is no longer ready");
  }
  if (!focusStore.selectConnection(node.connectionId)) {
    throw new Error("The selected host could not be activated");
  }
  await focusStore.refresh();
  const snapshot = focusStore.get();
  const current = snapshot.connections.find(
    (candidate) => candidate.id === node.connectionId,
  );
  if (
    snapshot.activeConnectionId !== node.connectionId ||
    snapshot.serverRuntimeGeneration !== node.generation ||
    current?.state !== "ready" ||
    current.generation !== node.generation
  ) {
    throw new Error("The host changed while it was being activated");
  }
}
