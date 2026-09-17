import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import App from "../App";
import type { ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { shallowEqual, store, useStoreSelector } from "../store";
import {
  type InspectorView,
  WORLD_TERMINAL_POP_OUT_EVENT,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type WorkspaceInspectorRequest,
} from "../workspaceResource";
import { useWorldRuntime, worldRuntimeStore } from "./runtimeStore";
import {
  buildWorldObject,
  type WorldHostObject,
  type WorldObjectNode,
} from "./worldObject";
import "./world.css";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import {
  floatingTerminalForNode,
  shouldRehomeDockedTerminal,
  type WorldFloatingTerminal,
} from "./worldTerminalPresentation";

export { shouldRehomeDockedTerminal } from "./worldTerminalPresentation";

const PixelOfficeView = lazy(() => import("./PixelOfficeView"));
const CheckpointTreeView = lazy(() => import("./CheckpointTreeView"));
const CheckpointGraphView = lazy(() => import("./CheckpointGraphView"));
const WorldIntentProfile = lazy(() => import("./WorldIntentProfile"));
const WorldIntentConnector = lazy(() => import("./WorldIntentConnector"));
const WorldStatusHeader = lazy(() =>
  import("./WorldStatus").then((module) => ({
    default: module.WorldStatusHeader,
  })),
);
const WorldConnectionRequired = lazy(() =>
  import("./WorldStatus").then((module) => ({
    default: module.WorldConnectionRequired,
  })),
);
const WorldViewErrorBoundary = lazy(() =>
  import("./WorldViewErrorBoundary").then((module) => ({
    default: module.WorldViewErrorBoundary,
  })),
);
const WorldFloatingTerminalWindow = lazy(
  () => import("./WorldFloatingTerminal"),
);

export type WorldView = "spaces" | "office" | "tree" | "graph";

const SELECTED_CONNECTION_KEY = "worldSelectedConnection";
const WORLD_INTENT_VIEW_KEY = "worldIntentView";
const WORLD_VIEWS: readonly WorldView[] = ["office", "spaces", "tree", "graph"];
const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  spaces: "/spaces",
  office: "/office",
  tree: "/tree",
  graph: "/graph",
};

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

