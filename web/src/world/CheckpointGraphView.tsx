import { useState } from "react";
import type {
  WorldHostState,
  WorldObject,
  WorldObjectNode,
} from "./worldObject";

export default function CheckpointGraphView({
  world,
  selectedId,
  onSelect,
}: {
  world: WorldObject;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  if (!world.hosts.length) {
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );
  }
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
        ) : (
          <span>{hostStateLabel(node.hostState)}</span>
        )}
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

function hostStateLabel(state: WorldHostState) {
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
