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
  upsertWorldFloatingTerminal,
  type WorldFloatingTerminal,
} from "./worldTerminalPresentation";

export {
  shouldRehomeDockedTerminal,
  upsertWorldFloatingTerminal,
} from "./worldTerminalPresentation";

const PixelOfficeView = lazy(() => import("./PixelOfficeView"));
const ConnectedTreeView = lazy(() => import("./ConnectedTreeView"));
const SpatialGraphView = lazy(() => import("./SpatialGraphView"));
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
  const [floatingTerminals, setFloatingTerminals] = useState<
    WorldFloatingTerminal[]
  >([]);
  const [floatingTerminalPortals, setFloatingTerminalPortals] = useState<
    Record<string, HTMLDivElement | null>
  >({});

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
      setFloatingTerminals([]);
      setFloatingTerminalPortals({});
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
          worldTerminalPresentations={floatingTerminals.map((terminal) => ({
            ...terminal,
            portal: floatingTerminalPortals[terminal.nodeId] ?? null,
          }))}
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
          floatingTerminals={floatingTerminals}
          floatingTerminalPortals={floatingTerminalPortals}
          onInspectorPortal={setInspectorPortal}
          onInspectorViewOpening={setInspectorView}
          onFloatingTerminalsChange={setFloatingTerminals}
          onFloatingTerminalPortal={(nodeId, portal) =>
            setFloatingTerminalPortals((current) => ({
              ...current,
              [nodeId]: portal,
            }))
          }
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
  floatingTerminals,
  floatingTerminalPortals,
  onInspectorPortal,
  onInspectorViewOpening,
  onFloatingTerminalsChange,
  onFloatingTerminalPortal,
  onOpenSpaces,
}: {
  view: Exclude<WorldView, "spaces">;
  inspectorOpen: boolean;
  inspectorView: InspectorView | null;
  floatingTerminals: readonly WorldFloatingTerminal[];
  floatingTerminalPortals: Readonly<Record<string, HTMLDivElement | null>>;
  onInspectorPortal(element: HTMLElement | null): void;
  onInspectorViewOpening(view: InspectorView): void;
  onFloatingTerminalsChange(terminals: WorldFloatingTerminal[]): void;
  onFloatingTerminalPortal(
    nodeId: string,
    element: HTMLDivElement | null,
  ): void;
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
  const [selectedVisualAnchor, setSelectedVisualAnchor] =
    useState<OfficeCanvasAnchor | null>(null);
  const [visualConversationAnchors, setVisualConversationAnchors] =
    useState<Record<string, OfficeCanvasAnchor> | null>(null);
  const [floatingWindowAnchors, setFloatingWindowAnchors] = useState<
    Record<string, OfficeCanvasAnchor | null>
  >({});
  const [intentOverlayAnchor, setIntentOverlayAnchor] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const pendingSelectionRef = useRef<{
    id: string | null;
    waitingForNodeId: string;
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
  const floatingTerminalNodeIds = useMemo(
    () => floatingTerminals.map(({ nodeId }) => nodeId),
    [floatingTerminals],
  );
  const applySelection = (
    id: string | null,
    requestedView: InspectorView | null = null,
  ) => {
    const next = id ? (world.nodeById.get(id) ?? null) : null;
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setSelection(next);
    setIntentError(null);
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
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
        alreadyFloating: floatingTerminals.some(
          (terminal) => terminal.nodeId === selected.id,
        ),
      })
    ) {
      const outgoing = floatingTerminalForNode(selected);
      if (outgoing) {
        const admission = upsertWorldFloatingTerminal(
          floatingTerminals,
          outgoing,
        );
        if (!admission.admitted) {
          setIntentError(
            "Five terminals are already open. Close one before changing selection.",
          );
          return;
        }
        window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
        pendingSelectionRef.current = {
          id,
          waitingForNodeId: outgoing.nodeId,
        };
        onFloatingTerminalsChange([...admission.terminals]);
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
    setSelectedVisualAnchor(null);
    setVisualConversationAnchors(null);
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
  };

  useEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending || !floatingTerminalPortals[pending.waitingForNodeId]) {
      return;
    }
    pendingSelectionRef.current = null;
    const frame = requestAnimationFrame(() => {
      applySelectionRef.current(pending.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [floatingTerminalPortals]);

  useEffect(() => {
    const retained = floatingTerminals.filter((terminal) => {
      const current = world.nodeById.get(terminal.nodeId);
      return Boolean(
        current &&
          current.generation === terminal.runtimeGeneration &&
          floatingTerminalForNode(current)?.terminalId === terminal.terminalId,
      );
    });
    if (retained.length !== floatingTerminals.length) {
      const retainedIds = new Set(retained.map(({ nodeId }) => nodeId));
      for (const terminal of floatingTerminals) {
        if (!retainedIds.has(terminal.nodeId)) {
          onFloatingTerminalPortal(terminal.nodeId, null);
        }
      }
      onFloatingTerminalsChange(retained);
    }
  }, [
    floatingTerminals,
    onFloatingTerminalsChange,
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
      const admission = upsertWorldFloatingTerminal(
        floatingTerminals,
        conversation,
      );
      if (!admission.admitted) {
        throw new Error(
          "Five terminals are already open. Close one before opening another.",
        );
      }
      onFloatingTerminalsChange([...admission.terminals]);
    },
    [floatingTerminals, onFloatingTerminalsChange],
  );

  const openTerminalById = useCallback(
    async (id: string) => {
      const node = world.nodeById.get(id);
      if (!node) throw new Error("This terminal is no longer available");
      try {
        await popOutTerminal(node);
      } catch (cause) {
        setIntentError(cause instanceof Error ? cause.message : String(cause));
        throw cause;
      }
    },
    [popOutTerminal, world],
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

  const dockFloatingTerminal = (terminal: WorldFloatingTerminal) => {
    const target = world.nodeById.get(terminal.nodeId);
    if (!target || !floatingTerminalForNode(target)) {
      onFloatingTerminalsChange(
        floatingTerminals.filter(({ nodeId }) => nodeId !== terminal.nodeId),
      );
      return;
    }
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
    onFloatingTerminalsChange(
      floatingTerminals.filter(({ nodeId }) => nodeId !== terminal.nodeId),
    );
    onFloatingTerminalPortal(terminal.nodeId, null);
    requestAnimationFrame(() => {
      applySelectionRef.current(target.id, "terminal");
    });
  };

  const closeFloatingTerminal = (terminal: WorldFloatingTerminal) => {
    onFloatingTerminalsChange(
      floatingTerminals.filter(({ nodeId }) => nodeId !== terminal.nodeId),
    );
    onFloatingTerminalPortal(terminal.nodeId, null);
  };

  const focusFloatingTerminal = (terminal: WorldFloatingTerminal) => {
    const admission = upsertWorldFloatingTerminal(floatingTerminals, terminal);
    onFloatingTerminalsChange([...admission.terminals]);
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
                      floatingTerminals={floatingTerminals}
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
                      conversationNodeIds={floatingTerminalNodeIds}
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
                    conversationNodeIds={floatingTerminalNodeIds}
                    onSelect={selectNode}
                    onOpenTerminal={openTerminalById}
                    onSelectedAnchorChange={setSelectedVisualAnchor}
                    onNodeAnchorsChange={setVisualConversationAnchors}
                  />
                )}
              </WorldViewErrorBoundary>
            </Suspense>
          </section>
          {selected?.kind === "agent" &&
          selectedVisualAnchor?.visible &&
          intentOverlayAnchor ? (
            <Suspense fallback={null}>
              <WorldIntentConnector
                source={selectedVisualAnchor}
                target={intentOverlayAnchor}
              />
            </Suspense>
          ) : null}
          {floatingTerminals.map((terminal) => {
            const source = visualConversationAnchors?.[terminal.nodeId];
            const target = floatingWindowAnchors[terminal.nodeId] ?? null;
            return source && target ? (
              <Suspense key={terminal.nodeId} fallback={null}>
                <WorldIntentConnector source={source} target={target} />
              </Suspense>
            ) : null;
          })}
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
      <Suspense fallback={null}>
        {floatingTerminals.map((terminal, index) => (
          <WorldFloatingTerminalWindow
            key={terminal.nodeId}
            conversation={terminal}
            cascadeIndex={index}
            compactActive={index === floatingTerminals.length - 1}
            onFocus={() => focusFloatingTerminal(terminal)}
            onClose={() => closeFloatingTerminal(terminal)}
            onDock={() => dockFloatingTerminal(terminal)}
            onAnchorChange={(anchor) =>
              setFloatingWindowAnchors((current) => ({
                ...current,
                [terminal.nodeId]: anchor,
              }))
            }
            onPortalChange={(portal) =>
              onFloatingTerminalPortal(terminal.nodeId, portal)
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