export function worldIntentViews(node: WorldObjectNode): InspectorView[] {
  if (node.kind === "host") return [];
  return [
    ...(node.capabilities.files ? (["files"] as const) : []),
    ...(node.capabilities.changes ? (["changes"] as const) : []),
    ...(node.kind === "agent" && node.capabilities.agentHistory
      ? (["history"] as const)
      : []),
    ...(node.capabilities.openTerminal ? (["terminal"] as const) : []),
  ];
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

function readWorldIntentView(): InspectorView | null {
  try {
    const value = worldLocalStorage.getItem(WORLD_INTENT_VIEW_KEY);
    return value === "files" ||
      value === "changes" ||
      value === "history" ||
      value === "terminal"
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeWorldIntentView(view: InspectorView) {
  try {
    worldLocalStorage.setItem(WORLD_INTENT_VIEW_KEY, view);
  } catch {
    // The current overlay still works when browser persistence is unavailable.
  }
}

function initialView() {
  return worldViewFromPath(window.location.pathname);
}

export default function WorldFoundationApp() {
  const [view, setViewState] = useState<WorldView>(initialView);
  const [topbarPortal, setTopbarPortal] = useState<HTMLElement | null>(null);
  const [inspectorPortal, setInspectorPortal] = useState<HTMLElement | null>(
    null,
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorView, setInspectorView] = useState<InspectorView | null>(
    null,
  );
  const [floatingTerminal, setFloatingTerminal] =
    useState<WorldFloatingTerminal | null>(null);
  const [floatingTerminalPortal, setFloatingTerminalPortal] =
    useState<HTMLDivElement | null>(null);

  useEffect(() => {
    worldRuntimeStore.start();
    return () => worldRuntimeStore.stop();
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
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);

  const setView = (next: WorldView) => {
    if (next === "spaces") {
      window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
      setFloatingTerminal(null);
      setFloatingTerminalPortal(null);
    }
    setViewState(next);
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
      <div
        className={`world-spaces-layer ${view === "spaces" ? "is-active" : ""}`}
        aria-hidden={view !== "spaces"}
      >
        <App
          operationalShortcutsEnabled={view === "spaces"}
          inspectorPortal={view === "spaces" ? null : inspectorPortal}
          topbarPortal={topbarPortal}
          primaryViewControl={
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
          }
          worldTerminalPresentation={
            floatingTerminal
              ? { ...floatingTerminal, portal: floatingTerminalPortal }
              : null
          }
          onInspectorVisibilityChange={setInspectorOpen}
          onTerminalPopOut={
            view === "spaces"
              ? undefined
              : () =>
                  window.dispatchEvent(new Event(WORLD_TERMINAL_POP_OUT_EVENT))
          }
          onInspectorViewChange={
            view === "spaces"
              ? undefined
              : (next) => {
                  setInspectorView(next);
                  writeWorldIntentView(next);
                }
          }
        />
      </div>
      {view !== "spaces" ? (
        <WorldControlPlane
          view={view}
          inspectorOpen={inspectorOpen}
          inspectorView={inspectorView}
          floatingTerminal={floatingTerminal}
          floatingTerminalPortal={floatingTerminalPortal}
          onInspectorPortal={setInspectorPortal}
          onInspectorViewOpening={setInspectorView}
          onFloatingTerminalChange={setFloatingTerminal}
          onFloatingTerminalPortal={setFloatingTerminalPortal}
          onOpenSpaces={() => setView("spaces")}
        />
      ) : null}
    </div>
  );
}

function WorldControlPlane({
  view,
  inspectorOpen,
  inspectorView,
  floatingTerminal,
  floatingTerminalPortal,
  onInspectorPortal,
  onInspectorViewOpening,
  onFloatingTerminalChange,
  onFloatingTerminalPortal,
  onOpenSpaces,
}: {
  view: Exclude<WorldView, "spaces">;
  inspectorOpen: boolean;
  inspectorView: InspectorView | null;
  floatingTerminal: WorldFloatingTerminal | null;
  floatingTerminalPortal: HTMLDivElement | null;
  onInspectorPortal(element: HTMLElement | null): void;
  onInspectorViewOpening(view: InspectorView): void;
  onFloatingTerminalChange(terminal: WorldFloatingTerminal | null): void;
  onFloatingTerminalPortal(element: HTMLDivElement | null): void;
  onOpenSpaces: () => void;
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
  const intentRequestRef = useRef(0);
  const contextRailRef = useRef<HTMLElement | null>(null);
  const [intentOpening, setIntentOpening] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [selectedOfficeAnchor, setSelectedOfficeAnchor] =
    useState<OfficeCanvasAnchor | null>(null);
  const [intentOverlayAnchor, setIntentOverlayAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const pendingSelectionRef = useRef<{
    id: string | null;
  } | null>(null);
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
  const applySelection = (
    id: string | null,
    requestedView: InspectorView | null = null,
  ) => {
    const next = id ? (world.nodeById.get(id) ?? null) : null;
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setSelection(next);
    setIntentError(null);
    setSelectedOfficeAnchor(null);
    const intentView = next
      ? worldIntentInitialView(next, requestedView ?? readWorldIntentView())
      : null;
    if (!next || !next.actionable || !next.selectedHost || !intentView) {
      setIntentOpening(false);
      window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
      return;
    }
    onInspectorViewOpening(intentView);
    setIntentOpening(true);
    const guardedTarget: WorldEventTarget = {
      dispatchEvent(event) {
        if (intentRequestRef.current !== requestId) return false;
        return window.dispatchEvent(event);
      },
    };
    void dispatchWorldInspectorRequest(next, intentView, store, guardedTarget)
      .catch((cause) => {
        if (intentRequestRef.current !== requestId) return;
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (intentRequestRef.current === requestId) setIntentOpening(false);
      });
  };
  const applySelectionRef = useRef(applySelection);
  applySelectionRef.current = applySelection;

  const selectNode = (id: string) => {
    if (
      selected &&
      shouldRehomeDockedTerminal({
        currentNodeId: selected.id,
        nextNodeId: id,
        inspectorOpen,
        inspectorView,
        alreadyFloating: floatingTerminal?.nodeId === selected.id,
      })
    ) {
      const outgoing = floatingTerminalForNode(selected);
      if (outgoing) {
        window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
        pendingSelectionRef.current = { id };
        onFloatingTerminalChange(outgoing);
        return;
      }
    }
    applySelection(id);
  };

  const closeIntent = () => {
    intentRequestRef.current += 1;
    setIntentOpening(false);
    setIntentError(null);
    setSelection(null);
    setSelectedOfficeAnchor(null);
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
  };

  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || !floatingTerminalPortal) return;
    pendingSelectionRef.current = null;
    const frame = requestAnimationFrame(() => {
      applySelectionRef.current(pending.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [floatingTerminal?.nodeId, floatingTerminalPortal]);

  useEffect(() => {
    if (!floatingTerminal) return;
    const current = world.nodeById.get(floatingTerminal.nodeId);
    if (
      !current ||
      current.generation !== floatingTerminal.runtimeGeneration ||
      floatingTerminalForNode(current)?.terminalId !==
        floatingTerminal.terminalId
    ) {
      onFloatingTerminalChange(null);
      onFloatingTerminalPortal(null);
    }
  }, [
    floatingTerminal,
    onFloatingTerminalChange,
    onFloatingTerminalPortal,
    world,
  ]);

  const popOutTerminal = useCallback(
    async (node: WorldObjectNode) => {
      const conversation = floatingTerminalForNode(node);
      if (!conversation) {
        throw new Error("This terminal is no longer available");
      }
      await focusWorldNode(node);
      onFloatingTerminalChange(conversation);
    },
    [onFloatingTerminalChange],
  );

  useEffect(() => {
    const handlePopOut = () => {
      if (!selected) return;
      void popOutTerminal(selected).catch((cause) => {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
      });
    };
    window.addEventListener(WORLD_TERMINAL_POP_OUT_EVENT, handlePopOut);
    return () =>
      window.removeEventListener(WORLD_TERMINAL_POP_OUT_EVENT, handlePopOut);
  }, [popOutTerminal, selected]);

  const dockFloatingTerminal = () => {
    if (!floatingTerminal) return;
    const target = world.nodeById.get(floatingTerminal.nodeId);
    if (!target || !floatingTerminalForNode(target)) {
      onFloatingTerminalChange(null);
      return;
    }
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
    onFloatingTerminalChange(null);
    onFloatingTerminalPortal(null);
    requestAnimationFrame(() => {
      applySelectionRef.current(target.id, "terminal");
    });
  };

  const closeFloatingTerminal = () => {
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
    onFloatingTerminalChange(null);
    onFloatingTerminalPortal(null);
  };

  useEffect(() => {
    if (
      selected &&
      (!currentSelectionGeneration || shouldCloseWorldInspector(selected))
    ) {
      intentRequestRef.current += 1;
      setIntentOpening(false);
      window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
    }
  }, [currentSelectionGeneration, selected]);

  useEffect(() => {
    const rail = contextRailRef.current;
    if (view !== "office" || selected?.kind !== "agent" || !rail) {
      setIntentOverlayAnchor(null);
      return;
    }
    const update = () => {
      const bounds = rail.getBoundingClientRect();
      setIntentOverlayAnchor({
        x: bounds.left,
        y: Math.min(bounds.bottom - 28, bounds.top + 62),
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
  }, [inspectorOpen, selected, view]);

  return (
    <main className="world-control-plane" id="world">
      <WorldStatusHeader
        runtime={runtime}
        world={world}
        selectedHostLabel={selectedHostStatusLabel(
          hasSelectedConnection
            ? (world.hosts.find(
                (host) =>
                  host.connectionId === connectionSelection.activeConnectionId,
              ) ?? null)
            : null,
        )}
      />
      {!hasSelectedConnection ? (
        <WorldConnectionRequired status={connectionSelection.status} />
      ) : (
        <div
          className={`world-view-layout ${selected || inspectorOpen ? "has-context" : ""}`}
        >
          <section className="world-view-stage" aria-label={`${view} view`}>
            <Suspense
              fallback={<div className="world-view-loading">Loading view…</div>}
            >
              <WorldViewErrorBoundary key={`${view}:${world.nodes.length}`}>
                {view === "office" ? (
                  <Suspense
                    fallback={
                      <div className="world-view-loading">Loading Office…</div>
                    }
                  >
                    <PixelOfficeView
                      world={world}
                      selectedId={selectedId}
                      onSelect={selectNode}
                      onOpenTerminal={(id) => {
                        const node = world.nodeById.get(id);
                        if (!node) return;
                        void popOutTerminal(node).catch((cause) => {
                          setIntentError(
                            cause instanceof Error
                              ? cause.message
                              : String(cause),
                          );
                        });
                      }}
                      onSelectedAnchorChange={setSelectedOfficeAnchor}
                    />
                  </Suspense>
                ) : view === "tree" ? (
                  <Suspense
                    fallback={
                      <div className="world-view-loading">Loading Tree…</div>
                    }
                  >
                    <CheckpointTreeView
                      world={world}
                      selectedId={selectedId}
                      onSelect={selectNode}
                    />
                  </Suspense>
                ) : (
                  <Suspense
                    fallback={
                      <div className="world-view-loading">Loading Graph…</div>
                    }
                  >
                    <CheckpointGraphView
                      world={world}
                      selectedId={selectedId}
                      onSelect={selectNode}
                    />
                  </Suspense>
                )}
              </WorldViewErrorBoundary>
            </Suspense>
          </section>
          {view === "office" &&
          selected?.kind === "agent" &&
          selectedOfficeAnchor?.visible &&
          intentOverlayAnchor ? (
            <Suspense fallback={null}>
              <WorldIntentConnector
                source={selectedOfficeAnchor}
                target={intentOverlayAnchor}
              />
            </Suspense>
          ) : null}
          <aside
            ref={contextRailRef}
            className={`world-context-rail ${inspectorOpen ? "has-inspector" : ""}`}
            aria-label="World context"
          >
            {selected ? (
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
                  inspectorOpen={inspectorOpen}
                  intentOpening={intentOpening}
                  resourceError={intentError}
                  onActivateHost={() => activateWorldNodeHost(selected)}
                  onClose={closeIntent}
                  onOpenSpaces={async () => {
                    await focusWorldNode(selected);
                    onOpenSpaces();
                  }}
                />
              </Suspense>
            ) : null}
            <div className="world-inspector-portal" ref={onInspectorPortal} />
          </aside>
        </div>
      )}
      {floatingTerminal ? (
        <Suspense fallback={null}>
          <WorldFloatingTerminalWindow
            conversation={floatingTerminal}
            onClose={closeFloatingTerminal}
            onDock={dockFloatingTerminal}
            onPortalChange={onFloatingTerminalPortal}
          />
        </Suspense>
      ) : null}
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
  focusWorkspace(
    workspaceId: string,
    options?: { retryOnReconnect?: boolean },
  ): Promise<unknown>;
  focusTaskNotificationTarget(target: {
    connectionId: string;
    runtimeGeneration: number;
    workspaceId: string;
    paneId: string;
  }): Promise<unknown>;
};

type WorldEventTarget = Pick<EventTarget, "dispatchEvent">;

export async function dispatchWorldInspectorRequest(
  node: WorldObjectNode,
  view: InspectorView,
  focusStore: WorldFocusStore = store,
  eventTarget: WorldEventTarget = window,
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
  if (target.paneId) {
    await focusStore.focusTaskNotificationTarget({
      connectionId: node.connectionId,
      runtimeGeneration: node.generation,
      workspaceId: target.workspaceId,
      paneId: target.paneId,
    });
    if (!worldNodeLeaseIsActive(node, focusStore)) {
      throw new Error("The selected host changed while it was opening");
    }
  } else {
    if (!worldNodeLeaseIsActive(node, focusStore)) {
      throw new Error("The selected host changed while it was opening");
    }
    await focusStore.focusWorkspace(target.workspaceId, {
      retryOnReconnect: false,
    });
    if (!worldNodeLeaseIsActive(node, focusStore)) {
      throw new Error("The selected host changed while it was opening");
    }
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
