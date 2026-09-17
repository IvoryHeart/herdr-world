import { ChevronRight, SquareTerminal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { worldLocalStorage } from "../browserStorage";
import { AgentIcon } from "../components/AgentIcon";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import { readTreePreferences, writeTreePreferences } from "./treePreferences";
import {
  projectWorldTree,
  type WorldTreeHost,
  type WorldTreeProjection,
  type WorldTreeSpace,
} from "./treeProjection";
import type { WorldObject, WorldObjectNode } from "./worldObject";

export type WorldNodeAnchors = Record<string, OfficeCanvasAnchor>;

export default function ConnectedTreeView({
  world,
  selectedId,
  conversationNodeIds,
  onSelect,
  onOpenTerminal,
  onSelectedAnchorChange,
  onNodeAnchorsChange,
}: {
  world: WorldObject;
  selectedId: string | null;
  conversationNodeIds: readonly string[];
  onSelect(id: string): void;
  onOpenTerminal(id: string): void;
  onSelectedAnchorChange(anchor: OfficeCanvasAnchor | null): void;
  onNodeAnchorsChange(anchors: WorldNodeAnchors | null): void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(readTreePreferences(worldLocalStorage).collapsedIds),
  );
  const projection = useMemo(() => projectWorldTree(world), [world]);
  const matches = useMemo(
    () => connectedTreeMatches(projection, query),
    [projection, query],
  );
  const searchActive = matches !== null;
  const visibleHosts = searchActive
    ? projection.hosts.filter((host) => matches.has(host.source.id))
    : projection.hosts;

  useEffect(() => {
    writeTreePreferences(worldLocalStorage, { collapsedIds: [...collapsed] });
  }, [collapsed]);

  const toggle = (id: string) => {
    if (searchActive) return;
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reportAnchors = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const wanted = new Set(conversationNodeIds);
    if (selectedId) wanted.add(selectedId);
    const anchors: WorldNodeAnchors = {};
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-world-node-anchor]",
    )) {
      const id = element.dataset.worldNodeAnchor;
      if (!id || !wanted.has(id) || element.offsetParent === null) continue;
      anchors[id] = elementAnchor(element, root);
    }
    onNodeAnchorsChange(anchors);
    onSelectedAnchorChange(selectedId ? (anchors[selectedId] ?? null) : null);
  }, [
    conversationNodeIds,
    onNodeAnchorsChange,
    onSelectedAnchorChange,
    selectedId,
  ]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        reportAnchors();
      });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      onNodeAnchorsChange(null);
      onSelectedAnchorChange(null);
    };
  }, [
    collapsed,
    matches,
    onNodeAnchorsChange,
    onSelectedAnchorChange,
    reportAnchors,
    world,
  ]);

  if (!world.hosts.length) {
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="world-connected-tree-shell">
      <label className="world-search world-tree-search">
        <span>Search Tree</span>
        <input
          type="search"
          value={query}
          placeholder="Host, space, agent, task, or model"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <p className="world-tree-results" aria-live="polite">
        {searchActive
          ? visibleHosts.length
            ? `${visibleHosts.length} matching host branches`
            : "No Tree matches"
          : `${visibleHosts.length} host branches`}
      </p>
      {projection.omittedHostCount ||
      projection.omittedSpaceCount ||
      projection.coverage.omittedLeaves ? (
        <p className="world-tree-overflow-summary" aria-live="polite">
          Presentation bounds omit {projection.omittedHostCount} hosts,{" "}
          {projection.omittedSpaceCount} spaces, and{" "}
          {projection.coverage.omittedLeaves} leaves.
        </p>
      ) : null}
      {visibleHosts.length ? (
        <>
          <div
            className="world-connected-tree"
            role="tree"
            aria-label="Connected World hierarchy"
          >
            {visibleHosts.map((host) => (
              <VisualHost
                key={host.source.id}
                host={host}
                matches={matches}
                searchActive={searchActive}
                collapsed={collapsed}
                selectedId={selectedId}
                onToggle={toggle}
                onSelect={onSelect}
                onOpenTerminal={onOpenTerminal}
              />
            ))}
          </div>
          <ul
            className="world-tree-outline"
            aria-label="World hierarchy outline"
          >
            {visibleHosts.map((host) => (
              <SemanticHost
                key={host.source.id}
                host={host}
                matches={matches}
                searchActive={searchActive}
                collapsed={collapsed}
                selectedId={selectedId}
                onToggle={toggle}
                onSelect={onSelect}
                onOpenTerminal={onOpenTerminal}
              />
            ))}
          </ul>
        </>
      ) : (
        <div className="world-empty">
          <h2>No matches</h2>
        </div>
      )}
    </div>
  );
}

type BranchProps = {
  matches: ReadonlySet<string> | null;
  searchActive: boolean;
  collapsed: ReadonlySet<string>;
  selectedId: string | null;
  onToggle(id: string): void;
  onSelect(id: string): void;
  onOpenTerminal(id: string): void;
};

