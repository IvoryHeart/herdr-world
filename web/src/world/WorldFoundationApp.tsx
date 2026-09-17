import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import App from "../App";
import type { ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import { shallowEqual, store, useStoreSelector } from "../store";
import {
  type InspectorView,
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type WorkspaceInspectorRequest,
} from "../workspaceResource";
import {
  useWorldRuntime,
  type WorldRuntimeState,
  worldRuntimeStore,
} from "./runtimeStore";
import {
  buildWorldObject,
  type WorldHostObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";
import "./world.css";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import { WorldViewErrorBoundary } from "./WorldViewErrorBoundary";

const PixelOfficeView = lazy(() => import("./PixelOfficeView"));
const CheckpointTreeView = lazy(() => import("./CheckpointTreeView"));
const CheckpointGraphView = lazy(() => import("./CheckpointGraphView"));
const WorldIntentProfile = lazy(() => import("./WorldIntentProfile"));

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
  if (node.kind === "agent" && views.includes("history")) return "history";
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
          onInspectorVisibilityChange={setInspectorOpen}
          onInspectorViewChange={
            view === "spaces" ? undefined : writeWorldIntentView
          }
        />
      </div>
      {view !== "spaces" ? (
        <WorldControlPlane
          view={view}
          inspectorOpen={inspectorOpen}
          onInspectorPortal={setInspectorPortal}
          onOpenSpaces={() => setView("spaces")}
        />
      ) : null}
    </div>
  );
}

function WorldControlPlane({
  view,
  inspectorOpen,
  onInspectorPortal,
  onOpenSpaces,
}: {
  view: Exclude<WorldView, "spaces">;
  inspectorOpen: boolean;
  onInspectorPortal(element: HTMLElement | null): void;
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
  const selectNode = (id: string) => {
    const next = world.nodeById.get(id) ?? null;
    const requestId = intentRequestRef.current + 1;
    intentRequestRef.current = requestId;
    setSelection(next);
    setIntentError(null);
    setSelectedOfficeAnchor(null);
    const intentView = next
      ? worldIntentInitialView(next, readWorldIntentView())
      : null;
    if (!next || !next.actionable || !next.selectedHost || !intentView) {
      setIntentOpening(false);
      window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
      return;
    }
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

  const closeIntent = () => {
    intentRequestRef.current += 1;
    setIntentOpening(false);
    setIntentError(null);
    setSelection(null);
    setSelectedOfficeAnchor(null);
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
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
        selectedConnectionId={
          hasSelectedConnection ? connectionSelection.activeConnectionId : null
        }
      />
      {!hasSelectedConnection ? (
        <WorldConnectionRequired status={connectionSelection.status} />
      ) : (
        <div
          className={`world-view-layout ${selected || inspectorOpen ? "has-context" : ""}`}
        >
          <section className="world-view-stage" aria-label={`${view} view`}>
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
          </section>
          {view === "office" &&
          selected?.kind === "agent" &&
          selectedOfficeAnchor?.visible &&
          intentOverlayAnchor ? (
            <WorldIntentConnector
              source={selectedOfficeAnchor}
              target={intentOverlayAnchor}
            />
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

function WorldConnectionRequired({
  status,
}: {
  status: "connecting" | "connected" | "disconnected";
}) {
  return (
    <section
      className="world-connection-required"
      aria-labelledby="world-connection-title"
    >
      <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
      <p className="world-eyebrow">Connection required</p>
      <h2 id="world-connection-title">Choose a Herdr host first</h2>
      <p>
        Office, Tree and Graph keep your selected host stable. Choose or add a
        connection before opening a visual view.
      </p>
      <ConnectionSwitcher />
      {status !== "connected" ? <small>World service: {status}</small> : null}
    </section>
  );
}

function WorldStatusHeader({
  runtime,
  world,
  selectedConnectionId,
}: {
  runtime: WorldRuntimeState;
  world: WorldObject;
  selectedConnectionId: string | null;
}) {
  const ready = world.hosts.filter(
    (host) =>
      host.hostState === "active" || host.hostState === "ready-inactive",
  ).length;
  const stale = world.hosts.filter((host) => host.stale).length;
  const selectedHost = selectedConnectionId
    ? world.hosts.find((host) => host.connectionId === selectedConnectionId)
    : null;
  return (
    <header className="world-status-header">
      <div>
        <p className="world-eyebrow">Visual control plane</p>
        <h1>Your agent world</h1>
      </div>
      <div className="world-status-summary" aria-live="polite">
        <span className="world-live-dot" data-status={runtime.status} />
        <span>{ready} ready</span>
        <span className="world-selected-host">
          {selectedHostStatusLabel(selectedHost ?? null)}
        </span>
        <span>{world.spaces.length} spaces</span>
        <span>
          {world.leaves.filter((leaf) => leaf.kind === "agent").length} agents
        </span>
        {stale ? (
          <span className="world-stale-count">{stale} stale</span>
        ) : null}
        {runtime.error ? (
          <span className="world-runtime-error">{runtime.error}</span>
        ) : null}
      </div>
    </header>
  );
}

function WorldIntentConnector({
  source,
  target,
}: {
  source: OfficeCanvasAnchor;
  target: { x: number; y: number };
}) {
  const distance = Math.max(48, Math.min(180, (target.x - source.x) * 0.45));
  const path = `M ${source.x} ${source.y} C ${source.x + distance} ${source.y}, ${target.x - distance} ${target.y}, ${target.x} ${target.y}`;
  return (
    <svg className="world-intent-connector" aria-hidden="true">
      <path d={path} />
      <circle cx={source.x} cy={source.y} r="3" />
      <circle cx={target.x} cy={target.y} r="3" />
    </svg>
  );
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
