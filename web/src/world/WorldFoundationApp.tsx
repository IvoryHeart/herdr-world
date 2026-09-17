import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import App from "../App";
import type { ConnectionSummary } from "../api";
import { worldLocalStorage } from "../browserStorage";
import { ConnectionSwitcher } from "../components/ConnectionSwitcher";
import { shallowEqual, store, useStoreSelector } from "../store";
import {
  WORKSPACE_INSPECTOR_CLOSE_EVENT,
  WORKSPACE_INSPECTOR_REQUEST_EVENT,
  type InspectorView,
  type WorkspaceInspectorRequest,
} from "../workspaceResource";
import {
  useWorldRuntime,
  worldRuntimeStore,
  type WorldRuntimeState,
} from "./runtimeStore";
import {
  buildWorldObject,
  type WorldHostObject,
  type WorldObject,
  type WorldObjectNode,
} from "./worldObject";
import "./world.css";
import { WorldViewErrorBoundary } from "./WorldViewErrorBoundary";

const PixelOfficeView = lazy(() => import("./PixelOfficeView"));
const CheckpointTreeView = lazy(() => import("./CheckpointTreeView"));
const CheckpointGraphView = lazy(() => import("./CheckpointGraphView"));

export type WorldView = "spaces" | "office" | "tree" | "graph";

const VIEW_KEY = "worldView";
const SELECTED_CONNECTION_KEY = "worldSelectedConnection";
const WORLD_VIEWS: readonly WorldView[] = ["spaces", "office", "tree", "graph"];
const WORLD_VIEW_PATHS: Record<WorldView, string> = {
  spaces: "/spaces",
  office: "/office",
  tree: "/tree",
  graph: "/graph",
};

export function parseWorldView(value: unknown): WorldView {
  return WORLD_VIEWS.includes(value as WorldView)
    ? (value as WorldView)
    : "spaces";
}

export function worldViewFromPath(pathname: string): WorldView {
  const match = Object.entries(WORLD_VIEW_PATHS).find(
    ([, path]) => path === pathname,
  );
  return (match?.[0] as WorldView | undefined) ?? "spaces";
}

function initialView() {
  if (window.location.pathname !== "/") {
    return worldViewFromPath(window.location.pathname);
  }
  return parseWorldView(worldLocalStorage.getItem(VIEW_KEY));
}

