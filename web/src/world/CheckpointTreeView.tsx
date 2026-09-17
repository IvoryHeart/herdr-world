import { useState } from "react";
import { AgentIcon } from "../components/AgentIcon";
import type {
  WorldHostObject,
  WorldObject,
  WorldObjectNode,
  WorldSpaceObject,
} from "./worldObject";

export default function CheckpointTreeView({
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
      {node.kind === "host" ? <em>{hostStateLabel(node.hostState)}</em> : null}
      {node.stale ? <em>stale</em> : null}
    </button>
  );
}

function hostStateLabel(state: WorldHostObject["hostState"]) {
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
