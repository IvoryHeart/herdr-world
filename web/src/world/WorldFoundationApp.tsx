import {
  subscribeCreations,
  useCreationProgress,
  creationPendingReason,
  creationFailureMessage,
  type CreationEvent,
} from "../creationRequests";
import {
  admitCreatedTerminal,
  createdTerminalIdentity,
} from "./createdTerminalAdmission";
import {
  floatingTerminalGeometryId,
  readFloatingTerminalGeometry,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";
import { useLayoutPreferences } from "../layoutPreferences";
import { fitWindow, initialWindowRect } from "./windows/windowManager";
import {
  useWindowManager,
  useWindowWorkArea,
} from "./windows/useWindowManager";
import { visibleWindowIds } from "./windows/windowManager";
import { WindowSurface } from "./windows/WindowSurface";
import { WindowFrame } from "./windows/WindowFrame";
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  History,
  LayoutGrid,
  Pin,
  PinOff,
  Terminal,
  View,
} from "lucide-react";
import App, { type WorkspaceSurfaceSelection } from "../App";
import { bridge, type ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import {
  WINDOW_ARRANGEMENT_CHOICES,
  type WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import type { CommandExtension } from "../components/CommandCombobox";
import { ConfirmDialog } from "../components/ModalDialogs";
import { CreateWorkspaceDialog } from "../components/CreateWorkspaceDialog";
import { shortcutMatches } from "../shortcutPreferences";
import { paneShortcutAction } from "../paneShortcuts";
import {
  adjacentTabId,
  closeShortcutTarget,
  tabShortcutAction,
} from "../tabShortcuts";
import { lazyWithReload } from "../lazyWithReload";
import {
  connectionSnapshot,
  endpointCreationReason,
  operationalStore,
  shallowEqual,
  store,
  useStoreSelector,
} from "../store";
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
  type WorldLeafObject,
  type WorldObject,
  type WorldObjectNode,
  worldObjectForHosts,
  worldObjectForWatches,
  worldObjectWithWatches,
} from "./worldObject";
import { useWorldWatchlist, WorldWatchlistStore } from "./watchlistStore";
import "./world.css";
import "./windows/WorldLayout.css";
import { useHostsFilter } from "./hostsFilter";
import { HostsControl } from "./HostsControl";
import { WorldNavigator } from "./WorldNavigator";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import {
  readOfficePreferences,
  WORLD_OFFICE_PREFERENCES_CHANGED_EVENT,
  type OfficeInspectorPresentation,
} from "./officePreferences";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import WorldIntentProfile from "./WorldIntentProfile";
import {
  resolveVisualRouteActionTarget,
  visualRouteActionsForNode,
  visualRouteActionTarget,
  visualRouteTargetLabel,
  type VisualRouteAction,
  type VisualRouteActionTarget,
} from "./visualRouteActions";
import { useSpacesTabWindowArrangement } from "./useSpacesTabWindowArrangement";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import { WorldConnectionRequired, WorldTopbarStatus } from "./WorldStatus";
import { DeskView, useMediaQuery } from "./DeskView";
import { type FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import {
  terminalWindowArrangementReason,
  type TerminalWindowArrangementPreset,
  type TerminalWindowArrangementStage,
} from "./terminalWindowArrangement";
import {
  reconcileWorldInspectorConversation,
  retainWorldInspectorConversations,
  worldInspectorForNode,
  worldInspectorWindowId,
  worldInspectorWindowIdForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";
import { inspectorPaneInput } from "./inspectorTerminalHandoff";

export {
  retainWorldFloatingTerminals,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";

const EMPTY_VISUAL_ACTION_EXTENSION: CommandExtension = {
  captureKey: null,
  groups: [],
};

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
const OfficeObservabilityDialog = lazyWithReload("world-observability", () =>
  import("./PixelOfficeView").then((module) => ({
    default: module.OfficeObservabilityDialog,
  })),
);

export type WorldView = "desk" | "spaces" | "office" | "tree" | "graph";

const WORLD_VIEWS: readonly WorldView[] = [
  "desk",
  "office",
  "spaces",
  "tree",
  "graph",
];
const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  desk: "/desk",
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

const VISUAL_SCROLL_CONTROL_WIDTH = 32;

export function visualGridArrangementStage(
  stage: TerminalWindowArrangementStage,
): TerminalWindowArrangementStage {
  return {
    ...stage,
    width: Math.max(1, stage.width - VISUAL_SCROLL_CONTROL_WIDTH),
  };
}

export function visualInspectorTerminalActive(
  id: string,
  dockedId: string | null,
  dockedSuppressed: boolean,
  arrangedDocked: boolean,
  visibleFloatingIds: ReadonlySet<string>,
): boolean {
  return id === dockedId
    ? !dockedSuppressed && (!arrangedDocked || visibleFloatingIds.has(id))
    : visibleFloatingIds.has(id);
}

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

export function parseWorldView(value: unknown): WorldView {
  return WORLD_VIEWS.includes(value as WorldView)
    ? (value as WorldView)
    : "office";
}

export function worldViewFromPath(pathname: string): WorldView {
  if (pathname === "/desk") return "desk";
  if (pathname === "/spaces") return "spaces";
  if (pathname === "/tree") return "tree";
  if (pathname === "/graph") return "graph";
  if (pathname === "/office") return "office";
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
        !candidate.actionable ||
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
  const creationIntentRevision = useRef(0);
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
  const [visualActionExtension, setVisualActionExtension] =
    useState<CommandExtension>(EMPTY_VISUAL_ACTION_EXTENSION);
  const [visualArrangementControl, setVisualArrangementControl] = useState<
    WindowArrangementControl | undefined
  >();
  const [inspectorConversations, setInspectorConversations] = useState<
    WorldInspectorConversation[]
  >([]);
  const [activeInspectorWindowId, setActiveInspectorWindowId] = useState<
    string | null
  >(null);
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
  const [presentedStatusWorld, setPresentedStatusWorld] =
    useState<WorldObject | null>(null);
  const topbarConnectionId = useStoreSelector(
    (snapshot) => snapshot.activeConnectionId,
  );
  const conversationConnections = useStoreSelector(
    (snapshot) => snapshot.connections,
  );
  const catalogueReady = useStoreSelector(
    (snapshot) => snapshot.catalogueReady,
  );
  const hostsFilter = useHostsFilter(
    conversationConnections.map((connection) => connection.id),
    catalogueReady,
  );
  const topbarWorld = useMemo(
    () =>
      worldObjectForHosts(
        buildWorldObject(topbarRuntime.connections, topbarConnectionId),
        hostsFilter.ids,
      ),
    [topbarConnectionId, topbarRuntime.connections, hostsFilter.ids],
  );
  const conversationStatus = useStoreSelector((snapshot) => snapshot.status);
  const workspaceSurfaceInspectorConversation = inspectorConversations.find(
    (conversation) =>
      worldInspectorWindowId(conversation) === activeInspectorWindowId,
  );
  const changeWorkspaceSurfaceInspectorView = useCallback(
    (nextView: InspectorView) => {
      const conversation = workspaceSurfaceInspectorConversation;
      if (!conversation?.availableViews.includes(nextView)) return;
      creationIntentRevision.current++;
      setInspectorConversations((current) =>
        current.map((candidate) =>
          worldInspectorWindowId(candidate) ===
          worldInspectorWindowId(conversation)
            ? { ...candidate, view: nextView }
            : candidate,
        ),
      );
      const workspace = store
        .getConnection(conversation.connectionId)
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
      conversationStatus === "connected"
        ? conversationConnections
            .filter((connection) => connection.state === "ready")
            .map((connection) => ({
              connectionId: connection.id,
              runtimeGeneration: connection.generation,
            }))
        : [];
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
  }, [conversationConnections, conversationStatus, inspectorConversations]);

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
        shortcutId ? shortcutMatches(event, shortcutId) : false,
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
          shellActionsEnabled
          topbarPortal={topbarPortal}
          visualActionExtension={visualActionExtension}
          connectionControl={
            <HostsControl
              connections={conversationConnections}
              ids={hostsFilter.ids}
              explanation={hostsFilter.explanation}
              onChange={hostsFilter.setIds}
            />
          }
          workspaceNavigator={(onSelectionAdmitted) => (
            <WorldNavigator
              world={topbarWorld}
              onSelect={async (node, requestedView) => {
                if (node.kind === "host") return;
                if (view === "spaces") {
                  if (store.get().activeConnectionId !== node.connectionId)
                    await activateWorldNodeHost(node);
                  const resourceView =
                    requestedView ?? (node.kind === "space" ? "files" : null);
                  if (resourceView)
                    await dispatchWorldInspectorRequest(
                      node,
                      resourceView,
                      store,
                      window,
                      () => {
                        if (
                          store.get().activeConnectionId !== node.connectionId
                        )
                          throw new Error(
                            "The selected host changed while it was opening",
                          );
                      },
                    );
                  else {
                    window.dispatchEvent(
                      new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT),
                    );
                    await focusWorldNode(node);
                    if (store.get().activeConnectionId !== node.connectionId)
                      throw new Error(
                        "The selected host changed while it was opening",
                      );
                    onSelectionAdmitted();
                  }
                  return;
                }
                const admitted = await workspaceSurfaceSelectionRef.current?.({
                  connectionId: node.connectionId,
                  runtimeGeneration: node.generation,
                  view: requestedView,
                  workspaceId:
                    node.kind === "space" ? node.nativeId : node.workspaceId,
                  ...(node.kind === "space" ? {} : { paneId: node.nativeId }),
                });
                if (admitted) onSelectionAdmitted();
              }}
            />
          )}
          primaryViewControl={
            <div className="world-topbar-control-plane">
              <label
                className="world-primary-view-select"
                title={`World view: ${view}`}
              >
                <View
                  className="world-primary-view-icon"
                  size={18}
                  aria-hidden="true"
                />
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
                    world={presentedStatusWorld ?? topbarWorld}
                    selectedHostLabel={
                      hostsFilter.ids === null
                        ? "All hosts"
                        : `${hostsFilter.ids.length} selected hosts`
                    }
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
              creationIntentRevision={creationIntentRevision}
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
              onActiveInspectorChange={setActiveInspectorWindowId}
              onVisualArrangementControlReady={setVisualArrangementControl}
              onVisualActionExtensionReady={setVisualActionExtension}
              viewToolbarPortal={viewToolbarPortal}
              onGoToSpaces={() => setView("spaces")}
              onPresentedWorldChange={setPresentedStatusWorld}
            />
          }
          workspaceSurfaceVisible={view !== "spaces"}
          workspaceSurfaceContext={
            view !== "spaces" ? visualActionExtension?.context : null
          }
          arrangementControl={activeArrangementControl}
          spacesTabWindows={spaces.spacesTabWindows}
          onFocusSpacesTabWindow={spaces.onFocusSpacesTabWindow}
          spacesWindowsSuspended={spaces.suspended}
          presentedSpacesTabId={
            view === "spaces" ? spaces.presentedTabId : undefined
          }
          onSelectSpacesTab={spaces.resumeTab}
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
  onVisualActionExtensionReady,
  viewToolbarPortal,
  onGoToSpaces,
  onPresentedWorldChange,
}: {
  creationIntentRevision: { current: number };
  view: Exclude<WorldView, "spaces">;
  active: boolean;
  inspectorConversations: readonly WorldInspectorConversation[];
  dockedInspectorId: string | null;
  onDockedInspectorIdChange(windowId: string | null): void;
  onInspectorConversationsChange(
    conversations:
      | WorldInspectorConversation[]
      | ((
          current: WorldInspectorConversation[],
        ) => WorldInspectorConversation[]),
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
  onActiveInspectorChange(id: string | null): void;
  onVisualArrangementControlReady(
    control: WindowArrangementControl | undefined,
  ): void;
  onVisualActionExtensionReady(extension: CommandExtension): void;
  viewToolbarPortal: HTMLDivElement | null;
  onGoToSpaces(): void;
  onPresentedWorldChange(world: WorldObject): void;
}) {
  const runtime = useWorldRuntime();
  const watchlistStore = useMemo(() => new WorldWatchlistStore(bridge), []);
  const watchlist = useWorldWatchlist(watchlistStore);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const deskReadingPane = useMediaQuery("(min-width: 981px)");
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
      catalogueReady: snapshot.catalogueReady,
    }),
    shallowEqual,
  );
  const operationalSnapshot = useStoreSelector((snapshot) => snapshot);
  const hostsFilter = useHostsFilter(
    connectionSelection.connections.map((connection) => connection.id),
    connectionSelection.catalogueReady,
  );
  const hasSelectedConnection = hasValidSelectedConnection(
    connectionSelection.activeConnectionId,
    connectionSelection.connections,
  );
  const selectedWorldConnection = runtime.connections.find(
    (connection) =>
      connection.connectionId === connectionSelection.activeConnectionId,
  );
  const selectedWorldObservationActionable =
    selectedWorldConnection?.actionable ?? false;
  const aggregateWorld = useMemo(
    () =>
      buildWorldObject(
        runtime.connections,
        connectionSelection.activeConnectionId,
      ),
    [connectionSelection.activeConnectionId, runtime.connections],
  );
  const world = useMemo(
    () => worldObjectForHosts(aggregateWorld, hostsFilter.ids),
    [aggregateWorld, hostsFilter.ids],
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
  useLayoutEffect(
    () => onPresentedWorldChange(presentedWorld),
    [onPresentedWorldChange, presentedWorld],
  );
  const [selection, setSelection] = useState<WorldObjectNode | null>(null);
  const watchAdmissions = world.hosts.flatMap((host) =>
    host.connection.snapshot ? [host.connection.snapshot.watchAdmission] : [],
  );
  const unavailableWatchHosts = world.hosts.length - watchAdmissions.length;
  const unavailableWatchStatus = unavailableWatchHosts
    ? ` · ${unavailableWatchHosts} ${unavailableWatchHosts === 1 ? "host" : "hosts"} unavailable`
    : "";
  const watchCoverage = watchAdmissions.reduce(
    (counts, admission) => ({
      registered: counts.registered + (admission?.registered ?? 0),
      admitted: counts.admitted + (admission?.admitted ?? 0),
      missing: counts.missing + (admission?.missing ?? 0),
      unresolved: counts.unresolved + (admission?.unresolved ?? 0),
      admissionFailed:
        counts.admissionFailed + (admission?.admissionFailed ?? 0),
    }),
    {
      registered: 0,
      admitted: 0,
      missing: 0,
      unresolved: 0,
      admissionFailed: 0,
    },
  );
  const watchStatus =
    watchlist.error ??
    (!watchlist.verified
      ? "Watches unavailable while disconnected"
      : watchAdmissions.some(
            (admission) =>
              !admission || admission.revision !== watchlist.revision,
          )
        ? "Watch availability pending for filtered hosts"
        : `${watchCoverage.registered} pinned in filter · ${watchCoverage.admitted} admitted · ${watchCoverage.missing} missing · ${watchCoverage.unresolved} unresolved · ${watchCoverage.admissionFailed} not admitted${unavailableWatchStatus}`);
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
  const [windowLayer, setWindowLayer] = useState<HTMLDivElement | null>(null);
  const windowStage = useWindowWorkArea(windowLayer, active);
  const { mobile: compactArrangement } = useLayoutPreferences();
  const windowInputs = useMemo(
    () =>
      inspectorConversations.map((conversation, index) => ({
        id: worldInspectorWindowId(conversation),
        label: `${conversation.label} · ${conversation.hostLabel}`,
        initialSnap:
          view === "desk" ||
          (view === "office" && officeInspectorPresentation === "docked")
            ? ("right" as const)
            : undefined,
        initialGeometry: readFloatingTerminalGeometry(
          worldLocalStorage,
          floatingTerminalGeometryId(conversation),
          initialWindowRect(index, windowStage),
          windowStage,
          JSON.stringify([conversation.connectionId, conversation.nodeId]),
          fitWindow,
        ),
      })),
    [inspectorConversations, windowStage, view, officeInspectorPresentation],
  );
  const { state: managedWindows, dispatch: windowCommand } = useWindowManager(
    windowInputs,
    windowStage,
  );
  const activeInspectorId = managedWindows.activeId;
  useLayoutEffect(
    () => onActiveInspectorChange(activeInspectorId),
    [activeInspectorId, onActiveInspectorChange],
  );
  const contextRailInspector = inspectorConversations.find(
    (conversation) =>
      worldInspectorWindowId(conversation) === activeInspectorId,
  );
  const visibleFloatingInspectorIds = new Set(
    visibleWindowIds(managedWindows, compactArrangement),
  );
  const visibleFloatingInspectors = inspectorConversations.filter(
    (conversation) =>
      visibleFloatingInspectorIds.has(worldInspectorWindowId(conversation)),
  );
  const raiseInspector = useCallback(
    (id: string, pointer = false) =>
      windowCommand({ type: pointer ? "raise" : "focus", id }),
    [windowCommand],
  );
  const revealInspector = useCallback(
    (id: string) => windowCommand({ type: "focus", id }),
    [windowCommand],
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

  useLayoutEffect(() => {
    worldRuntimeStore.setVisibleConnectionIds(
      world.hosts
        .filter((host) =>
          connectionSelection.connections.some(
            (connection) => connection.id === host.connectionId,
          ),
        )
        .map((host) => host.connectionId),
    );
  }, [world, connectionSelection.connections]);

  useLayoutEffect(() => {
    worldRuntimeStore.setPriorities(
      snapshotPriorities.filter((priority) =>
        connectionSelection.connections.some(
          (connection) => connection.id === priority.connectionId,
        ),
      ),
    );
  }, [snapshotPriorities, connectionSelection.connections]);

  const availableWindowTabs = useMemo(() => {
    const tabs = new Map<string, WorldLeafObject>();
    for (const node of world.leaves) {
      if (
        !node.actionable ||
        !node.capabilities.openTerminal ||
        !connectionSelection.connections.some(
          (owner) =>
            owner.id === node.connectionId &&
            owner.state === "ready" &&
            owner.generation === node.generation,
        )
      )
        continue;
      const id = worldInspectorWindowIdForNode(node);
      if (!tabs.has(id) || node.focused) tabs.set(id, node);
    }
    return tabs;
  }, [world, connectionSelection.connections]);
  const pendingArrange = useRef(false);
  useLayoutEffect(() => {
    if (pendingArrange.current && windowStage.width > 0) {
      pendingArrange.current = false;
      windowCommand({
        type: "arrange",
        preset: "grid",
        includeMinimized: true,
      });
    }
  }, [inspectorConversations, windowStage.width, windowCommand]);
  const selectVisualArrangement = useCallback(
    (
      command:
        | TerminalWindowArrangementPreset
        | "restore"
        | "close-all"
        | "open-all",
    ) => {
      if (command === "open-all") {
        const uniqueTabs = availableWindowTabs;
        const omitted = Math.max(
          0,
          world.hosts.reduce((count, host) => count + host.coverage.tabs, 0) -
            uniqueTabs.size,
        );
        if (omitted > 0)
          store.notify({
            kind: "info",
            message: `Open all omitted ${omitted} observed ${omitted === 1 ? "tab" : "tabs"}`,
            detail:
              "Those tabs have no current available terminal target in the Hosts filter.",
          });
        const current = inspectorConversationsRef.current;
        const openIds = new Set(current.map(worldInspectorWindowId));
        const added: WorldInspectorConversation[] = [];
        const workspaces = new Map(
          world.spaces
            .filter((space) => space.actionable && !space.stale)
            .map((space) => [
              JSON.stringify([space.connectionId, space.nativeId]),
              space.workspace,
            ]),
        );
        for (const [id, node] of uniqueTabs) {
          if (openIds.has(id)) continue;
          const workspace = workspaces.get(
            JSON.stringify([node.connectionId, node.workspaceId]),
          );
          const context = worldInspectorContext(node);
          if (!workspace || !context) continue;
          const preferences = readInspectorPreferences(
            worldLocalStorage,
            resourceScopeForWorkspace(node.connectionId, workspace),
          );
          const conversation = worldInspectorForNode(
            node,
            "terminal",
            worldIntentViews(node),
            context,
            {
              dock: preferences.dock,
              expanded: preferences.expanded,
              size:
                preferences.dock === "right"
                  ? preferences.rightSize
                  : preferences.bottomSize,
            },
          );
          if (conversation) added.push(conversation);
        }

        const next = [...current, ...added];
        inspectorConversationsRef.current = next;
        onInspectorConversationsChangeRef.current(next);
        pendingArrange.current = true;
        return;
      }
      if (command === "close-all") {
        for (const conversation of inspectorConversationsRef.current)
          onInspectorTerminalPortalRef.current(
            worldInspectorWindowId(conversation),
            null,
          );
        inspectorConversationsRef.current = [];
        onInspectorConversationsChangeRef.current([]);
        onDockedInspectorIdChange(null);
        setSelection(null);
        return;
      }
      if (command === "restore") windowCommand({ type: "restore-layout" });
      else if (!compactArrangement || command === "single")
        windowCommand({ type: "arrange", preset: command });
    },
    [
      compactArrangement,
      onDockedInspectorIdChange,
      windowCommand,
      world,
      availableWindowTabs,
    ],
  );
  const visualArrangementControl = useMemo<WindowArrangementControl>(() => {
    const disabledReasons: WindowArrangementControl["disabledReasons"] = {};
    for (const preset of [
      "single",
      "cascade",
      "columns",
      "rows",
      "grid",
    ] as const) {
      const reason =
        compactArrangement && preset !== "single"
          ? "Available in desktop layout."
          : terminalWindowArrangementReason(
              preset,
              { left: 0, top: 0, ...windowStage },
              windowInputs
                .filter((input) => !managedWindows.windows[input.id]?.minimized)
                .map((input) => ({
                  ...input,
                  minWidth: Math.min(420, windowStage.width),
                  minHeight: Math.min(280, windowStage.height),
                })),
              activeInspectorId,
            );
      if (reason) disabledReasons[preset] = reason;
    }
    if (!managedWindows.baseline)
      disabledReasons.restore = "No arranged positions to restore.";
    if (!windowInputs.length)
      disabledReasons["close-all"] = "No windows are open.";
    if (!availableWindowTabs.size)
      disabledReasons["open-all"] =
        "No available terminal tabs in the Hosts filter.";
    else if (
      [...availableWindowTabs.keys()].every((id) => {
        const entry = managedWindows.windows[id];
        return entry && !entry.minimized && !entry.dismissed;
      })
    )
      disabledReasons["open-all"] = "All available tabs are already open.";
    return {
      activePreset:
        compactArrangement || managedWindows.focusMode
          ? "single"
          : (managedWindows.layout?.preset ?? null),
      disabledReasons,
      onSelect: selectVisualArrangement,
      windows: windowInputs.map((input) => ({
        id: input.id,
        tab: (() => {
          const conversation = inspectorConversations.find(
            (candidate) => worldInspectorWindowId(candidate) === input.id,
          );
          return conversation?.tabId
            ? {
                connectionId: conversation.connectionId,
                runtimeGeneration: conversation.runtimeGeneration,
                tabId: conversation.tabId,
              }
            : undefined;
        })(),
        label: input.label,
        active: input.id === activeInspectorId,
        minimized: managedWindows.windows[input.id]?.minimized ?? false,
        onSelect: () => {
          intentRequestRef.current++;
          windowCommand({ type: "focus", id: input.id });
          const conversation = inspectorConversationsRef.current.find(
            (candidate) => worldInspectorWindowId(candidate) === input.id,
          );
          if (conversation) {
            const node = aggregateWorld.nodeById.get(conversation.nodeId);
            if (node) setSelection(node);
          }
        },
      })),
    };
  }, [
    compactArrangement,
    windowStage,
    windowInputs,
    managedWindows,
    activeInspectorId,
    intentRequestRef,
    selectVisualArrangement,
    windowCommand,
    aggregateWorld,
    availableWindowTabs,
    inspectorConversations,
  ]);
  const arrangementRef = useRef(visualArrangementControl);
  arrangementRef.current = visualArrangementControl;
  const arrangementSignature = JSON.stringify([
    visualArrangementControl.activePreset,
    visualArrangementControl.disabledReasons,
    visualArrangementControl.windows?.map(
      ({ id, label, active, minimized, tab }) => ({
        id,
        label,
        active,
        minimized,
        tab,
      }),
    ),
  ]);
  useLayoutEffect(() => {
    const current = arrangementRef.current;
    onVisualArrangementControlReady({
      ...current,
      onSelect: (command) => arrangementRef.current.onSelect(command),
      windows: current.windows?.map((entry) => ({
        ...entry,
        onSelect: () =>
          arrangementRef.current.windows
            ?.find((candidate) => candidate.id === entry.id)
            ?.onSelect(),
      })),
    });
  }, [onVisualArrangementControlReady, arrangementSignature]);
  useLayoutEffect(
    () => () => onVisualArrangementControlReady(undefined),
    [onVisualArrangementControlReady],
  );

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

  const creationFocus = useRef(new Map<number, { intent: number }>());
  const creationAdmissions = useRef(new Set<AbortController>());
  const creationOpener = useRef(openTerminalById);
  creationOpener.current = openTerminalById;
  const creationCompletion = useRef<(event: CreationEvent) => void>(() => {});
  creationCompletion.current = (event) => {
    if (event.phase === "started") {
      creationFocus.current.set(event.id, {
        intent: intentRequestRef.current,
      });
      return;
    }
    if (event.phase === "dispatching") return;
    const captured = creationFocus.current.get(event.id);
    creationFocus.current.delete(event.id);
    // Presentation follows the current view; ownership and intent stay captured.
    if (event.phase !== "created" || !captured || !active) return;
    const identity = createdTerminalIdentity(event.result);
    const paneId = identity?.paneId;
    const title = event.kind === "tab" ? "Tab" : "Workspace";
    if (!identity || !paneId) {
      store.notify({
        kind: "error",
        message: `${title} created, but Inspector focus failed`,
        detail: "Herdr did not return the created terminal identity.",
      });
      return;
    }
    const preserveNamingNotice =
      store.get().notice?.message === "Tab created, but naming failed";
    if (!preserveNamingNotice)
      store.notify({
        kind: "success",
        message: `${title} created; opening terminal…`,
        loading: true,
      });
    const noticeId = store.get().notice?.id;
    let expectedIntent = captured.intent;
    const admission = new AbortController();
    creationAdmissions.current.add(admission);
    const latestWorld = () =>
      buildWorldObject(
        worldRuntimeStore.get().connections,
        store.get().activeConnectionId,
      );
    const exactNode = () =>
      latestWorld().leaves.find(
        (node) =>
          node.connectionId === event.connectionId &&
          node.generation === event.runtimeGeneration &&
          node.nativeId === paneId &&
          node.terminalId === identity.terminalId &&
          node.workspaceId === identity.workspaceId &&
          node.tabId === identity.tabId,
      );
    void admitCreatedTerminal({
      signal: admission.signal,
      subscribe: (listener) => {
        const offWorld = worldRuntimeStore.subscribe(listener);
        const offStore = store.subscribe(listener);
        return () => {
          offWorld();
          offStore();
        };
      },
      current: () => {
        const snapshot = store.get();
        const host = snapshot.connections.find(
          (connection) => connection.id === event.connectionId,
        );
        const node = exactNode();
        return {
          available: Boolean(node?.actionable && !node.stale),
          observation: `${worldRuntimeStore.get().observedAt}:${connectionSnapshot(snapshot, event.connectionId).lastRefresh}`,
          invalidReason:
            intentRequestRef.current !== expectedIntent
              ? "A newer Inspector selection superseded automatic focus."
              : snapshot.status !== "connected" ||
                  host?.state !== "ready" ||
                  host.generation !== event.runtimeGeneration
                ? "The owning host or runtime changed before terminal admission."
                : undefined,
        };
      },
      open: async (signal) => {
        const node = exactNode();
        if (!node)
          throw new Error("The created terminal is no longer available.");
        // The opener advances intent before synchronous browser navigation publishes.
        expectedIntent = intentRequestRef.current + 1;
        const opening = creationOpener.current(node.id, signal, latestWorld());
        expectedIntent = intentRequestRef.current;
        await opening;
      },
      observe: () => worldRuntimeStore.refresh(),
    })
      .then(() => {
        if (!preserveNamingNotice && store.get().notice?.id === noticeId)
          store.clearNotice();
      })
      .catch((error) => {
        if (!admission.signal.aborted)
          store.notify({
            kind: "error",
            message: `${title} created, but Inspector focus failed`,
            detail: String(error),
          });
      })
      .finally(() => creationAdmissions.current.delete(admission));
  };
  useEffect(() => {
    const unsubscribe = subscribeCreations((event) =>
      creationCompletion.current(event),
    );
    const focus = creationFocus.current;
    const admissions = creationAdmissions.current;
    return () => {
      unsubscribe();
      focus.clear();
      for (const admission of admissions) admission.abort();
      admissions.clear();
    };
  }, []);

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
  const shellActionContext = useRef({
    selected,
    world,
    activeConnectionId: connectionSelection.activeConnectionId,
    runtimeGeneration: connectionSelection.runtimeGeneration,
    applySelection,
    focusWorldNode,
    onGoToSpaces,
    watchlistVerified: watchlist.verified,
    watchlistRecords: watchlist.records,
  });
  shellActionContext.current = {
    selected,
    world,
    activeConnectionId: connectionSelection.activeConnectionId,
    runtimeGeneration: connectionSelection.runtimeGeneration,
    applySelection,
    focusWorldNode,
    onGoToSpaces,
    watchlistVerified: watchlist.verified,
    watchlistRecords: watchlist.records,
  };
  const runVisualResource = useCallback(
    (target: VisualRouteActionTarget, action: VisualRouteAction) => {
      const current = shellActionContext.current;
      const resolved = resolveVisualRouteActionTarget(target, current.world, {
        activeConnectionId: target.connectionId,
        runtimeGeneration:
          current.world.nodeById.get(target.id)?.generation ?? null,
        selectedId: current.selected?.id ?? null,
      });
      if (
        !resolved.node ||
        !visualRouteActionsForNode(resolved.node).includes(action)
      ) {
        setIntentError(
          resolved.reason ?? "The selected action is no longer available.",
        );
        return;
      }
      if (action !== "spaces") {
        void current.applySelection(resolved.node.id, action);
        return;
      }
      const node = resolved.node;
      const requestId = intentRequestRef.current + 1;
      intentRequestRef.current = requestId;
      setIntentError(null);
      setIntentOpening(true);
      void store
        .activateQualifiedSpacesTarget({
          connectionId: node.connectionId,
          runtimeGeneration: node.generation,
          workspaceId:
            node.kind === "space"
              ? node.nativeId
              : node.kind === "host"
                ? ""
                : node.workspaceId,
          paneId:
            node.kind === "agent" || node.kind === "terminal"
              ? node.nativeId
              : null,
        })
        .then((focused) => {
          if (!focused)
            throw new Error("The Spaces target is no longer available");
          if (intentRequestRef.current !== requestId) return;
          const owner = store
            .get()
            .connections.find(
              (connection) => connection.id === node.connectionId,
            );
          if (owner?.state !== "ready" || owner.generation !== node.generation)
            return;
          setSelection(node);
          current.onGoToSpaces();
        })
        .catch((cause: unknown) => {
          if (intentRequestRef.current === requestId)
            setIntentError(
              cause instanceof Error ? cause.message : String(cause),
            );
        })
        .finally(() => {
          if (intentRequestRef.current === requestId) setIntentOpening(false);
        });
    },
    [intentRequestRef],
  );
  const [workspaceCreationOpen, setWorkspaceCreationOpen] = useState(false);
  const [workspaceCreationDestination, setWorkspaceCreationDestination] =
    useState<{
      connectionId: string;
      runtimeGeneration: number;
      sourceWorkspaceId?: string;
    }>();
  const visualActionExtension = useMemo<CommandExtension>(() => {
    const target = visualRouteActionTarget(selected);
    const resolved = resolveVisualRouteActionTarget(target, world, {
      activeConnectionId: target?.connectionId ?? "",
      runtimeGeneration: target
        ? (world.nodeById.get(target.id)?.generation ?? null)
        : null,
      selectedId: selected?.id ?? null,
    });
    const labels: Record<VisualRouteAction, string> = {
      terminal: "Open Terminal",
      files: "Open Files",
      changes: "Open Changes",
      commits: "Open Git History",
      history: "Open Agent History",
      spaces: "Go to Spaces",
    };
    const icons = {
      terminal: <Terminal size={15} />,
      files: <FolderOpen size={15} />,
      changes: <LayoutGrid size={15} />,
      commits: <History size={15} />,
      history: <History size={15} />,
      spaces: <LayoutGrid size={15} />,
    };
    const targetActions =
      target && resolved.node
        ? visualRouteActionsForNode(resolved.node).map((action) => ({
            key: `visual-${action}`,
            icon: icons[action],
            title: labels[action],
            detail: visualRouteTargetLabel(resolved.node!),
            keywords: ["visual", "inspector", action],
            run: () => runVisualResource(target, action),
          }))
        : [
            {
              key: "visual-select-target",
              icon: <LayoutGrid size={15} />,
              title: "Select a visual entity for target actions",
              detail: resolved.reason ?? undefined,
              disabledReason:
                resolved.reason ?? "Select a space, agent, or terminal first.",
              run: () => {},
            },
          ];
    const workspaceId =
      resolved.node?.kind === "space"
        ? resolved.node.nativeId
        : resolved.node && resolved.node.kind !== "host"
          ? resolved.node.workspaceId
          : undefined;
    const creationActions = [
      {
        key: "visual-new-workspace",
        icon: <LayoutGrid size={15} />,
        title: "New workspace",
        detail: "Confirm a destination host",
        keywords: ["new", "create", "workspace", "room"],
        disabledReason: operationalSnapshot.connections.some(
          (connection) => connection.state === "ready",
        )
          ? null
          : "No destination host is ready.",
        run: () => {
          setWorkspaceCreationDestination(
            resolved.node
              ? {
                  connectionId: resolved.node.connectionId,
                  runtimeGeneration: resolved.node.generation,
                  sourceWorkspaceId: workspaceId,
                }
              : undefined,
          );
          setWorkspaceCreationOpen(true);
        },
      },
      {
        key: "visual-new-tab",
        icon: <Terminal size={15} />,
        title: "New tab",
        detail: resolved.node
          ? visualRouteTargetLabel(resolved.node)
          : "Select a workspace, agent or terminal",
        keywords: ["new", "create", "tab", "desk", "seat"],
        disabledReason:
          resolved.node && workspaceId
            ? (creationPendingReason(
                {
                  connectionId: resolved.node.connectionId,
                  runtimeGeneration: resolved.node.generation,
                },
                "tab",
                workspaceId,
                creationProgress,
              ) ??
              endpointCreationReason(
                connectionSnapshot(
                  operationalSnapshot,
                  resolved.node.connectionId,
                ),
                "tab.create",
                workspaceId,
                resolved.node.kind === "agent" ||
                  resolved.node.kind === "terminal"
                  ? resolved.node.nativeId
                  : undefined,
              ))
            : (resolved.reason ??
              "Select a workspace, agent or terminal first."),
        run: () => {
          const current = shellActionContext.current;
          const checked = resolveVisualRouteActionTarget(
            target,
            current.world,
            {
              activeConnectionId: target?.connectionId ?? "",
              runtimeGeneration: target?.runtimeGeneration ?? null,
              selectedId: current.selected?.id ?? null,
            },
          );
          if (!checked.node || checked.node.kind === "host") {
            setIntentError(checked.reason ?? "Select a workspace first.");
            return;
          }
          const workspaceId =
            checked.node.kind === "space"
              ? checked.node.nativeId
              : checked.node.workspaceId;
          void store
            .createQualifiedTab(
              {
                connectionId: checked.node.connectionId,
                runtimeGeneration: checked.node.generation,
              },
              workspaceId,
              {
                numberedLabel: true,
                sourcePaneId:
                  checked.node.kind === "agent" ||
                  checked.node.kind === "terminal"
                    ? checked.node.nativeId
                    : undefined,
              },
            )
            .catch((error) =>
              store.notify({
                kind: "error",
                message: creationFailureMessage(error, "Tab"),
                detail: String(error),
              }),
            );
        },
      },
    ];
    const pinNode =
      resolved.node &&
      (resolved.node.kind === "agent" || resolved.node.kind === "terminal")
        ? resolved.node
        : null;
    const selectedPinned = Boolean(
      pinNode &&
        watchlist.records.some(
          (record) =>
            record.connectionId === pinNode.connectionId &&
            record.generation === pinNode.generation &&
            record.terminalId === pinNode.terminalId,
        ),
    );
    const pinAction = pinNode
      ? [
          {
            key: "visual-pin",
            icon: selectedPinned ? <PinOff size={15} /> : <Pin size={15} />,
            title: selectedPinned ? "Unpin selected pane" : "Pin selected pane",
            detail: pinNode.label,
            disabledReason: watchlist.verified
              ? null
              : (watchlist.error ?? "Watches unavailable while disconnected"),
            run: () => {
              const current = shellActionContext.current;
              const checked = resolveVisualRouteActionTarget(
                target,
                current.world,
                {
                  activeConnectionId: target?.connectionId ?? "",
                  runtimeGeneration: target
                    ? (current.world.nodeById.get(target.id)?.generation ??
                      null)
                    : null,
                  selectedId: current.selected?.id ?? null,
                },
              );
              if (
                !checked.node ||
                (checked.node.kind !== "agent" &&
                  checked.node.kind !== "terminal") ||
                !current.watchlistVerified ||
                !checked.node.terminalId
              ) {
                setIntentError(
                  checked.reason ?? "The selected pane is unavailable.",
                );
                return;
              }
              const watch = {
                connectionId: checked.node.connectionId,
                generation: checked.node.generation,
                terminalId: checked.node.terminalId,
                label: checked.node.label,
              };
              const pinned = current.watchlistRecords.some(
                (record) =>
                  record.connectionId === watch.connectionId &&
                  record.generation === watch.generation &&
                  record.terminalId === watch.terminalId,
              );
              void watchlistStore.mutate(
                pinned ? "world.watchlist.unpin" : "world.watchlist.pin",
                watch,
              );
            },
          },
        ]
      : [];
    return {
      context: resolved.node
        ? {
            connectionId: resolved.node.connectionId,
            runtimeGeneration: resolved.node.generation,
          }
        : undefined,
      captureKey: resolved.node && target ? JSON.stringify(target) : null,
      groups: [
        { heading: "Create", actions: creationActions },
        { heading: "Visual selection", actions: targetActions },
        {
          heading: "Pinned panes",
          actions: [
            ...pinAction,
            {
              key: "visual-pinned-only",
              icon: <Pin size={15} />,
              title: pinnedOnly ? "Show all panes" : "Pinned only",
              detail: watchStatus,
              run: () => setPinnedOnly((value) => !value),
            },
          ],
        },
      ],
    };
  }, [
    operationalSnapshot,
    creationProgress,
    selected,
    world,
    watchlist.records,
    watchlist.verified,
    watchlist.error,
    pinnedOnly,
    watchStatus,
    watchlistStore,
    runVisualResource,
  ]);
  useLayoutEffect(() => {
    onVisualActionExtensionReady(
      active ? visualActionExtension : EMPTY_VISUAL_ACTION_EXTENSION,
    );
    return () => onVisualActionExtensionReady(EMPTY_VISUAL_ACTION_EXTENSION);
  }, [active, onVisualActionExtensionReady, visualActionExtension]);

  return (
    <main
      className="world-control-plane"
      id="world"
      data-active={active ? "true" : "false"}
    >
      <CreateWorkspaceDialog
        open={workspaceCreationOpen}
        initialDestination={workspaceCreationDestination}
        onClose={() => setWorkspaceCreationOpen(false)}
      />
      <ConfirmDialog
        open={inspectorClose !== null}
        title={`Close Inspector ${inspectorClose?.target.type ?? "tab"}`}
        message={`Close this ${inspectorClose?.target.type ?? "tab"} on ${inspectorClose?.conversation.hostLabel ?? "the captured host"}?`}
        confirmLabel="Close"
        danger
        onClose={() => setInspectorClose(null)}
        onConfirm={() => {
          const captured = inspectorClose;
          setInspectorClose(null);
          if (captured)
            void (
              captured.target.type === "pane"
                ? captured.operations.closePane(captured.target.id)
                : captured.operations.closeTab(captured.target.id)
            ).catch((error) =>
              store.notify({
                kind: "error",
                message: "Tab close failed",
                detail: String(error),
              }),
            );
        }}
      />
      {connectionSelection.connections.length === 0 ? (
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
                  {view === "desk" ? (
                    <DeskView
                      world={world}
                      aggregate={aggregateWorld}
                      onOpenTerminal={openTerminalById}
                      reading={
                        deskReadingPane && contextRailInspector
                          ? contextRailInspector.nodeId
                          : null
                      }
                      onPreview={deskReadingPane ? previewTerminalById : null}
                      onCloseReading={closeDeskReading}
                    />
                  ) : view === "office" ? (
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
                        selectedId={selectedId}
                        onSelect={selectNode}
                        floatingTerminals={inspectorConversations}
                        onConversationNodeAnchorsChange={
                          setVisualConversationAnchors
                        }
                        onOpenTerminal={openTerminalById}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
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
                        selectedId={selectedId}
                        conversationNodeIds={conversationNodeIds}
                        inlineInspectorNodeId={null}
                        onSelect={selectNode}
                        onOpenTerminal={openTerminalById}
                        onInlineInspectorPortalChange={() => {}}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                        onNodeAnchorsChange={setVisualConversationAnchors}
                      />
                    </Suspense>
                  ) : (
                    <SpatialGraphView
                      world={presentedWorld}
                      toolbarPortal={viewToolbarPortal}
                      selectedId={selectedId}
                      conversationNodeIds={conversationNodeIds}
                      onSelect={selectNode}
                      onOpenTerminal={openTerminalById}
                      onSelectedAnchorChange={setSelectedVisualAnchor}
                      onNodeAnchorsChange={setVisualConversationAnchors}
                    />
                  )}
                </WorldViewErrorBoundary>
              </Suspense>
            ) : null}
          </section>
          {showSelectionProfile && selected ? (
            <aside
              className="world-context-rail"
              ref={contextRailRef}
              aria-label="World context"
            >
              <WorldIntentProfile
                node={selected}
                currentGeneration={currentSelectionGeneration}
                inspectorOpen={Boolean(contextRailInspector)}
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
            </aside>
          ) : null}
          {!showSelectionProfile && intentError ? (
            <p className="world-panel-error" role="alert">
              {intentError}
            </p>
          ) : null}
          {visibleFloatingInspectors.map((conversation) => {
            const source =
              presentedWorld.nodeById.get(conversation.nodeId)?.generation ===
              conversation.runtimeGeneration
                ? visualConversationAnchors?.[conversation.nodeId]
                : null;
            const target =
              floatingWindowAnchors[worldInspectorWindowId(conversation)];
            return source && target ? (
              <Suspense
                key={worldInspectorWindowId(conversation)}
                fallback={null}
              >
                <WorldIntentConnector source={source} target={target} />
              </Suspense>
            ) : null;
          })}
          <WindowSurface
            state={managedWindows}
            dispatch={windowCommand}
            stage={windowStage}
            compact={compactArrangement}
            onLayer={setWindowLayer}
          >
            {({
              entry,
              geometry,
              stage,
              workArea,
              zIndex,
              active: windowActive,
            }) => {
              const conversation = inspectorConversations.find(
                (candidate) => worldInspectorWindowId(candidate) === entry.id,
              );
              if (!conversation) return null;
              return (
                <WindowFrame
                  key={entry.id}
                  id={entry.id}
                  label={conversation.label + " Inspector"}
                  geometry={geometry}
                  restoreGeometry={
                    entry.maximized ||
                    entry.placement.kind !== "floating" ||
                    managedWindows.focusMode
                      ? entry.floating
                      : undefined
                  }
                  stage={stage}
                  workArea={workArea}
                  zIndex={zIndex}
                  active={windowActive}
                  compact={compactArrangement}
                  className="world-floating-terminal"
                  onTerminalActivate={(paneId) => {
                    const snapshot = connectionSnapshot(
                      store.get(),
                      conversation.connectionId,
                    );
                    if (
                      snapshot.selectedPaneId ===
                      (paneId ?? conversation.paneId)
                    )
                      return;
                    const node = paneId
                      ? worldNodeForInspectorPaneFocus(
                          aggregateWorld,
                          conversation,
                          paneId,
                        )
                      : undefined;
                    void focusFloatingInspector(
                      conversation,
                      true,
                      undefined,
                      node ?? undefined,
                    ).catch(() => undefined);
                  }}
                  onRaise={(explicit) => {
                    if (explicit) intentRequestRef.current++;
                    inspectorFocusIntentRef.current += 1;
                    windowCommand({ type: "raise", id: entry.id });
                  }}
                  onPlace={(rect) => {
                    writeFloatingTerminalGeometry(
                      worldLocalStorage,
                      floatingTerminalGeometryId(conversation),
                      rect,
                    );
                    windowCommand({ type: "place", id: entry.id, rect });
                  }}
                  onSnap={(target) =>
                    windowCommand({ type: "snap", id: entry.id, target })
                  }
                  onMaximize={() =>
                    windowCommand({ type: "maximize", id: entry.id })
                  }
                  onBoundsChange={(bounds) =>
                    setFloatingWindowAnchors((current) => {
                      const previous = current[entry.id];
                      return previous === bounds ||
                        (previous &&
                          bounds &&
                          previous.left === bounds.left &&
                          previous.top === bounds.top &&
                          previous.right === bounds.right &&
                          previous.bottom === bounds.bottom)
                        ? current
                        : { ...current, [entry.id]: bounds };
                    })
                  }
                  onPortalChange={(portal) =>
                    setFloatingInspectorPortals((current) =>
                      current[entry.id] === portal
                        ? current
                        : { ...current, [entry.id]: portal },
                    )
                  }
                >
                  {!world.hosts.some(
                    (host) => host.connectionId === conversation.connectionId,
                  ) && (
                    <div className="world-window-scope" role="status">
                      <span>
                        Outside Hosts filter · {conversation.hostLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          hostsFilter.setIds(
                            hostsFilter.ids === null
                              ? null
                              : [
                                  ...new Set([
                                    ...hostsFilter.ids,
                                    conversation.connectionId,
                                  ]),
                                ],
                          )
                        }
                      >
                        Reveal in Hosts
                      </button>
                    </div>
                  )}
                </WindowFrame>
              );
            }}
          </WindowSurface>
        </div>
      )}
      <Suspense fallback={null}>
        {inspectorConversations.map((conversation) => (
          <WorldInspectorConversationView
            key={worldInspectorWindowId(conversation)}
            conversation={conversation}
            target={
              visibleFloatingInspectorIds.has(
                worldInspectorWindowId(conversation),
              )
                ? (floatingInspectorPortals[
                    worldInspectorWindowId(conversation)
                  ] ?? null)
                : null
            }
            floating
            terminalActive={
              visibleFloatingInspectorIds.has(
                worldInspectorWindowId(conversation),
              ) &&
              Boolean(
                floatingInspectorPortals[worldInspectorWindowId(conversation)],
              )
            }
            onChange={(change) => {
              if (change.view && change.view !== conversation.view)
                intentRequestRef.current++;
              const next = inspectorConversationsRef.current.map((candidate) =>
                worldInspectorWindowId(candidate) ===
                worldInspectorWindowId(conversation)
                  ? { ...candidate, ...change }
                  : candidate,
              );
              inspectorConversationsRef.current = next;
              onInspectorConversationsChange(next);
            }}
            onClose={() => closeInspector(conversation)}
            windowControls={{
              compact: compactArrangement,
              maximized:
                managedWindows.windows[worldInspectorWindowId(conversation)]
                  ?.maximized === true || managedWindows.focusMode,
              onMinimize: () =>
                windowCommand({
                  type: "minimize",
                  id: worldInspectorWindowId(conversation),
                }),
              onMaximize: () =>
                windowCommand({
                  type: "maximize",
                  id: worldInspectorWindowId(conversation),
                }),
              onClose: () => closeInspector(conversation),
              onSnap: (target) =>
                windowCommand({
                  type: "snap",
                  id: worldInspectorWindowId(conversation),
                  target,
                }),
              onFloat: () =>
                windowCommand({
                  type: "float",
                  id: worldInspectorWindowId(conversation),
                }),
            }}
            onResourceFocus={() => {
              intentRequestRef.current++;
              const id = worldInspectorWindowId(conversation);
              raiseInspector(id);
              revealInspector(id);
            }}
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

export function shouldRecordVisualInspectorGeometry(
  id: string,
  maximizedInspectorId: string | null,
  compactArrangement: boolean,
) {
  return !compactArrangement && id !== maximizedInspectorId;
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
  return node !== null && !node.actionable;
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
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
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

function worldNodeLeaseIsCurrent(
  node: WorldObjectNode,
  focusStore: WorldFocusStore,
) {
  const snapshot = focusStore.get();
  const connection = snapshot.connections.find(
    (candidate) => candidate.id === node.connectionId,
  );
  return (
    connection?.state === "ready" &&
    connection.generation === node.generation &&
    node.actionable
  );
}

export async function focusWorldNode(
  node: WorldObjectNode,
  focusStore: WorldFocusStore = store,
  agentSessionId?: string,
) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
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
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
    throw new Error("The selected host changed while it was opening");
  }
  const focused = await focusStore.focusQualifiedTarget({
    connectionId: node.connectionId,
    runtimeGeneration: node.generation,
    workspaceId: target.workspaceId,
    paneId: target.paneId,
    ...(agentSessionId ? { agentSessionId } : {}),
  });
  if (!focused) {
    throw new Error("The selected item could not be focused");
  }
  if (!worldNodeLeaseIsCurrent(node, focusStore)) {
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

/** Apply observed metadata only to the conversations present when it was read. */
export function reconcileObservedInspectors(
  current: readonly WorldInspectorConversation[],
  observed: readonly WorldInspectorConversation[],
  retained: readonly WorldInspectorConversation[],
) {
  const before = new Map(
    observed.map((conversation) => [
      worldInspectorWindowId(conversation),
      conversation,
    ]),
  );
  const after = new Map(
    retained.map((conversation) => [
      worldInspectorWindowId(conversation),
      conversation,
    ]),
  );
  return current.flatMap((conversation) => {
    const id = worldInspectorWindowId(conversation);
    if (before.get(id) !== conversation) return [conversation];
    const replacement = after.get(id);
    return replacement ? [replacement] : [];
  });
}
