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
import {
  FolderOpen,
  History,
  LayoutGrid,
  Pin,
  PinOff,
  Terminal,
} from "lucide-react";
import App, { type WorkspaceSurfaceSelection } from "../App";
import { measuredFixedPositionScale } from "../fixedPositionScale";
import { bridge, type ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import {
  WINDOW_ARRANGEMENT_CHOICES,
  type WindowArrangementControl,
} from "../components/WindowArrangementMenu";
import type { CommandExtension } from "../components/CommandCombobox";
import { ConfirmDialog } from "../components/ModalDialogs";
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
import { listenForInspectorWindowRaise } from "./inspectorWindowFocus";
import { WorldConnectionRequired, WorldTopbarStatus } from "./WorldStatus";
import {
  defaultFloatingTerminalGeometry,
  FLOATING_TERMINAL_MIN_SIZE,
  resizeFloatingTerminalGeometry,
  resizeMinimumForGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import {
  terminalArrangementContentWidth,
  terminalArrangementScrollLeftForWindow,
  terminalArrangementWindowVisible,
  terminalGridContentHeight,
  terminalGridScrollTopForWindow,
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
  mode: "moving" | "resizing";
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
    (snapshot) => snapshot.status === "connected",
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
          workspaceNavigator={
            <WorldNavigator
              world={topbarWorld}
              onSelect={(node) => {
                if (node.kind === "host") return;
                void workspaceSurfaceSelectionRef.current?.({
                  connectionId: node.connectionId,
                  runtimeGeneration: node.generation,
                  workspaceId:
                    node.kind === "space" ? node.nativeId : node.workspaceId,
                  ...(node.kind === "space" ? {} : { paneId: node.nativeId }),
                });
              }}
            />
          }
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
              onVisualActionExtensionReady={setVisualActionExtension}
              viewToolbarPortal={viewToolbarPortal}
              onGoToSpaces={() => setView("spaces")}
              onPresentedWorldChange={setPresentedStatusWorld}
            />
          }
          workspaceSurfaceVisible={view !== "spaces"}
          arrangementControl={activeArrangementControl}
          spacesTabWindows={spaces.spacesTabWindows}
          onFocusSpacesTabWindow={spaces.onFocusSpacesTabWindow}
          spacesWindowsSuspended={spaces.suspended}
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
  onVisualActionExtensionReady,
  viewToolbarPortal,
  onGoToSpaces,
  onPresentedWorldChange,
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
  onVisualActionExtensionReady(extension: CommandExtension): void;
  viewToolbarPortal: HTMLDivElement | null;
  onGoToSpaces(): void;
  onPresentedWorldChange(world: WorldObject): void;
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
  const operationalSnapshot = useStoreSelector((snapshot) => snapshot);
  const hostsFilter = useHostsFilter(
    connectionSelection.connections.map((connection) => connection.id),
    connectionSelection.status === "connected",
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
  const watchAdmissions = world.hosts.map(
    (host) => host.connection.snapshot?.watchAdmission,
  );
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
        : `${watchCoverage.registered} pinned in filter · ${watchCoverage.admitted} admitted · ${watchCoverage.missing} missing · ${watchCoverage.unresolved} unresolved · ${watchCoverage.admissionFailed} not admitted`);
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
  const [visualScrollOffset, setVisualScrollOffset] = useState(0);
  const visualGridAutoFocusKeyRef = useRef<string | null>(null);
  const [excludedArrangementIds, setExcludedArrangementIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [singleManualGeometry, setSingleManualGeometry] = useState<
    Record<string, FloatingTerminalGeometry>
  >({});
  const [maximizedInspectorId, setMaximizedInspectorId] = useState<
    string | null
  >(null);
  const [raisedInspectorIds, setRaisedInspectorIds] = useState<string[]>([]);
  const [inlineReturnNodeId, setInlineReturnNodeId] = useState<string | null>(
    null,
  );
  const worldViewLayoutRef = useRef<HTMLDivElement | null>(null);
  const [intentOverlayAnchor, setIntentOverlayAnchor] =
    useState<WorldConnectorTargetBounds | null>(null);
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
  const visualLeaseKey = "world-visual-contexts";
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
          ? Math.min(
              FLOATING_TERMINAL_MIN_SIZE.width,
              visualArrangementStage.width,
            )
          : FLOATING_TERMINAL_MIN_SIZE.width,
        minHeight: compactArrangement
          ? Math.min(
              FLOATING_TERMINAL_MIN_SIZE.height,
              visualArrangementStage.height,
            )
          : FLOATING_TERMINAL_MIN_SIZE.height,
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
  const visualScrollX =
    arrangementScope?.preset === "columns" && !compactArrangement;
  const visualScrollY =
    (arrangementScope?.preset === "grid" ||
      arrangementScope?.preset === "rows" ||
      arrangementScope?.preset === "cascade") &&
    !compactArrangement;
  const visualScrollActive = visualScrollX || visualScrollY;
  const visualContentWidth = visualScrollX
    ? terminalArrangementContentWidth(
        visualPlacements ?? [],
        visualArrangementStage.width,
        visualArrangementStage.left,
      )
    : visualArrangementStage.width;
  const visualContentHeight = visualScrollY
    ? terminalGridContentHeight(
        visualPlacements ?? [],
        visualArrangementStage.height,
        visualArrangementStage.top,
      )
    : visualArrangementStage.height;
  const visualNeedsHorizontalScroll =
    visualScrollX && visualContentWidth > visualArrangementStage.width;
  const visualNeedsVerticalScroll =
    visualScrollY && visualContentHeight > visualArrangementStage.height;
  const visualScrollViewport = {
    ...visualArrangementStage,
    width: Math.max(
      1,
      visualArrangementStage.width -
        (visualNeedsVerticalScroll ? VISUAL_SCROLL_CONTROL_WIDTH : 0),
    ),
    height: Math.max(
      1,
      visualArrangementStage.height - (visualNeedsHorizontalScroll ? 36 : 0),
    ),
  };
  const visualContentBounds = {
    ...visualArrangementStage,
    width: visualScrollX
      ? visualContentWidth
      : visualNeedsVerticalScroll
        ? Math.max(
            1,
            visualArrangementStage.width - VISUAL_SCROLL_CONTROL_WIDTH,
          )
        : visualArrangementStage.width,
    height: visualNeedsHorizontalScroll
      ? Math.max(1, visualArrangementStage.height - 36)
      : visualContentHeight,
  };
  const visualPlacementMap = new Map(
    (visualPlacements ?? [])
      .filter(({ id }) => !excludedArrangementIds.has(id))
      .map(({ id, geometry }) => [
        id,
        fitVisualInspectorArrangementGeometry(
          !compactArrangement && arrangementScope?.preset === "single"
            ? (singleManualGeometry[id] ?? geometry)
            : geometry,
          visualScrollActive ? visualContentBounds : visualArrangementStage,
        ),
      ]),
  );
  if (
    maximizedInspectorId &&
    visualWindows.some(({ id }) => id === maximizedInspectorId)
  ) {
    visualPlacementMap.set(maximizedInspectorId, { ...visualArrangementStage });
  }
  const visualScrollMax = Math.max(
    0,
    visualScrollX
      ? visualContentWidth - visualScrollViewport.width
      : visualContentHeight - visualScrollViewport.height,
  );
  const visualScrollPosition = Math.min(visualScrollMax, visualScrollOffset);
  const visualScrollLeft = visualScrollX ? visualScrollPosition : 0;
  const visualGridScrollTop = visualScrollY ? visualScrollPosition : 0;
  const visualScrollControlPosition = visualScrollX
    ? {
        left: visualArrangementStage.left + 8,
        top: visualArrangementStage.top + visualArrangementStage.height - 36,
        width: Math.min(480, visualArrangementStage.width - 16),
      }
    : {
        left:
          visualArrangementStage.left +
          visualArrangementStage.width -
          VISUAL_SCROLL_CONTROL_WIDTH,
        top: visualArrangementStage.top + 48,
        height: Math.min(480, visualArrangementStage.height - 56),
      };
  const scrollVisualArrangement = (position: number) =>
    setVisualScrollOffset(Math.max(0, Math.min(visualScrollMax, position)));
  const visualPlacementMapRef = useRef(visualPlacementMap);
  visualPlacementMapRef.current = visualPlacementMap;
  useEffect(() => {
    if (!visualScrollActive || !activeInspectorId) {
      visualGridAutoFocusKeyRef.current = null;
      return;
    }
    const geometry = visualPlacementMapRef.current.get(activeInspectorId);
    if (!geometry) return;
    const key = `${visualLeaseKey}:${arrangementScope?.preset}:${activeInspectorId}`;
    if (visualGridAutoFocusKeyRef.current === key) return;
    visualGridAutoFocusKeyRef.current = key;
    if (visualScrollY) {
      const next = terminalGridScrollTopForWindow(
        geometry,
        visualScrollPosition,
        visualScrollViewport.height,
        visualContentHeight,
        visualArrangementStage.top,
      );
      if (next !== visualScrollPosition) setVisualScrollOffset(next);
    }
    if (visualScrollX) {
      const next = terminalArrangementScrollLeftForWindow(
        geometry,
        visualScrollPosition,
        visualScrollViewport.width,
        visualContentWidth,
        visualArrangementStage.left,
      );
      if (next !== visualScrollPosition) setVisualScrollOffset(next);
    }
  }, [
    activeInspectorId,
    arrangementScope?.preset,
    visualScrollActive,
    visualScrollX,
    visualScrollY,
    visualContentHeight,
    visualContentWidth,
    visualLeaseKey,
    visualArrangementStage.height,
    visualArrangementStage.left,
    visualArrangementStage.top,
    visualScrollViewport.height,
    visualScrollViewport.width,
    visualScrollPosition,
  ]);
  const openInspectorIds = visualWindows.map(({ id }) => id);
  const inspectorStack = [
    ...openInspectorIds.filter((id) => !raisedInspectorIds.includes(id)),
    ...raisedInspectorIds.filter((id) => openInspectorIds.includes(id)),
  ];
  const visualScrollContextRef = useRef({
    active: visualScrollActive,
    leaseKey: visualLeaseKey,
    preset: arrangementScope?.preset,
    horizontal: visualScrollX,
    placements: visualPlacementMap,
    max: visualScrollMax,
    viewport: visualScrollViewport,
    contentWidth: visualContentWidth,
    contentHeight: visualContentHeight,
    stage: visualArrangementStage,
  });
  visualScrollContextRef.current = {
    active: visualScrollActive,
    leaseKey: visualLeaseKey,
    preset: arrangementScope?.preset,
    horizontal: visualScrollX,
    placements: visualPlacementMap,
    max: visualScrollMax,
    viewport: visualScrollViewport,
    contentWidth: visualContentWidth,
    contentHeight: visualContentHeight,
    stage: visualArrangementStage,
  };
  const raiseInspector = useCallback((id: string, pointer = false) => {
    setRaisedInspectorIds((current) =>
      current[current.length - 1] === id
        ? current
        : [...current.filter((candidate) => candidate !== id), id],
    );
    if (pointer && visualScrollContextRef.current.active) {
      const scroll = visualScrollContextRef.current;
      visualGridAutoFocusKeyRef.current = `${scroll.leaseKey}:${scroll.preset}:${id}`;
    }
  }, []);
  const revealInspector = useCallback((id: string) => {
    const scroll = visualScrollContextRef.current;
    const geometry = scroll.placements.get(id);
    if (!scroll.active || !geometry) return;
    setVisualScrollOffset((current) => {
      const position = Math.min(scroll.max, current);
      return scroll.horizontal
        ? terminalArrangementScrollLeftForWindow(
            geometry,
            position,
            scroll.viewport.width,
            scroll.contentWidth,
            scroll.stage.left,
          )
        : terminalGridScrollTopForWindow(
            geometry,
            position,
            scroll.viewport.height,
            scroll.contentHeight,
            scroll.stage.top,
          );
    });
  }, []);
  const arrangedDocked =
    dockedInspectorId !== null && visualPlacementMap.has(dockedInspectorId);
  const dockedSuppressed =
    dockedInspectorId !== null &&
    (arrangementScope?.preset === "single" ||
      (Boolean(arrangementScope?.preset) && compactArrangement)) &&
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
  useEffect(() => {
    if (!dockedInspectorPortal || !dockedInspectorId) return;
    const raise = () => raiseInspector(dockedInspectorId, true);
    const reveal = () => {
      raiseInspector(dockedInspectorId);
      revealInspector(dockedInspectorId);
    };
    return listenForInspectorWindowRaise(dockedInspectorPortal, raise, reveal);
  }, [
    dockedInspectorId,
    dockedInspectorPortal,
    raiseInspector,
    revealInspector,
  ]);
  const dockedInspectorPortalRef = useRef<Element | null>(null);
  dockedInspectorPortalRef.current = dockedInspectorPortal;
  const dockedInspectorNodeId = contextRailInspector?.nodeId ?? null;
  const dockedInspectorExpanded = contextRailInspector?.expanded ?? false;
  const visibleFloatingInspectors = inspectorConversations.filter(
    (conversation) => {
      const id = worldInspectorWindowId(conversation);
      const scrollGeometry = visualScrollActive
        ? visualPlacementMap.get(id)
        : undefined;
      if (
        scrollGeometry &&
        id !== maximizedInspectorId &&
        !terminalArrangementWindowVisible(
          scrollGeometry,
          visualScrollLeft,
          visualGridScrollTop,
          visualScrollViewport.width,
          visualScrollViewport.height,
          visualArrangementStage.left,
          visualArrangementStage.top,
        )
      ) {
        return false;
      }
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
    setMaximizedInspectorId(null);
    setRaisedInspectorIds([]);
    setExcludedArrangementIds(new Set());
    setSingleManualGeometry({});
    setInlineReturnNodeId(null);
  }, [visualLeaseKey]);

  useEffect(() => {
    if (
      maximizedInspectorId &&
      !visualWindows.some(({ id }) => id === maximizedInspectorId)
    ) {
      setMaximizedInspectorId(null);
    }
  }, [maximizedInspectorId, visualWindows]);

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
    (
      command:
        | TerminalWindowArrangementPreset
        | "restore"
        | "close-all"
        | "open-all",
    ) => {
      if (command === "open-all") {
        const selectedHostLeaves = world.leaves.filter(
          (node) =>
            node.actionable &&
            node.capabilities.openTerminal &&
            store
              .get()
              .connections.some(
                (owner) =>
                  owner.id === node.connectionId &&
                  owner.state === "ready" &&
                  owner.generation === node.generation,
              ),
        );
        const uniqueTabs = new Map<string, WorldLeafObject>();
        for (const node of selectedHostLeaves) {
          const id = worldInspectorWindowIdForNode(node);
          const previous = uniqueTabs.get(id);
          if (!previous || node.focused) uniqueTabs.set(id, node);
        }
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
        if (added.length === 0) return;
        const next = [...current, ...added];
        inspectorConversationsRef.current = next;
        onInspectorConversationsChangeRef.current(next);
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const newWindows: TerminalWindowArrangementParticipant<VisualInspectorPresentation>[] =
          added.map((conversation, index) => ({
            id: worldInspectorWindowId(conversation),
            minWidth: FLOATING_TERMINAL_MIN_SIZE.width,
            minHeight: FLOATING_TERMINAL_MIN_SIZE.height,
            geometry: defaultFloatingTerminalGeometry(
              current.length + index,
              viewport,
            ),
            presentation: { kind: "floating" },
          }));
        const arranged = applyTerminalWindowArrangement(
          visualArrangementState,
          {
            leaseKey: visualLeaseKey,
            scopeKey: VISUAL_ARRANGEMENT_SCOPE,
            preset: "grid",
            stage: visualGridArrangementStage(visualArrangementStage),
            windows: [...visualWindows, ...newWindows],
            activeId: activeInspectorId ?? newWindows[0]?.id ?? null,
          },
        );
        if (arranged.result.available) {
          setVisualArrangementState(arranged.state);
          setVisualScrollOffset(0);
          visualGridAutoFocusKeyRef.current = null;
        } else if (arrangementScope?.preset === "single") {
          setVisualArrangementState(
            createTerminalWindowArrangementState(visualLeaseKey),
          );
        }
        return;
      }
      if (command === "close-all") {
        if (inspectorConversationsRef.current.length === 0) return;
        intentRequestRef.current += 1;
        for (const conversation of inspectorConversationsRef.current) {
          onInspectorTerminalPortalRef.current(
            worldInspectorWindowId(conversation),
            null,
          );
        }
        inspectorConversationsRef.current = [];
        onInspectorConversationsChangeRef.current([]);
        dockedInspectorIdRef.current = null;
        onDockedInspectorIdChange(null);
        setVisualArrangementState(
          createTerminalWindowArrangementState(visualLeaseKey),
        );
        setExcludedArrangementIds(new Set());
        setSingleManualGeometry({});
        setMaximizedInspectorId(null);
        setRaisedInspectorIds([]);
        setSelection(null);
        return;
      }
      // Compact presentation is derived from the desktop placement snapshot.
      // A stale menu or a direct command must not replace that snapshot.
      if (compactArrangement) return;
      const openIds = visualWindows.map(({ id }) => id);
      if (command === "restore") {
        setMaximizedInspectorId(null);
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
      // The observer can still hold the previous stage during a resize click.
      // Resolve this arrangement against the bounds visible at selection time.
      const layout = worldViewLayoutRef.current;
      const stage = layout
        ? visualInspectorArrangementStage(
            layout.getBoundingClientRect(),
            measuredFixedPositionScale(),
          )
        : visualArrangementStage;
      setVisualArrangementStage((current) =>
        current.left === stage.left &&
        current.top === stage.top &&
        current.width === stage.width &&
        current.height === stage.height
          ? current
          : stage,
      );
      const applied = applyTerminalWindowArrangement(visualArrangementState, {
        leaseKey: visualLeaseKey,
        scopeKey: VISUAL_ARRANGEMENT_SCOPE,
        preset: command,
        stage: command === "grid" ? visualGridArrangementStage(stage) : stage,
        windows: visualWindows,
        activeId: activeInspectorId,
      });
      if (!applied.result.available) return;
      setMaximizedInspectorId(null);
      if (
        command === "grid" ||
        command === "rows" ||
        command === "columns" ||
        command === "cascade"
      ) {
        setVisualScrollOffset(0);
        visualGridAutoFocusKeyRef.current = null;
      }
      setVisualArrangementState(applied.state);
      setExcludedArrangementIds(new Set());
      setSingleManualGeometry({});
      setInlineReturnNodeId(null);
    },
    [
      activeInspectorId,
      arrangementScope,
      compactArrangement,
      dockedInspectorId,
      onDockedInspectorIdChange,
      visualArrangementStage,
      visualArrangementState,
      visualLeaseKey,
      visualWindows,
      world,
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
      if (compactArrangement) {
        disabledReasons[preset] = "Available in desktop layout.";
        continue;
      }
      const reason = terminalWindowArrangementReason(
        preset,
        preset === "grid"
          ? visualGridArrangementStage(visualArrangementStage)
          : visualArrangementStage,
        visualWindows,
        activeInspectorId,
      );
      if (reason) disabledReasons[preset] = reason;
    }
    if (compactArrangement) {
      disabledReasons.restore = "Available in desktop layout.";
    } else if (
      !arrangementScope ||
      Object.keys(arrangementScope.baselines).length === 0
    ) {
      disabledReasons.restore = "No arranged positions to restore.";
    }
    if (visualWindows.length === 0) {
      disabledReasons["close-all"] = "No terminal windows are presented.";
    }
    {
      const openIds = new Set(visualWindows.map(({ id }) => id));
      const unopened = world.leaves.some(
        (node) =>
          node.actionable &&
          node.capabilities.openTerminal &&
          !openIds.has(worldInspectorWindowIdForNode(node)),
      );
      if (!unopened) {
        disabledReasons["open-all"] =
          "All available terminals on this host are already open.";
      }
    }
    return {
      activePreset: compactArrangement
        ? "single"
        : (arrangementScope?.preset ?? null),
      disabledReasons,
      onSelect: selectVisualArrangement,
    };
  }, [
    activeInspectorId,
    arrangementScope,
    compactArrangement,
    selectVisualArrangement,
    visualArrangementStage,
    visualWindows,
    world.leaves,
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
      const resizing = Boolean(
        event.target.closest(".world-context-rail-resize"),
      );
      const handle = event.target.closest(
        ".workspace-inspector-head.is-docked-window-drag-handle",
      );
      if (!resizing && (!handle || event.target.closest(interactiveSelector)))
        return;
      event.preventDefault();
      const railBounds = rail.getBoundingClientRect();
      const geometry = {
        left: railBounds.left,
        top: railBounds.top,
        width: railBounds.width,
        height: railBounds.height,
      };
      dockedInspectorMoveRef.current = {
        mode: resizing ? "resizing" : "moving",
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
      const viewport = inspectorViewportBounds();
      setDockedInspectorGeometry(
        current.mode === "resizing"
          ? resizeFloatingTerminalGeometry(
              current.geometry,
              event.clientX - current.startX,
              event.clientY - current.startY,
              viewport,
              resizeMinimumForGeometry(
                current.geometry,
                FLOATING_TERMINAL_MIN_SIZE,
              ),
            )
          : moveDockedInspectorGeometry(
              current.geometry,
              event.clientX - current.startX,
              event.clientY - current.startY,
              viewport,
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
      if (!(event.target instanceof Element)) return;
      const resizing = event.target.matches(".world-context-rail-resize");
      if (
        !resizing &&
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
      const viewport = inspectorViewportBounds();
      setDockedInspectorGeometry(
        resizing
          ? resizeFloatingTerminalGeometry(
              geometry,
              delta.x,
              delta.y,
              viewport,
              resizeMinimumForGeometry(geometry, FLOATING_TERMINAL_MIN_SIZE),
            )
          : moveDockedInspectorGeometry(geometry, delta.x, delta.y, viewport),
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
    const workspace = connectionSnapshot(
      store.get(),
      node.connectionId,
    ).workspaces.find((candidate) => candidate.workspace_id === workspaceId);
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
      const target =
        dockedInspectorIdRef.current === windowId
          ? dockedInspectorPortalRef.current
          : floatingInspectorPortalsRef.current[windowId];
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
  ): Promise<boolean> => {
    if (signal?.aborted) return false;
    const next = id ? (candidateWorld.nodeById.get(id) ?? null) : null;
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setIntentError(null);
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
    setInlineReturnNodeId(null);
    if (!next || next.kind === "host" || !next.actionable) {
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
      const unbindAbort = bindSelectionIntentAbort(signal, requestId);
      try {
        if (focusTarget) await focusWorldNode(next);
        if (signal?.aborted || intentRequestRef.current !== requestId)
          return false;
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
        unbindAbort();
        if (intentRequestRef.current === requestId) setIntentOpening(false);
      }
      return true;
    }
    const conversation = conversationFor(next, requestedView);
    if (!conversation) return false;
    setIntentOpening(true);
    const unbindAbort = bindSelectionIntentAbort(signal, requestId);
    try {
      if (focusTarget) await focusWorldNode(next);
      if (signal?.aborted || intentRequestRef.current !== requestId)
        return false;
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
      const admittedConversation = {
        ...conversation,
        focusedListAdmissionAt: performance.now(),
      };
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
        admittedConversation,
      ];
      inspectorConversationsRef.current = nextConversations;
      onInspectorConversationsChange(nextConversations);
      dockedInspectorIdRef.current =
        worldInspectorWindowId(admittedConversation);
      onDockedInspectorIdChange(worldInspectorWindowId(admittedConversation));
      if (admittedConversation.view === "terminal") {
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
      const node = aggregateWorld.leaves.find(
        (leaf) =>
          leaf.connectionId === target.connectionId &&
          leaf.generation === target.runtimeGeneration &&
          leaf.workspaceId === target.workspaceId &&
          leaf.nativeId === target.paneId,
      );
      if (node) void applySelection(node.id, "terminal", false, aggregateWorld);
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
      const element = event.target as HTMLElement | null;
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
      } else if (tabAction === "create")
        action = store.createQualifiedTab(owner, conversation.workspaceId, {
          numberedLabel: true,
        });
      else if (tabAction === "previous" || tabAction === "next") {
        const tabs = operations
          .get()
          .tabs.filter((tab) => tab.workspace_id === conversation.workspaceId);
        const id = adjacentTabId(tabs, conversation.tabId, tabAction);
        if (id) action = operations.focusTab(id);
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
    if (
      view === "office" &&
      officeInspectorPresentation === "floating" &&
      node?.kind !== "host" &&
      node?.actionable
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
        return applySelection(id, null, true, world, signal);
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
    return applySelection(id, null, true, world, signal);
  };
  const workspaceSurfaceSelectionHandlerRef = useRef<
    (selection: WorkspaceSurfaceSelection) => Promise<boolean>
  >(() => Promise.resolve(false));
  workspaceSurfaceSelectionHandlerRef.current = (surfaceSelection) => {
    const node = worldNodeForWorkspaceSurfaceSelection(world, surfaceSelection);
    if (node) return applySelection(node.id);
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
        const refreshedWorld = buildWorldObject(
          worldRuntimeStore.get().connections,
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

  const openTerminalById = async (id: string, signal?: AbortSignal) => {
    if (signal?.aborted) throw new Error("Terminal activation was superseded");
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
        if (!(await applySelection(id, "terminal", true, world, signal))) {
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

  const dockFloatingInspector = async (
    conversation: WorldInspectorConversation,
  ) => {
    const target = aggregateWorld.nodeById.get(conversation.nodeId);
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
    [],
  );
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
      history: "Open Agent History",
      spaces: "Go to Spaces",
    };
    const icons = {
      terminal: <Terminal size={15} />,
      files: <FolderOpen size={15} />,
      changes: <LayoutGrid size={15} />,
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
                        inlineInspectorNodeId={treeInlineInspectorNodeId}
                        onSelect={selectNode}
                        onOpenTerminal={openTerminalById}
                        onInlineInspectorPortalChange={
                          setTreeInlineInspectorPortal
                        }
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
          {contextRailInspector &&
          presentedWorld.nodeById.get(contextRailInspector.nodeId)
            ?.generation === contextRailInspector.runtimeGeneration &&
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
            const source =
              presentedWorld.nodeById.get(conversation.nodeId)?.generation ===
              conversation.runtimeGeneration
                ? visualConversationAnchors?.[conversation.nodeId]
                : null;
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
                    zIndex:
                      50 + inspectorStack.indexOf(dockedInspectorId ?? ""),
                  } as CSSProperties)
                : ({
                    "--world-inspector-dock-size": `${contextRailInspector?.size ?? 520}px`,
                    zIndex:
                      50 + inspectorStack.indexOf(dockedInspectorId ?? ""),
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
            {contextRailInspector &&
            !world.hosts.some(
              (host) => host.connectionId === contextRailInspector.connectionId,
            ) ? (
              <p role="status">
                Outside Hosts filter · {contextRailInspector.hostLabel}
                <button
                  type="button"
                  onClick={() =>
                    hostsFilter.setIds(
                      hostsFilter.ids === null
                        ? null
                        : [
                            ...new Set([
                              ...hostsFilter.ids,
                              contextRailInspector.connectionId,
                            ]),
                          ],
                    )
                  }
                >
                  Reveal in Hosts
                </button>
              </p>
            ) : null}
            {contextRailInspector && view === "office" ? (
              <button
                type="button"
                className="world-context-rail-resize"
                aria-label="Resize Inspector window"
                title="Drag to resize Inspector; use arrow keys for precise sizing"
                onPointerDown={() => {
                  if (dockedInspectorId) raiseInspector(dockedInspectorId);
                }}
                onFocus={() => {
                  if (dockedInspectorId) raiseInspector(dockedInspectorId);
                }}
              />
            ) : null}
          </aside>
        </div>
      )}
      {visualScrollActive &&
      (visualNeedsVerticalScroll || visualNeedsHorizontalScroll) ? (
        <div
          className={`world-arrangement-scroll-control ${visualScrollX ? "is-horizontal" : "is-vertical"}`}
          role="group"
          aria-label={`Scroll ${arrangementScope?.preset ?? "Inspector windows"} windows`}
          style={visualScrollControlPosition}
        >
          <button
            type="button"
            aria-label={
              visualScrollX ? "Scroll windows left" : "Scroll windows up"
            }
            disabled={visualScrollPosition <= 0}
            onClick={() =>
              scrollVisualArrangement(
                Math.max(
                  0,
                  visualScrollPosition -
                    (visualScrollX
                      ? visualScrollViewport.width
                      : visualScrollViewport.height) *
                      0.8,
                ),
              )
            }
          >
            {visualScrollX ? "◀" : "▲"}
          </button>
          <input
            type="range"
            aria-label={
              visualScrollX
                ? "Scroll columns"
                : `Scroll ${arrangementScope?.preset ?? "windows"}`
            }
            min={0}
            max={visualScrollMax}
            value={visualScrollPosition}
            onChange={(event) =>
              scrollVisualArrangement(Number(event.currentTarget.value))
            }
          />
          <button
            type="button"
            aria-label={
              visualScrollX ? "Scroll windows right" : "Scroll windows down"
            }
            disabled={visualScrollPosition >= visualScrollMax}
            onClick={() =>
              scrollVisualArrangement(
                Math.min(
                  visualScrollMax,
                  visualScrollPosition +
                    (visualScrollX
                      ? visualScrollViewport.width
                      : visualScrollViewport.height) *
                      0.8,
                ),
              )
            }
          >
            {visualScrollX ? "▶" : "▼"}
          </button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        {visibleFloatingInspectors.map((conversation, index) => (
          <WorldFloatingTerminalWindow
            key={worldInspectorWindowId(conversation)}
            conversation={conversation}
            outsideFilter={
              !world.hosts.some(
                (host) => host.connectionId === conversation.connectionId,
              )
            }
            cascadeIndex={index}
            compactActive={
              arrangementScope?.preset
                ? worldInspectorWindowId(conversation) === activeInspectorId
                : !dockedInspector && index === floatingInspectors.length - 1
            }
            arrangedGeometry={(() => {
              const id = worldInspectorWindowId(conversation);
              const geometry = visualPlacementMap.get(id);
              return geometry &&
                visualScrollActive &&
                id !== maximizedInspectorId
                ? {
                    ...geometry,
                    left: geometry.left - visualScrollLeft,
                    top: geometry.top - visualGridScrollTop,
                  }
                : (geometry ?? null);
            })()}
            clipBounds={
              visualScrollActive &&
              visualPlacementMap.has(worldInspectorWindowId(conversation)) &&
              worldInspectorWindowId(conversation) !== maximizedInspectorId
                ? visualScrollViewport
                : null
            }
            zIndex={
              50 + inspectorStack.indexOf(worldInspectorWindowId(conversation))
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
              // Compact Single is a viewport presentation of the desktop tiles.
              // Maximize is also temporary; neither presentation may replace
              // the saved geometry used by Restore.
              const id = worldInspectorWindowId(conversation);
              if (
                !shouldRecordVisualInspectorGeometry(
                  id,
                  maximizedInspectorId,
                  compactArrangement,
                )
              )
                return;
              const fitted = fitVisualInspectorArrangementGeometry(
                visualScrollActive
                  ? {
                      ...geometry,
                      left: geometry.left + visualScrollLeft,
                      top: geometry.top + visualGridScrollTop,
                    }
                  : geometry,
                visualScrollActive
                  ? visualContentBounds
                  : visualArrangementStage,
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
              raiseInspector(worldInspectorWindowId(conversation));
              void focusFloatingInspector(
                conversation,
                true,
                undefined,
                undefined,
                undefined,
                false,
              ).catch(() => undefined);
            }}
            onRaise={() => {
              raiseInspector(worldInspectorWindowId(conversation));
              void focusFloatingInspector(conversation, false).catch(
                () => undefined,
              );
            }}
            onStack={(reveal) => {
              const id = worldInspectorWindowId(conversation);
              raiseInspector(id, !reveal);
              if (reveal) revealInspector(id);
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
            terminalActive={visualInspectorTerminalActive(
              worldInspectorWindowId(conversation),
              dockedInspectorId,
              dockedSuppressed,
              arrangedDocked,
              visibleFloatingInspectorIds,
            )}
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
            onWindowMaximize={() => {
              const id = worldInspectorWindowId(conversation);
              setMaximizedInspectorId((current) =>
                current === id ? null : id,
              );
              raiseInspector(id);
            }}
            windowMaximized={
              maximizedInspectorId === worldInspectorWindowId(conversation)
            }
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
              setDockedInspectorGeometry(null);
              dockedInspectorIdRef.current = null;
              onDockedInspectorIdChange(null);
            }}
            onFocus={
              worldInspectorWindowId(conversation) === dockedInspectorId
                ? () => {
                    const target = aggregateWorld.nodeById.get(
                      conversation.nodeId,
                    );
                    if (!target) return;
                    setSelection(target);
                    void applySelection(target.id).catch(() => undefined);
                  }
                : undefined
            }
            onResourceFocus={() => {
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