export default function WorldFoundationApp() {
  const [view, setViewState] = useState<WorldView>(initialView);
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
      worldLocalStorage.setItem(VIEW_KEY, next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [view]);

  const setView = (next: WorldView) => {
    setViewState(next);
    worldLocalStorage.setItem(VIEW_KEY, next);
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
      <nav className="world-primary-nav" aria-label="World views">
        <a
          className="world-primary-brand"
          href={WORLD_VIEW_PATHS.spaces}
          aria-label="Herdr World"
          onClick={(event) => {
            event.preventDefault();
            setView("spaces");
          }}
        >
          <img src="/herdr-world-logo.svg" alt="" width="25" height="25" />
          <span>World</span>
        </a>
        <div className="world-primary-tabs" role="tablist" aria-label="Views">
          {WORLD_VIEWS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={view === candidate}
              className={view === candidate ? "is-active" : ""}
              onClick={() => setView(candidate)}
            >
              {candidate[0].toUpperCase() + candidate.slice(1)}
            </button>
          ))}
        </div>
      </nav>
      <div
        className={`world-spaces-layer ${view === "spaces" ? "is-active" : ""}`}
        aria-hidden={view !== "spaces"}
      >
        <App
          operationalShortcutsEnabled={view === "spaces"}
          inspectorPortal={view === "spaces" ? null : inspectorPortal}
          onInspectorVisibilityChange={setInspectorOpen}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (world.nodeById.get(selectedId) ?? null) : null;

  useEffect(() => {
    if (selectedId && !world.nodeById.has(selectedId)) setSelectedId(null);
  }, [selectedId, world]);

  useEffect(() => {
    if (!shouldCloseWorldInspector(selected)) return;
    window.dispatchEvent(new Event(WORKSPACE_INSPECTOR_CLOSE_EVENT));
  }, [selected]);

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
                    onSelect={setSelectedId}
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
                    onSelect={setSelectedId}
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
                    onSelect={setSelectedId}
                  />
                </Suspense>
              )}
            </WorldViewErrorBoundary>
          </section>
          <aside className="world-context-rail" aria-label="World context">
            {selected ? (
              <WorldSelectionPanel
                node={selected}
                onClose={() => setSelectedId(null)}
                onOpenSpaces={onOpenSpaces}
              />
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

export function selectedHostStatusLabel(
  host: Pick<WorldHostObject, "label" | "hostState"> | null,
) {
  return host
    ? `${host.label} · ${hostStateLabel(host.hostState)}`
    : "No host selected";
}

export function shouldCloseWorldInspector(node: WorldObjectNode | null) {
  return node !== null && !node.selectedHost;
}

function WorldSelectionPanel({
  node,
  onClose,
  onOpenSpaces,
}: {
  node: WorldObjectNode;
  onClose(): void;
  onOpenSpaces(): void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspace = workspaceTarget(node);
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;

  async function activate(view?: InspectorView) {
    if (!workspace || !node.actionable || working) return;
    setWorking(true);
    setError(null);
    try {
      if (view) {
        await dispatchWorldInspectorRequest(node, view);
      } else {
        await focusWorldNode(node);
        onOpenSpaces();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }

  return (
    <aside className="world-selection-panel" aria-label="World selection">
      <button
        className="world-panel-close"
        type="button"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <p className="world-eyebrow">{node.kind}</p>
      <h2>{node.label}</h2>
      <dl>
        <div>
          <dt>Host</dt>
          <dd>{node.hostLabel}</dd>
        </div>
        {node.kind === "agent" || node.kind === "terminal" ? (
          <>
            <div>
              <dt>Space</dt>
              <dd>{node.spaceLabel}</dd>
            </div>
            {node.tabLabel ? (
              <div>
                <dt>Tab</dt>
                <dd>
                  {node.tabLabel}
                  {node.tabNumber === undefined ? "" : ` · ${node.tabNumber}`}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
        <div>
          <dt>Generation</dt>
          <dd>{node.generation}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{hostStateLabel(node.hostState)}</dd>
        </div>
        {leaf ? (
          <>
            <div>
              <dt>{leaf.kind === "agent" ? "Agent" : "Terminal"}</dt>
              <dd>
                {leaf.kind === "agent"
                  ? (leaf.stateLabels[leaf.status] ?? leaf.status)
                  : leaf.nativeId}
              </dd>
            </div>
            {leaf.agentLabel ? (
              <div>
                <dt>Persona</dt>
                <dd>{leaf.agentLabel}</dd>
              </div>
            ) : null}
            {leaf.modelLabel ? (
              <div>
                <dt>Model</dt>
                <dd>{leaf.modelLabel}</dd>
              </div>
            ) : null}
            {leaf.focused ? (
              <div>
                <dt>Focus</dt>
                <dd>Focused</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      {leaf?.taskSummary ? (
        <section className="world-task-summary" aria-label="Current task">
          <span>Current task</span>
          <p>{leaf.taskSummary}</p>
        </section>
      ) : null}
      {node.capabilities.activateHost ? (
        <div className="world-panel-actions">
          <button
            type="button"
            disabled={working}
            onClick={() => void activateHost()}
          >
            Activate {node.hostLabel}
          </button>
        </div>
      ) : null}
      {workspace ? (
        <div className="world-panel-actions">
          <button
            type="button"
            disabled={!node.capabilities.openSpaces || working}
            onClick={() => void activate()}
          >
            Open in Spaces
          </button>
          <button
            type="button"
            disabled={!node.capabilities.files || working}
            onClick={() => void activate("files")}
          >
            Files
          </button>
          <button
            type="button"
            disabled={!node.capabilities.changes || working}
            onClick={() => void activate("changes")}
          >
            Changes
          </button>
          {leaf?.kind === "agent" ? (
            <button
              type="button"
              disabled={!node.capabilities.agentHistory || working}
              onClick={() => void activate("history")}
            >
              Agent History
            </button>
          ) : null}
        </div>
      ) : null}
      {!node.actionable ? (
        <p className="world-panel-warning">
          {node.capabilities.activateHost
            ? `This observation is read-only. Activate ${node.hostLabel} to use its operational tools.`
            : "This observation is read-only until its host is ready again."}
        </p>
      ) : null}
      {error ? (
        <p className="world-panel-error" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );

  async function activateHost() {
    if (!node.capabilities.activateHost || working) return;
    setWorking(true);
    setError(null);
    try {
      await activateWorldNodeHost(node);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  }
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
