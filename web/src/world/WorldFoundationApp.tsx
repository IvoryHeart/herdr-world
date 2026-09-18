import {
  lazy,
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
import App, { type WorkspaceSurfaceSelection } from "../App";
import type { ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
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
} from "./worldObject";
import "./world.css";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import WorldIntentProfile from "./WorldIntentProfile";
import WorldInspectorConversationView from "./WorldInspectorConversation";
import { WorldConnectionRequired, WorldTopbarStatus } from "./WorldStatus";
import {
  reconcileWorldInspectorConversation,
  retainWorldInspectorConversations,
  worldInspectorForNode,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

export {
  retainWorldFloatingTerminals,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";

const PixelOfficeView = lazy(() => import("./PixelOfficeView"));
const ConnectedTreeView = lazy(() => import("./ConnectedTreeView"));
const SpatialGraphView = lazy(() => import("./SpatialGraphView"));
const WorldIntentConnector = lazy(() => import("./WorldIntentConnector"));
const WorldViewErrorBoundary = lazy(() =>
  import("./WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);
const WorldFloatingTerminalWindow = lazy(
  () => import("./WorldFloatingTerminal"),
);
const OfficeObservabilityDialog = lazy(() =>
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

export function moveDockedInspectorGeometry(
  geometry: DockedInspectorGeometry,
  deltaX: number,
  deltaY: number,
  bounds: { width: number; height: number },
): DockedInspectorGeometry {
  return {
    ...geometry,
    left: Math.max(
      0,
      Math.min(
        geometry.left + deltaX,
        Math.max(0, bounds.width - geometry.width),
      ),
    ),
    top: Math.max(
      0,
      Math.min(
        geometry.top + deltaY,
        Math.max(0, bounds.height - geometry.height),
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
  const [visualView, setVisualView] = useState<Exclude<WorldView, "spaces">>(
    () => {
      const initial = initialView();
      return initial === "spaces" ? "office" : initial;
    },
  );
  const [topbarPortal, setTopbarPortal] = useState<HTMLElement | null>(null);
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
    () => buildWorldObject(topbarRuntime.connections, topbarConnectionId),
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
      (conversation) => conversation.nodeId === dockedInspectorId,
    ) ?? inspectorConversations[inspectorConversations.length - 1];
  const changeWorkspaceSurfaceInspectorView = useCallback(
    (nextView: InspectorView) => {
      const conversation = workspaceSurfaceInspectorConversation;
      if (!conversation?.availableViews.includes(nextView)) return;
      setInspectorConversations((current) =>
        current.map((candidate) =>
          candidate.nodeId === conversation.nodeId
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
    const retainedIds = new Set(retained.map(({ nodeId }) => nodeId));
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
                <WorldTopbarStatus
                  runtime={topbarRuntime}
                  world={topbarWorld}
                  selectedHostLabel={selectedHostStatusLabel(
                    topbarWorld.hosts.find(
                      ({ connectionId }) => connectionId === topbarConnectionId,
                    ) ?? null,
                  )}
                />
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
              onInspectorTerminalPortal={(nodeId, portal) =>
                setInspectorTerminalPortals((current) =>
                  current[nodeId] === portal
                    ? current
                    : { ...current, [nodeId]: portal },
                )
              }
              onWorkspaceSurfaceSelectionReady={
                registerWorkspaceSurfaceSelection
              }
            />
          }
          workspaceSurfaceVisible={view !== "spaces"}
          workspaceSurfaceInspector={
            workspaceSurfaceInspectorConversation
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
          worldTerminalPresentations={inspectorConversations.flatMap(
            (conversation) =>
              conversation.paneId && conversation.terminalId
                ? [
                    {
                      ...conversation,
                      paneId: conversation.paneId,
                      terminalId: conversation.terminalId,
                      portal:
                        inspectorTerminalPortals[conversation.nodeId] ?? null,
                    },
                  ]
                : [],
          )}
        />
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
}: {
  view: Exclude<WorldView, "spaces">;
  active: boolean;
  inspectorConversations: readonly WorldInspectorConversation[];
  dockedInspectorId: string | null;
  onDockedInspectorIdChange(nodeId: string | null): void;
  onInspectorConversationsChange(
    conversations: WorldInspectorConversation[],
  ): void;
  onInspectorTerminalPortal(
    nodeId: string,
    element: HTMLDivElement | null,
  ): void;
  onWorkspaceSurfaceSelectionReady(
    handler:
      | ((selection: WorkspaceSurfaceSelection) => Promise<boolean>)
      | null,
  ): void;
}) {
  const runtime = useWorldRuntime();
  const connectionSelection = useStoreSelector(
    (snapshot) => ({
      activeConnectionId: snapshot.activeConnectionId,
      connections: snapshot.connections,
      defaultConnectionId: snapshot.defaultConnectionId,
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
  const world = useMemo(
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
  const [selection, setSelection] = useState<WorldObjectNode | null>(null);
  const [pendingSurfacePriority, setPendingSurfacePriority] =
    useState<WorldRuntimePriority | null>(null);
  const intentRequestRef = useRef(0);
  const worldViewLayoutRef = useRef<HTMLDivElement | null>(null);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const dockedInspectorMoveRef = useRef<DockedInspectorMove | null>(null);
  const [dockedInspectorGeometry, setDockedInspectorGeometry] =
    useState<DockedInspectorGeometry | null>(null);
  const dockedInspectorGeometryRef = useRef<DockedInspectorGeometry | null>(
    null,
  );
  const [dockedInspectorMoving, setDockedInspectorMoving] = useState(false);
  const [dockedInspectorPortal, setDockedInspectorPortal] =
    useState<HTMLElement | null>(null);
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
  const [intentOverlayAnchor, setIntentOverlayAnchor] =
    useState<WorldConnectorTargetBounds | null>(null);
  const inspectorConversationsRef = useRef(inspectorConversations);
  const dockedInspectorIdRef = useRef(dockedInspectorId);
  inspectorConversationsRef.current = inspectorConversations;
  dockedInspectorIdRef.current = dockedInspectorId;
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
    ({ nodeId }) => nodeId === dockedInspectorId,
  );
  const dockedInspectorNodeId = dockedInspector?.nodeId ?? null;
  const dockedInspectorExpanded = dockedInspector?.expanded ?? false;
  const floatingInspectors = useMemo(
    () =>
      inspectorConversations.filter(
        ({ nodeId }) => nodeId !== dockedInspectorId,
      ),
    [dockedInspectorId, inspectorConversations],
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
    worldRuntimeStore.setPriorities(snapshotPriorities);
  }, [snapshotPriorities]);

  useEffect(() => {
    setDockedInspectorGeometry(null);
    setDockedInspectorMoving(false);
    dockedInspectorMoveRef.current = null;
  }, [dockedInspectorId]);

  useEffect(() => {
    const rail = contextRailRef.current;
    const layout = worldViewLayoutRef.current;
    if (!rail || !layout || !dockedInspectorNodeId || dockedInspectorExpanded) {
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
      const layoutBounds = layout.getBoundingClientRect();
      const railBounds = rail.getBoundingClientRect();
      const geometry = {
        left: railBounds.left - layoutBounds.left,
        top: railBounds.top - layoutBounds.top,
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
      const layoutBounds = layout.getBoundingClientRect();
      setDockedInspectorGeometry(
        moveDockedInspectorGeometry(
          current.geometry,
          event.clientX - current.startX,
          event.clientY - current.startY,
          { width: layoutBounds.width, height: layoutBounds.height },
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
      const layoutBounds = layout.getBoundingClientRect();
      const railBounds = rail.getBoundingClientRect();
      const geometry = dockedInspectorGeometryRef.current ?? {
        left: railBounds.left - layoutBounds.left,
        top: railBounds.top - layoutBounds.top,
        width: railBounds.width,
        height: railBounds.height,
      };
      setDockedInspectorGeometry(
        moveDockedInspectorGeometry(geometry, delta.x, delta.y, {
          width: layoutBounds.width,
          height: layoutBounds.height,
        }),
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
    if (!next || !next.actionable || !next.selectedHost) {
      setSelection(next);
      if (dockedInspector) {
        onInspectorConversationsChange(
          inspectorConversations.filter(
            ({ nodeId }) => nodeId !== dockedInspector.nodeId,
          ),
        );
        onInspectorTerminalPortal(dockedInspector.nodeId, null);
        onDockedInspectorIdChange(null);
      }
      setIntentOpening(false);
      return true;
    }
    const existing = inspectorConversations.find(
      ({ nodeId }) => nodeId === next.id,
    );
    if (existing) {
      setIntentOpening(true);
      try {
        if (focusTarget) await focusWorldNode(next);
        if (intentRequestRef.current !== requestId) return false;
        setSelection(next);
        const admitted =
          requestedView && existing.availableViews.includes(requestedView)
            ? { ...existing, view: requestedView }
            : existing;
        if (admitted !== existing) {
          onInspectorConversationsChange(
            inspectorConversations.map((conversation) =>
              conversation.nodeId === existing.nodeId ? admitted : conversation,
            ),
          );
        }
        if (existing.nodeId !== dockedInspectorId) {
          focusFloatingInspector(admitted, false);
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
      setSelection(next);
      if (dockedInspector) {
        onInspectorTerminalPortal(dockedInspector.nodeId, null);
      }
      onInspectorConversationsChange([
        ...inspectorConversations.filter(
          ({ nodeId }) => nodeId !== dockedInspector?.nodeId,
        ),
        conversation,
      ]);
      onDockedInspectorIdChange(conversation.nodeId);
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
  const selectNode = (id: string) => applySelection(id);
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
    if (!hasSelectedConnection) return;
    let changed = false;
    const retained = inspectorConversations.flatMap((conversation) => {
      const current = world.nodeById.get(conversation.nodeId);
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
      const retainedIds = new Set(retained.map(({ nodeId }) => nodeId));
      const selectedInspectorRetired = Boolean(
        selection &&
          inspectorConversations.some(
            ({ nodeId }) => nodeId === selection.id,
          ) &&
          !retainedIds.has(selection.id),
      );
      for (const conversation of inspectorConversations) {
        if (!retainedIds.has(conversation.nodeId)) {
          onInspectorTerminalPortal(conversation.nodeId, null);
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
      ({ nodeId }) => nodeId === node.id,
    );
    if (existing) {
      if (existing.nodeId === dockedInspectorId) {
        if (floatingInspectors.length >= 5) {
          throw new Error(
            "Five Inspectors are already floating. Close one before floating another.",
          );
        }
        if (!(await focusFloatingInspector(existing))) {
          throw new Error("Inspector activation was superseded");
        }
        if (dockedInspectorIdRef.current === existing.nodeId) {
          onDockedInspectorIdChange(null);
        }
        return;
      }
      if (!(await focusFloatingInspector(existing))) {
        throw new Error("Inspector activation was superseded");
      }
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
    } finally {
      if (intentRequestRef.current === requestId) setIntentOpening(false);
    }
  };

  const openTerminalById = async (id: string) => {
    const node = world.nodeById.get(id);
    if (!node) throw new Error("This terminal is no longer available");
    try {
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
      setSelection(target);
      onDockedInspectorIdChange(conversation.nodeId);
      requestAnimationFrame(() => {
        contextRailRef.current
          ?.querySelector<HTMLElement>(".xterm-helper-textarea")
          ?.focus({ preventScroll: true });
      });
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
    onInspectorConversationsChange(
      inspectorConversations.filter(
        ({ nodeId }) => nodeId !== conversation.nodeId,
      ),
    );
    onInspectorTerminalPortal(conversation.nodeId, null);
    setFloatingInspectorPortals((current) => ({
      ...current,
      [conversation.nodeId]: null,
    }));
    if (dockedInspectorId === conversation.nodeId) {
      onDockedInspectorIdChange(null);
    }
    if (selected?.id === conversation.nodeId) setSelection(null);
  };

  const focusFloatingInspector = async (
    conversation: WorldInspectorConversation,
    focusTarget = true,
  ): Promise<boolean> => {
    const target = world.nodeById.get(conversation.nodeId);
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
      const currentConversation =
        current.find(({ nodeId }) => nodeId === conversation.nodeId) ??
        conversation;
      const currentFloating = current.filter(
        ({ nodeId }) => nodeId !== dockedInspectorIdRef.current,
      );
      if (
        currentFloating[currentFloating.length - 1]?.nodeId !==
        conversation.nodeId
      ) {
        onInspectorConversationsChange([
          ...current.filter(({ nodeId }) => nodeId !== conversation.nodeId),
          currentConversation,
        ]);
      }
      setSelection(target);
      requestAnimationFrame(() => {
        floatingInspectorPortals[conversation.nodeId]
          ?.querySelector<HTMLElement>(".xterm-helper-textarea")
          ?.focus({ preventScroll: true });
      });
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
      onInspectorTerminalPortal(conversation.nodeId, null);
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
    if (view !== "office" || !dockedInspector || !rail) {
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
  }, [dockedInspector, view]);

  const showSelectionProfile = Boolean(
    selected &&
      (selected.kind === "host" ||
        !currentSelectionGeneration ||
        !selected.actionable),
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
          className={`world-view-layout ${showSelectionProfile || dockedInspector ? "has-context" : ""}`}
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
                        world={world}
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
                        world={world}
                        selectedId={selectedId}
                        conversationNodeIds={conversationNodeIds}
                        onSelect={selectNode}
                        onOpenTerminal={openTerminalById}
                        onSelectedAnchorChange={setSelectedVisualAnchor}
                        onNodeAnchorsChange={setVisualConversationAnchors}
                      />
                    </Suspense>
                  ) : (
                    <SpatialGraphView
                      world={world}
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
          {dockedInspector &&
          visualConversationAnchors?.[dockedInspector.nodeId] &&
          intentOverlayAnchor ? (
            <Suspense fallback={null}>
              <WorldIntentConnector
                source={visualConversationAnchors[dockedInspector.nodeId]!}
                target={intentOverlayAnchor}
              />
            </Suspense>
          ) : null}
          {floatingInspectors.map((conversation) => {
            const source = visualConversationAnchors?.[conversation.nodeId];
            const target = floatingWindowAnchors[conversation.nodeId] ?? null;
            return source && target ? (
              <Suspense key={conversation.nodeId} fallback={null}>
                <WorldIntentConnector source={source} target={target} />
              </Suspense>
            ) : null;
          })}
          <aside
            ref={contextRailRef}
            className={`world-context-rail ${dockedInspector ? "has-inspector" : ""}`}
            aria-label="World context"
            data-interaction={dockedInspectorMoving ? "moving" : undefined}
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
                  } satisfies CSSProperties)
                : undefined
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
              ref={setDockedInspectorPortal}
            />
          </aside>
        </div>
      )}
      <Suspense fallback={null}>
        {floatingInspectors.map((conversation, index) => (
          <WorldFloatingTerminalWindow
            key={conversation.nodeId}
            conversation={conversation}
            cascadeIndex={index}
            compactActive={index === floatingInspectors.length - 1}
            onFocus={() => {
              void focusFloatingInspector(conversation).catch(() => undefined);
            }}
            onRaise={() => {
              void focusFloatingInspector(conversation, false);
            }}
            onAnchorChange={(anchor) =>
              setFloatingWindowAnchors((current) => ({
                ...current,
                [conversation.nodeId]: anchor,
              }))
            }
            onPortalChange={(portal) =>
              setFloatingInspectorPortals((current) => ({
                ...current,
                [conversation.nodeId]: portal,
              }))
            }
          />
        ))}
        {inspectorConversations.map((conversation) => (
          <WorldInspectorConversationView
            key={`${conversation.nodeId}:${conversation.resourceIdentity}`}
            conversation={conversation}
            target={
              conversation.nodeId === dockedInspectorId
                ? dockedInspectorPortal
                : (floatingInspectorPortals[conversation.nodeId] ?? null)
            }
            floating={conversation.nodeId !== dockedInspectorId}
            onChange={(change) => {
              if (change.dock !== undefined || change.expanded !== undefined) {
                setDockedInspectorGeometry(null);
              }
              onInspectorConversationsChange(
                inspectorConversations.map((candidate) =>
                  candidate.nodeId === conversation.nodeId
                    ? { ...candidate, ...change }
                    : candidate,
                ),
              );
            }}
            onClose={() => closeInspector(conversation)}
            onDockIn={() => {
              void dockFloatingInspector(conversation);
            }}
            onDockOut={() => {
              if (floatingInspectors.length >= 5) {
                setIntentError(
                  "Five Inspectors are already floating. Close one before floating another.",
                );
                return;
              }
              setDockedInspectorGeometry(null);
              onDockedInspectorIdChange(null);
            }}
            onFocus={
              conversation.nodeId === dockedInspectorId
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
              onInspectorTerminalPortal(conversation.nodeId, portal)
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
