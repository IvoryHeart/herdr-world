import { useEffect, useMemo, useState } from "react";
import App from "../App";
import { worldLocalStorage } from "../browserStorage";
import { AgentIcon } from "../components/AgentIcon";
import { store } from "../store";
import {
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
  type WorldSpaceObject,
} from "./worldObject";
import "./world.css";

export type WorldView = "spaces" | "office" | "tree" | "graph";

const VIEW_KEY = "worldView";
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
        <App />
      </div>
      {view !== "spaces" ? (
        <WorldControlPlane view={view} onOpenSpaces={() => setView("spaces")} />
      ) : null}
    </div>
  );
}

function WorldControlPlane({
  view,
  onOpenSpaces,
}: {
  view: Exclude<WorldView, "spaces">;
  onOpenSpaces: () => void;
}) {
  const runtime = useWorldRuntime();
  const world = useMemo(
    () => buildWorldObject(runtime.connections),
    [runtime.connections],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? (world.nodeById.get(selectedId) ?? null) : null;

  useEffect(() => {
    if (selectedId && !world.nodeById.has(selectedId)) setSelectedId(null);
  }, [selectedId, world]);

  return (
    <main className="world-control-plane" id="world">
      <WorldStatusHeader runtime={runtime} world={world} />
      <div className={`world-view-layout ${selected ? "has-selection" : ""}`}>
        <section className="world-view-stage" aria-label={`${view} view`}>
          {view === "office" ? (
            <OfficeView
              world={world}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : view === "tree" ? (
            <TreeView
              world={world}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ) : (
            <GraphView
              world={world}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}
        </section>
        {selected ? (
          <WorldSelectionPanel
            node={selected}
            onClose={() => setSelectedId(null)}
            onOpenSpaces={onOpenSpaces}
          />
        ) : null}
      </div>
    </main>
  );
}

function WorldStatusHeader({
  runtime,
  world,
}: {
  runtime: WorldRuntimeState;
  world: WorldObject;
}) {
  const ready = world.hosts.filter((host) => host.actionable).length;
  const stale = world.hosts.filter((host) => host.stale).length;
  return (
    <header className="world-status-header">
      <div>
        <p className="world-eyebrow">Visual control plane</p>
        <h1>Your agent world</h1>
      </div>
      <div className="world-status-summary" aria-live="polite">
        <span className="world-live-dot" data-status={runtime.status} />
        <span>{ready} ready</span>
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

type ViewProps = {
  world: WorldObject;
  selectedId: string | null;
  onSelect(id: string): void;
};

function EmptyWorld() {
  return (
    <div className="world-empty" role="status">
      <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
      <h2>No connected spaces yet</h2>
      <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
    </div>
  );
}

export function OfficeView({ world, selectedId, onSelect }: ViewProps) {
  if (!world.hosts.length) return <EmptyWorld />;
  return (
    <div className="world-office">
      {world.hosts.map((host) => (
        <section
          key={host.id}
          className={`world-office-host ${host.stale ? "is-stale" : ""}`}
          aria-label={`${host.label} office`}
        >
          <button
            type="button"
            className={`world-host-sign ${selectedId === host.id ? "is-selected" : ""}`}
            onClick={() => onSelect(host.id)}
          >
            <span>{host.label}</span>
            <small>{host.connection.state}</small>
          </button>
          <div className="world-office-rooms">
            {host.spaces.length ? (
              host.spaces.map((space) => (
                <OfficeRoom
                  key={space.id}
                  space={space}
                  selectedId={selectedId}
                  onSelect={onSelect}
                />
              ))
            ) : (
              <div className="world-office-no-rooms">No observed spaces</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function OfficeRoom({
  space,
  selectedId,
  onSelect,
}: {
  space: WorldSpaceObject;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <article className={`world-office-room ${space.stale ? "is-stale" : ""}`}>
      <button
        type="button"
        className={`world-room-title ${selectedId === space.id ? "is-selected" : ""}`}
        onClick={() => onSelect(space.id)}
      >
        <span>{space.label}</span>
        <small>{space.children.length} seats</small>
      </button>
      <div className="world-desk-grid">
        {space.children.map((leaf) => (
          <button
            key={leaf.id}
            type="button"
            className={`world-desk world-status-${leaf.status} ${
              selectedId === leaf.id ? "is-selected" : ""
            }`}
            onClick={() => onSelect(leaf.id)}
            aria-disabled={!leaf.actionable}
            title={`${leaf.label} · ${leaf.status}`}
          >
            <span className="world-character-frame">
              {leaf.kind === "agent" ? (
                <img
                  src={`/world/characters/${(stableNumber(leaf.id) % 12) + 1}-D-1.png`}
                  alt=""
                />
              ) : (
                <span className="world-terminal-glyph" aria-hidden="true">
                  &gt;_
                </span>
              )}
            </span>
            <span className="world-desk-top" />
            <span className="world-desk-label">{leaf.label}</span>
          </button>
        ))}
      </div>
    </article>
  );
}

export function TreeView({ world, selectedId, onSelect }: ViewProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const normalized = query.trim().toLowerCase();
  const matches = (node: WorldObjectNode) =>
    !normalized ||
    `${node.label} ${node.connectionId} ${node.kind}`
      .toLowerCase()
      .includes(normalized);
  const visibleHosts = world.hosts.filter(
    (host) =>
      matches(host) ||
      host.spaces.some(
        (space) => matches(space) || space.children.some(matches),
      ),
  );
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="world-tree-shell">
      <label className="world-search">
        <span>Search world</span>
        <input
          type="search"
          value={query}
          placeholder="Host, space, or agent"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visibleHosts.length ? (
        <div className="world-tree" role="tree">
          {visibleHosts.map((host) => (
            <TreeHost
              key={host.id}
              host={host}
              matches={matches}
              forceExpanded={Boolean(normalized)}
              collapsed={collapsed}
              onToggle={toggle}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : (
        <div className="world-empty">
          <h2>No matches</h2>
        </div>
      )}
    </div>
  );
}

function TreeHost({
  host,
  matches,
  forceExpanded,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  host: WorldHostObject;
  matches(node: WorldObjectNode): boolean;
  forceExpanded: boolean;
  collapsed: ReadonlySet<string>;
  onToggle(id: string): void;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const hostMatch = matches(host);
  const hostExpanded = forceExpanded || !collapsed.has(host.id);
  return (
    <div
      className="world-tree-host"
      role="treeitem"
      aria-expanded={hostExpanded}
    >
      <div className="world-tree-line">
        <TreeToggle node={host} expanded={hostExpanded} onToggle={onToggle} />
        <TreeButton node={host} selectedId={selectedId} onSelect={onSelect} />
      </div>
      {hostExpanded ? (
        <div role="group">
          {host.spaces
            .filter(
              (space) =>
                hostMatch || matches(space) || space.children.some(matches),
            )
            .map((space) => {
              const spaceMatch = matches(space);
              const spaceExpanded = forceExpanded || !collapsed.has(space.id);
              return (
                <div
                  key={space.id}
                  className="world-tree-space"
                  role="treeitem"
                  aria-expanded={spaceExpanded}
                >
                  <div className="world-tree-line">
                    <TreeToggle
                      node={space}
                      expanded={spaceExpanded}
                      onToggle={onToggle}
                    />
                    <TreeButton
                      node={space}
                      selectedId={selectedId}
                      onSelect={onSelect}
                    />
                  </div>
                  {spaceExpanded ? (
                    <div role="group">
                      {space.children
                        .filter(
                          (leaf) => hostMatch || spaceMatch || matches(leaf),
                        )
                        .map((leaf) => (
                          <div
                            className="world-tree-line"
                            key={leaf.id}
                            role="treeitem"
                          >
                            <span className="world-tree-toggle-spacer" />
                            <TreeButton
                              node={leaf}
                              selectedId={selectedId}
                              onSelect={onSelect}
                            />
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      ) : null}
    </div>
  );
}

function TreeToggle({
  node,
  expanded,
  onToggle,
}: {
  node: WorldHostObject | WorldSpaceObject;
  expanded: boolean;
  onToggle(id: string): void;
}) {
  return (
    <button
      type="button"
      className="world-tree-toggle"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
      onClick={() => onToggle(node.id)}
    >
      {expanded ? "−" : "+"}
    </button>
  );
}

function TreeButton({
  node,
  selectedId,
  onSelect,
}: {
  node: WorldObjectNode;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  return (
    <button
      type="button"
      className={`world-tree-node world-node-${node.kind} ${
        selectedId === node.id ? "is-selected" : ""
      }`}
      onClick={() => onSelect(node.id)}
    >
      <span className="world-tree-node-icon">
        {node.kind === "agent" ? (
          <AgentIcon agent={node.pane.agent ?? "agent"} compact />
        ) : node.kind === "host" ? (
          "⌂"
        ) : node.kind === "space" ? (
          "□"
        ) : (
          ">_"
        )}
      </span>
      <span>{node.label}</span>
      <small>{node.kind}</small>
      {node.stale ? <em>stale</em> : null}
    </button>
  );
}

export function GraphView({ world, selectedId, onSelect }: ViewProps) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (!world.hosts.length) return <EmptyWorld />;
  const normalized = query.trim().toLowerCase();
  const matches = (node: WorldObjectNode) =>
    !normalized ||
    `${node.label} ${node.connectionId} ${node.kind}`
      .toLowerCase()
      .includes(normalized);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const visibleHosts = world.hosts.filter(
    (host) =>
      matches(host) ||
      host.spaces.some(
        (space) => matches(space) || space.children.some(matches),
      ),
  );
  return (
    <div className="world-graph-shell">
      <label className="world-search">
        <span>Search graph</span>
        <input
          type="search"
          value={query}
          placeholder="Host, space, or agent"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {visibleHosts.length ? (
        <div
          className="world-graph"
          role="tree"
          aria-label="World relationship graph"
        >
          {visibleHosts.map((host) => {
            const hostMatch = matches(host);
            const hostExpanded = Boolean(normalized) || !collapsed.has(host.id);
            return (
              <div className="world-graph-host" key={host.id}>
                <GraphNode
                  node={host}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expanded={hostExpanded}
                  onToggle={toggle}
                />
                {hostExpanded ? (
                  <div className="world-graph-branches">
                    {host.spaces
                      .filter(
                        (space) =>
                          hostMatch ||
                          matches(space) ||
                          space.children.some(matches),
                      )
                      .map((space) => {
                        const spaceMatch = matches(space);
                        const spaceExpanded =
                          Boolean(normalized) || !collapsed.has(space.id);
                        return (
                          <div className="world-graph-space" key={space.id}>
                            <GraphNode
                              node={space}
                              selectedId={selectedId}
                              onSelect={onSelect}
                              expanded={spaceExpanded}
                              onToggle={toggle}
                            />
                            {spaceExpanded ? (
                              <div className="world-graph-leaves">
                                {space.children
                                  .filter(
                                    (leaf) =>
                                      hostMatch || spaceMatch || matches(leaf),
                                  )
                                  .map((leaf) => (
                                    <GraphNode
                                      key={leaf.id}
                                      node={leaf}
                                      selectedId={selectedId}
                                      onSelect={onSelect}
                                    />
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="world-empty">
          <h2>No matches</h2>
        </div>
      )}
    </div>
  );
}

function GraphNode({
  node,
  selectedId,
  onSelect,
  expanded,
  onToggle,
}: {
  node: WorldObjectNode;
  selectedId: string | null;
  onSelect(id: string): void;
  expanded?: boolean;
  onToggle?(id: string): void;
}) {
  return (
    <div
      className="world-graph-node-wrap"
      role="treeitem"
      {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
    >
      <button
        type="button"
        className={`world-graph-node world-node-${node.kind} ${
          selectedId === node.id ? "is-selected" : ""
        } ${node.stale ? "is-stale" : ""}`}
        onClick={() => onSelect(node.id)}
      >
        <small>{node.kind}</small>
        <strong>{node.label}</strong>
        {node.kind === "agent" || node.kind === "terminal" ? (
          <span>{node.status}</span>
        ) : null}
      </button>
      {onToggle && expanded !== undefined ? (
        <button
          type="button"
          className="world-graph-toggle"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          onClick={() => onToggle(node.id)}
        >
          {expanded ? "−" : "+"}
        </button>
      ) : null}
    </div>
  );
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
      await focusWorldNode(node);
      onOpenSpaces();
      if (view) {
        const snapshot = store.get();
        window.dispatchEvent(
          new CustomEvent<WorkspaceInspectorRequest>(
            WORKSPACE_INSPECTOR_REQUEST_EVENT,
            {
              detail: {
                connectionId: node.connectionId,
                generation: snapshot.connectionGeneration,
                workspaceId: workspace.workspaceId,
                view,
              },
            },
          ),
        );
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
          <dd>{node.connectionId}</dd>
        </div>
        <div>
          <dt>Generation</dt>
          <dd>{node.generation}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{node.stale ? "stale" : "live"}</dd>
        </div>
        {leaf ? (
          <div>
            <dt>Agent</dt>
            <dd>{leaf.status}</dd>
          </div>
        ) : null}
      </dl>
      {workspace ? (
        <div className="world-panel-actions">
          <button
            type="button"
            disabled={!node.actionable || working}
            onClick={() => void activate()}
          >
            Open in Spaces
          </button>
          <button
            type="button"
            disabled={!node.actionable || working}
            onClick={() => void activate("files")}
          >
            Files
          </button>
          <button
            type="button"
            disabled={!node.actionable || working}
            onClick={() => void activate("changes")}
          >
            Changes
          </button>
          {leaf?.kind === "agent" ? (
            <button
              type="button"
              disabled={!node.actionable || working}
              onClick={() => void activate("history")}
            >
              Agent History
            </button>
          ) : null}
        </div>
      ) : null}
      {!node.actionable ? (
        <p className="world-panel-warning">
          This observation is read-only until its host is ready again.
        </p>
      ) : null}
      {error ? (
        <p className="world-panel-error" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

function workspaceTarget(node: WorldObjectNode) {
  if (node.kind === "space")
    return { workspaceId: node.nativeId, paneId: null };
  if (node.kind === "agent" || node.kind === "terminal") {
    return { workspaceId: node.workspaceId, paneId: node.nativeId };
  }
  return null;
}

export async function focusWorldNode(node: WorldObjectNode) {
  const target = workspaceTarget(node);
  if (!target) throw new Error("Select a space, agent, or terminal first");
  const connection = store
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
    await store.focusTaskNotificationTarget({
      connectionId: node.connectionId,
      runtimeGeneration: node.generation,
      workspaceId: target.workspaceId,
      paneId: target.paneId,
    });
    const current = store
      .get()
      .connections.find((candidate) => candidate.id === node.connectionId);
    if (
      store.get().activeConnectionId !== node.connectionId ||
      !current ||
      current.state !== "ready" ||
      current.generation !== node.generation
    ) {
      throw new Error("The selected host changed while it was opening");
    }
  } else {
    if (store.get().activeConnectionId !== node.connectionId) {
      if (!store.selectConnection(node.connectionId)) {
        throw new Error("The selected host could not be activated");
      }
      await store.refresh();
    }
    const current = store
      .get()
      .connections.find((candidate) => candidate.id === node.connectionId);
    if (!current || current.generation !== node.generation) {
      throw new Error("The selected host changed while it was opening");
    }
    await store.focusWorkspace(target.workspaceId);
  }
}

function stableNumber(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