function VisualHost({ host, ...props }: { host: WorldTreeHost } & BranchProps) {
  const expanded = props.searchActive || !props.collapsed.has(host.source.id);
  const spaces = shownSpaces(host, props.matches);
  return (
    <section
      className="world-connected-tree-host"
      role="treeitem"
      aria-expanded={expanded}
      data-tree-host-id={host.source.id}
      data-has-children={
        expanded && (spaces.length > 0 || host.omittedSpaceCount > 0)
      }
    >
      <TreeCard node={host.source} expanded={expanded} {...props} />
      {expanded && (spaces.length > 0 || host.omittedSpaceCount > 0) ? (
        <div className="world-connected-tree-spaces" role="group">
          {spaces.map((space) => (
            <VisualSpace key={space.source.id} space={space} {...props} />
          ))}
          {host.omittedSpaceCount ? (
            <p className="world-connected-tree-overflow">
              +{host.omittedSpaceCount} omitted spaces
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function VisualSpace({
  space,
  ...props
}: { space: WorldTreeSpace } & BranchProps) {
  const expanded = props.searchActive || !props.collapsed.has(space.source.id);
  const leaves = shownLeaves(space, props.matches);
  return (
    <section
      className="world-connected-tree-space"
      role="treeitem"
      aria-expanded={expanded}
      data-has-children={
        expanded && (leaves.length > 0 || space.omittedChildCount > 0)
      }
    >
      <TreeCard node={space.source} expanded={expanded} {...props} />
      {expanded && (leaves.length > 0 || space.omittedChildCount > 0) ? (
        <div className="world-connected-tree-leaves" role="group">
          {leaves.map((leaf) => (
            <TreeCard key={leaf.id} node={leaf} {...props} />
          ))}
          {space.omittedChildCount ? (
            <p className="world-connected-tree-overflow">
              +{space.omittedChildCount} omitted leaves
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TreeCard({
  node,
  selectedId,
  searchActive,
  expanded,
  onToggle,
  onSelect,
  onOpenTerminal,
}: {
  node: WorldObjectNode;
  expanded?: boolean;
} & BranchProps) {
  const leaf = node.kind === "agent" || node.kind === "terminal";
  return (
    <div
      className="world-connected-tree-card-wrap"
      data-kind={node.kind}
      data-state={nodeState(node)}
    >
      <button
        type="button"
        className={`world-connected-tree-card${selectedId === node.id ? " is-selected" : ""}${node.stale ? " is-stale" : ""}`}
        data-world-node-anchor={node.id}
        aria-pressed={selectedId === node.id}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => {
          if (leaf && node.actionable) onOpenTerminal(node.id);
        }}
      >
        <span className="world-connected-tree-kind">
          <NodeIcon node={node} /> {node.kind}
        </span>
        <strong title={node.label}>{node.label}</strong>
        <small title={nodeSummary(node)}>{nodeSummary(node)}</small>
      </button>
      {expanded !== undefined ? (
        <button
          type="button"
          className="world-connected-tree-toggle"
          aria-label={
            searchActive
              ? `${node.label} expanded for search`
              : `${expanded ? "Collapse" : "Expand"} ${node.label}`
          }
          aria-expanded={expanded}
          disabled={searchActive}
          onClick={() => onToggle(node.id)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : null}
      {leaf && node.actionable ? (
        <button
          type="button"
          className="world-connected-tree-terminal"
          aria-label={`Open ${node.label} terminal`}
          title="Open terminal"
          onClick={() => onOpenTerminal(node.id)}
        >
          <SquareTerminal size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function SemanticHost({
  host,
  ...props
}: { host: WorldTreeHost } & BranchProps) {
  const expanded = props.searchActive || !props.collapsed.has(host.source.id);
  return (
    <li data-tree-host-id={host.source.id}>
      <SemanticNode node={host.source} expanded={expanded} {...props} />
      {expanded ? (
        <ul>
          {shownSpaces(host, props.matches).map((space) => (
            <SemanticSpace key={space.source.id} space={space} {...props} />
          ))}
          {host.omittedSpaceCount ? (
            <li className="is-overflow">
              +{host.omittedSpaceCount} omitted spaces
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function SemanticSpace({
  space,
  ...props
}: { space: WorldTreeSpace } & BranchProps) {
  const expanded = props.searchActive || !props.collapsed.has(space.source.id);
  return (
    <li>
      <SemanticNode node={space.source} expanded={expanded} {...props} />
      {expanded ? (
        <ul>
          {shownLeaves(space, props.matches).map((leaf) => (
            <li key={leaf.id}>
              <SemanticNode node={leaf} {...props} />
            </li>
          ))}
          {space.omittedChildCount ? (
            <li className="is-overflow">
              +{space.omittedChildCount} omitted leaves
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function SemanticNode({
  node,
  selectedId,
  searchActive,
  expanded,
  onToggle,
  onSelect,
  onOpenTerminal,
}: {
  node: WorldObjectNode;
  expanded?: boolean;
} & BranchProps) {
  const leaf = node.kind === "agent" || node.kind === "terminal";
  return (
    <div className="world-tree-outline-row">
      {expanded !== undefined ? (
        <button
          type="button"
          className="world-tree-outline-toggle"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
          aria-expanded={expanded}
          disabled={searchActive}
          onClick={() => onToggle(node.id)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      ) : (
        <span className="world-tree-outline-spacer" />
      )}
      <button
        type="button"
        className="world-tree-outline-select"
        data-world-node-anchor={node.id}
        aria-pressed={selectedId === node.id}
        onClick={() => onSelect(node.id)}
      >
        <NodeIcon node={node} />
        <span>
          <strong>{node.label}</strong>
          <small>{nodeSummary(node)}</small>
        </span>
      </button>
      {leaf && node.actionable ? (
        <button
          type="button"
          className="world-tree-outline-terminal"
          aria-label={`Open ${node.label} terminal`}
          onClick={() => onOpenTerminal(node.id)}
        >
          <SquareTerminal size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function connectedTreeMatches(
  projection: WorldTreeProjection,
  rawQuery: string,
) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const host of projection.hosts) {
    if (nodeSearchText(host.source).includes(query)) {
      addHost(matches, host);
      continue;
    }
    for (const space of host.spaces) {
      if (nodeSearchText(space.source).includes(query)) {
        matches.add(host.source.id);
        addSpace(matches, space);
        continue;
      }
      for (const leaf of space.children) {
        if (nodeSearchText(leaf).includes(query)) {
          matches.add(host.source.id);
          matches.add(space.source.id);
          matches.add(leaf.id);
        }
      }
    }
  }
  return matches;
}

function addHost(matches: Set<string>, host: WorldTreeHost) {
  matches.add(host.source.id);
  for (const space of host.spaces) addSpace(matches, space);
}

function addSpace(matches: Set<string>, space: WorldTreeSpace) {
  matches.add(space.source.id);
  for (const leaf of space.children) matches.add(leaf.id);
}

function shownSpaces(host: WorldTreeHost, matches: ReadonlySet<string> | null) {
  return matches
    ? host.spaces.filter((space) => matches.has(space.source.id))
    : host.spaces;
}

function shownLeaves(
  space: WorldTreeSpace,
  matches: ReadonlySet<string> | null,
) {
  return matches
    ? space.children.filter((leaf) => matches.has(leaf.id))
    : space.children;
}

function nodeSearchText(node: WorldObjectNode) {
  const leaf = node.kind === "agent" || node.kind === "terminal" ? node : null;
  return [
    node.label,
    node.hostLabel,
    node.connectionId,
    node.kind,
    leaf?.status,
    leaf?.agentLabel,
    leaf?.modelLabel,
    leaf?.taskSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

function NodeIcon({ node }: { node: WorldObjectNode }) {
  if (node.kind === "agent") {
    return <AgentIcon agent={node.pane.agent ?? "agent"} compact />;
  }
  return (
    <span aria-hidden="true">
      {node.kind === "host" ? "⌂" : node.kind === "space" ? "□" : ">_"}
    </span>
  );
}

function nodeState(node: WorldObjectNode) {
  return node.kind === "agent" || node.kind === "terminal"
    ? node.status
    : node.hostState;
}

function nodeSummary(node: WorldObjectNode) {
  if (node.kind === "agent" || node.kind === "terminal") {
    return [
      node.stale ? "stale" : (node.stateLabels[node.status] ?? node.status),
      node.focused ? "focused" : null,
      node.modelLabel,
      node.taskSummary,
      node.hostLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return `${hostStateLabel(node.hostState)} · ${node.hostLabel}`;
}

function hostStateLabel(state: WorldObjectNode["hostState"]) {
  if (state === "active") return "Active";
  if (state === "ready-inactive") return "Ready · inactive";
  if (state === "reconnecting") return "Reconnecting";
  return "Offline · stale";
}

function elementAnchor(
  element: HTMLElement,
  root: HTMLElement,
): OfficeCanvasAnchor {
  const rect = element.getBoundingClientRect();
  const clip = root.getBoundingClientRect();
  const visible =
    rect.right > clip.left &&
    rect.left < clip.right &&
    rect.bottom > clip.top &&
    rect.top < clip.bottom;
  const centerX = (rect.left + rect.right) / 2;
  const centerY = (rect.top + rect.bottom) / 2;
  const x = Math.max(clip.left + 4, Math.min(clip.right - 4, rect.right));
  const y = Math.max(clip.top + 4, Math.min(clip.bottom - 4, centerY));
  const edge = visible
    ? null
    : centerY < clip.top
      ? "top"
      : centerY > clip.bottom
        ? "bottom"
        : centerX < clip.left
          ? "left"
          : "right";
  return { x, y, visible, edge };
}
