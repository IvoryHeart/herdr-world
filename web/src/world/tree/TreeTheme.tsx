import {
  Bot,
  ChevronLeft,
  ChevronRight,
  GitFork,
  Maximize2,
  PanelLeft,
  Search,
  Server,
  SquareTerminal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { AgentIcon } from "../../AgentIcon";
import type { SurfaceComponentProps } from "../../surfaceRegistry";
import type {
  HerdrGraphProjection,
  WorldGraphHost,
  WorldGraphNode,
  WorldGraphSpace,
} from "../graph/herdrGraphProjection";
import { isWorldThemeContext } from "../worldThemeContext";
import type { WorldThemeContext } from "../worldThemeContext";
import {
  readTreeViewPrefs,
  writeTreeViewPrefs,
} from "./treeViewPrefs";
import type { TreeCamera } from "./treeViewPrefs";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;

export default function TreeTheme({ context: value }: SurfaceComponentProps) {
  if (!isWorldThemeContext(value)) {
    return (
      <div className="surface-unavailable" role="alert">
        <strong>Tree unavailable</strong>
        <span>The shared World context is not ready.</span>
      </div>
    );
  }
  return <TreeStage context={value} />;
}

function TreeStage({ context }: { context: WorldThemeContext }) {
  const projection = context.graphProjection;
  const [initialPrefs] = useState(readTreeViewPrefs);
  const [collapsedIds, setCollapsedIds] = useState(() => new Set(initialPrefs.collapsedIds));
  const [camera, setCamera] = useState<TreeCamera>(initialPrefs.camera);
  const [query, setQuery] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; camera: TreeCamera } | null>(null);
  const persistRef = useRef<number | null>(null);
  const matches = useMemo(() => treeMatches(projection.hosts, query), [projection.hosts, query]);
  const queryActive = Boolean(query.trim());
  const visibleHosts = queryActive
    ? projection.hosts.filter(({ node }) => matches?.has(node.id))
    : projection.hosts;
  const selectedNode = projection.nodes.find(({ selectionKey }) =>
    selectionKey === context.selectedKey) ?? null;

  useEffect(() => {
    if (persistRef.current !== null) window.clearTimeout(persistRef.current);
    persistRef.current = window.setTimeout(() => {
      persistRef.current = null;
      writeTreeViewPrefs({ camera, collapsedIds: [...collapsedIds] });
    }, 120);
    return () => {
      if (persistRef.current !== null) window.clearTimeout(persistRef.current);
    };
  }, [camera, collapsedIds]);

  useEffect(() => () => writeTreeViewPrefs({
    camera,
    collapsedIds: [...collapsedIds],
  }), [camera, collapsedIds]);

  const toggle = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const zoomBy = (factor: number) => setCamera((current) => ({
    ...current,
    zoom: clampZoom(current.zoom * factor),
  }));

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const map = mapRef.current;
    if (!viewport || !map) return;
    const width = Math.max(map.scrollWidth, 1);
    const height = Math.max(map.scrollHeight, 1);
    const zoom = clampZoom(Math.min(
      (viewport.clientWidth - 32) / width,
      (viewport.clientHeight - 32) / height,
      1,
    ));
    setCamera({ x: 16, y: 16, zoom });
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button, input")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, camera };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCamera({
      ...drag.camera,
      x: drag.camera.x + event.clientX - drag.x,
      y: drag.camera.y + event.clientY - drag.y,
    });
  };
  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const overflowCount = projection.omittedHostCount + projection.omittedSpaceCount +
    projection.coverage.omittedTerminals;
  return (
    <div className="tree-stage-shell">
      <header className="tree-stage-bar">
        <button className="icon-btn" type="button"
          aria-label={context.compact ? "Back to Herdr sidebar" : "Toggle sidebar"}
          onClick={context.compact ? context.onBackToSidebar : context.onToggleSidebar}>
          {context.compact ? <ChevronLeft size={20} /> : <PanelLeft size={18} />}
        </button>
        <div className="tree-stage-heading"><strong>World Tree</strong><span>
          {projection.coverage.presentedHosts} hosts · {projection.coverage.presentedSpaces} spaces · {projection.coverage.presentedTerminals} leaves
        </span></div>
        <label className="tree-search"><Search size={14} aria-hidden="true" />
          <span className="sr-only">Search Tree</span>
          <input type="search" value={query} placeholder="Search hosts, spaces, agents"
            onChange={(event) => setQuery(event.currentTarget.value)} />
        </label>
        <div className="tree-zoom-controls" role="group" aria-label="Tree zoom controls">
          <button className="icon-btn" type="button" aria-label="Zoom out" onClick={() => zoomBy(0.85)}><ZoomOut size={16} /></button>
          <button className="icon-btn" type="button" aria-label="Zoom in" onClick={() => zoomBy(1.15)}><ZoomIn size={16} /></button>
        </div>
        <button className="btn tree-fit" type="button" onClick={fit}><Maximize2 size={14} />Fit tree</button>
      </header>
      <div className="tree-content">
        {!context.compact ? <div ref={viewportRef} className="tree-viewport" aria-label="Interactive World tree"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={endPointer} onPointerCancel={endPointer}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
            else setCamera((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
          }}>
          <div ref={mapRef} className="tree-map" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
            {visibleHosts.map((host) => (
              <VisualHost key={host.node.id} host={host} matches={matches}
                queryActive={queryActive} collapsedIds={collapsedIds} selectedKey={context.selectedKey}
                onToggle={toggle} onSelect={context.onGraphSelect}
                onActivate={context.onGraphOpenTerminal} />
            ))}
          </div>
          {overflowCount > 0 ? <div className="tree-overflow-badge">+{overflowCount} entities omitted by presentation limits</div> : null}
        </div> : null}
        <aside className="tree-panel" aria-label="Tree details and semantic hierarchy">
          <div className="tree-results" aria-live="polite">
            {queryActive ? visibleHosts.length ? `${visibleHosts.length} matching host branches` : "No Tree matches" : `${visibleHosts.length} presented hosts`}
          </div>
          <div className="sr-only" aria-live="polite">
            {selectedNode
              ? `Selected ${kindLabel(selectedNode)} ${selectedNode.label}, ${nodeSummary(selectedNode)}`
              : "No Tree entity selected"}
          </div>
          {selectedNode ? <TreeDetails node={selectedNode} projection={projection}
            onOpenTerminal={() => context.onGraphOpenTerminal(selectedNode)}
            onOpenInSpaces={() => context.onGraphOpenInSpaces(selectedNode)} />
            : <p className="tree-details-empty">Select a host, space, agent, or terminal to inspect it.</p>}
          <ul className="tree-semantic" aria-label="Presented hosts, spaces, agents, and terminals">
            {visibleHosts.map((host) => <SemanticHost key={host.node.id} host={host}
              matches={matches} queryActive={queryActive} collapsedIds={collapsedIds}
              selectedKey={context.selectedKey} onToggle={toggle}
              onSelect={context.onGraphSelect} onActivate={context.onGraphOpenTerminal}
              onOpenInSpaces={context.onGraphOpenInSpaces} />)}
          </ul>
          {projection.omittedHostCount > 0 ? <p className="tree-omitted">{projection.omittedHostCount} hosts omitted by the 128-host limit.</p> : null}
          {projection.omittedSpaceCount > 0 ? <p className="tree-omitted">{projection.omittedSpaceCount} spaces omitted by the 128-space limit.</p> : null}
          {context.handoffStatus ? <p className="world-handoff-status" role="status">{context.handoffStatus}</p> : null}
        </aside>
      </div>
    </div>
  );
}

type TreeBranchProps = {
  collapsedIds: ReadonlySet<string>;
  selectedKey: string | null;
  matches: ReadonlySet<string> | null;
  queryActive: boolean;
  onToggle: (id: string) => void;
  onSelect: (selectionKey: string, hostKey: string) => void;
  onActivate: (node: WorldGraphNode) => void;
};

function VisualHost({ host, ...props }: { host: WorldGraphHost } & TreeBranchProps) {
  const collapsed = props.collapsedIds.has(host.node.id) && !props.queryActive;
  const spaces = shownSpaces(host, props.matches, props.queryActive);
  return <section className="tree-visual-host">
    <VisualCard node={host.node} selectedKey={props.selectedKey} onSelect={props.onSelect}
      collapsible collapsed={collapsed} onToggle={() => props.onToggle(host.node.id)} />
    {!collapsed ? <div className="tree-visual-spaces">{spaces.map((space) => {
      const spaceCollapsed = props.collapsedIds.has(space.node.id) && !props.queryActive;
      const children = shownChildren(space, props.matches, props.queryActive);
      return <section className="tree-visual-space" key={space.node.id}>
        <VisualCard node={space.node} selectedKey={props.selectedKey} onSelect={props.onSelect}
          collapsible collapsed={spaceCollapsed} onToggle={() => props.onToggle(space.node.id)} />
        {!spaceCollapsed ? <div className="tree-visual-leaves">{children.map((child) =>
          <VisualCard key={child.id} node={child} selectedKey={props.selectedKey}
            onSelect={props.onSelect} onActivate={props.onActivate} />)}</div> : null}
      </section>;
    })}</div> : null}
  </section>;
}

function VisualCard({ node, selectedKey, onSelect, onActivate, collapsible, collapsed, onToggle }: {
  node: WorldGraphNode; selectedKey: string | null;
  onSelect: (selectionKey: string, hostKey: string) => void;
  onActivate?: (node: WorldGraphNode) => void;
  collapsible?: boolean; collapsed?: boolean; onToggle?: () => void;
}) {
  return <div className="tree-card-wrap" data-kind={node.kind} data-state={displayStatus(node)}>
    <button className="tree-card" type="button" aria-pressed={selectedKey === node.selectionKey}
      aria-label={`${node.label}, ${kindLabel(node)}, ${nodeSummary(node)}`}
      onClick={() => onSelect(node.selectionKey, node.hostKey)}
      onDoubleClick={() => node.actionable && onActivate?.(node)}>
      <NodeIcon node={node} /><span><strong>{node.label}</strong><small>{nodeSummary(node)}</small></span>
    </button>
    {collapsible ? <button className="tree-card-collapse" type="button"
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.label}`} aria-expanded={!collapsed}
      onClick={onToggle}><ChevronRight size={14} /></button> : null}
  </div>;
}

function SemanticHost({ host, ...props }: { host: WorldGraphHost } & TreeBranchProps & {
  onOpenInSpaces: (node: WorldGraphNode) => void;
}) {
  const collapsed = props.collapsedIds.has(host.node.id) && !props.queryActive;
  return <li><SemanticParent node={host.node} collapsed={collapsed} {...props} />
    {!collapsed ? <ul aria-label={`Spaces on ${host.node.label}`}>
      {shownSpaces(host, props.matches, props.queryActive).map((space) =>
        <SemanticSpace key={space.node.id} space={space} {...props} />)}
      {host.spaces.length === 0 ? <li className="tree-empty">No observed spaces</li> : null}
      {host.omittedSpaceCount > 0 ? <li className="tree-omitted">{host.omittedSpaceCount} additional spaces omitted.</li> : null}
    </ul> : null}
  </li>;
}

function SemanticSpace({ space, ...props }: { space: WorldGraphSpace } & TreeBranchProps & {
  onOpenInSpaces: (node: WorldGraphNode) => void;
}) {
  const collapsed = props.collapsedIds.has(space.node.id) && !props.queryActive;
  return <li><SemanticParent node={space.node} collapsed={collapsed} {...props} />
    {!collapsed ? <ul aria-label={`Agents and terminals in ${space.node.label}`}>
      {shownChildren(space, props.matches, props.queryActive).map((child) => <li key={child.id}>
        <button className="tree-semantic-select" type="button"
          aria-pressed={props.selectedKey === child.selectionKey}
          aria-label={`${child.label}, ${kindLabel(child)}, ${nodeSummary(child)}. Double-click to open terminal.`}
          onClick={() => props.onSelect(child.selectionKey, child.hostKey)}
          onDoubleClick={() => child.actionable && props.onActivate(child)}>
          <NodeIcon node={child} /><span><strong>{child.label}</strong><small>{nodeSummary(child)}</small></span>
        </button>
        {child.actionable ? <span className="tree-actions">
          <button type="button" onClick={() => props.onActivate(child)}>Open terminal</button>
          <button type="button" onClick={() => props.onOpenInSpaces(child)}>Open in Spaces</button>
        </span> : null}
      </li>)}
      {space.children.length === 0 ? <li className="tree-empty">No agents or terminals</li> : null}
      {space.omittedChildCount > 0 ? <li className="tree-omitted">{space.omittedChildCount} additional leaves omitted.</li> : null}
    </ul> : null}
  </li>;
}

function SemanticParent({ node, collapsed, onToggle, onSelect, onOpenInSpaces, selectedKey }: {
  node: WorldGraphNode; collapsed: boolean; onToggle: (id: string) => void;
  onSelect: (selectionKey: string, hostKey: string) => void;
  onOpenInSpaces: (node: WorldGraphNode) => void; selectedKey: string | null;
}) {
  return <div className="tree-semantic-row">
    <button className="tree-disclosure" type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.label}`}
      aria-expanded={!collapsed} onClick={() => onToggle(node.id)}><ChevronRight size={14} /></button>
    <button className="tree-semantic-select" type="button" aria-pressed={selectedKey === node.selectionKey}
      aria-label={`${node.label}, ${kindLabel(node)}, ${nodeSummary(node)}`}
      onClick={() => onSelect(node.selectionKey, node.hostKey)}><NodeIcon node={node} />
      <span><strong>{node.label}</strong><small>{nodeSummary(node)}</small></span></button>
    {node.kind === "space" && node.actionable ? <button type="button" className="tree-open"
      onClick={() => onOpenInSpaces(node)}>Open in Spaces</button> : null}
  </div>;
}

function TreeDetails({ node, projection, onOpenTerminal, onOpenInSpaces }: {
  node: WorldGraphNode; projection: HerdrGraphProjection;
  onOpenTerminal: () => void; onOpenInSpaces: () => void;
}) {
  const ancestry = ancestryLabels(node, projection);
  const leaf = node.kind === "agent" || node.kind === "terminal";
  return <section className="tree-details" aria-label="Selected Tree entity">
    <div className="tree-details-title"><NodeIcon node={node} /><div><strong>{node.label}</strong>
      <span>{kindLabel(node)} · {nodeSummary(node)}</span></div></div>
    <div className="tree-ancestry" aria-label="Ancestry">{ancestry.join(" → ")}</div>
    {node.taskSummary ? <p>{node.taskSummary}</p> : null}
    <dl><div><dt>Status</dt><dd>{displayStatus(node)}</dd></div>
      <div><dt>Connection</dt><dd>{node.connectionState}{node.stale ? " · stale" : ""}</dd></div>
      {node.stateLabel ? <div><dt>State</dt><dd>{node.stateLabel}</dd></div> : null}
      {node.modelLabel ? <div><dt>Agent</dt><dd>{node.modelLabel}</dd></div> : null}
    </dl>
    {node.actionable && node.kind !== "host" ? <div className="tree-details-actions">
      {leaf ? <button className="btn btn-primary" type="button" onClick={onOpenTerminal}>Open terminal</button> : null}
      <button className={leaf ? "btn" : "btn btn-primary"} type="button" onClick={onOpenInSpaces}>Open in Spaces</button>
    </div> : node.kind !== "host" ? <span className="tree-action-unavailable">Actions unavailable for this stale or disconnected entity</span> : null}
  </section>;
}

export function treeMatches(hosts: readonly WorldGraphHost[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const host of hosts) {
    if (host.node.searchText.includes(query)) {
      addWholeHost(matches, host);
      continue;
    }
    for (const space of host.spaces) {
      if (space.node.searchText.includes(query)) {
        matches.add(host.node.id); matches.add(space.node.id);
        for (const child of space.children) matches.add(child.id);
        continue;
      }
      for (const child of space.children) if (child.searchText.includes(query)) {
        matches.add(host.node.id); matches.add(space.node.id); matches.add(child.id);
      }
    }
  }
  return matches;
}

function addWholeHost(matches: Set<string>, host: WorldGraphHost) {
  matches.add(host.node.id);
  for (const space of host.spaces) {
    matches.add(space.node.id);
    for (const child of space.children) matches.add(child.id);
  }
}
function shownSpaces(host: WorldGraphHost, matches: ReadonlySet<string> | null, active: boolean) {
  return active ? host.spaces.filter(({ node }) => matches?.has(node.id)) : host.spaces;
}
function shownChildren(space: WorldGraphSpace, matches: ReadonlySet<string> | null, active: boolean) {
  return active ? space.children.filter(({ id }) => matches?.has(id)) : space.children;
}
function ancestryLabels(node: WorldGraphNode, projection: HerdrGraphProjection) {
  if (node.kind === "host") return [node.label];
  if (node.kind === "space") return [node.hostLabel, node.label];
  const parent = projection.nodes.find(({ id }) => id === node.parentId);
  return [node.hostLabel, parent?.label ?? "Space", node.label];
}
function displayStatus(node: WorldGraphNode) { return node.disconnected ? "disconnected" : node.status; }
function kindLabel(node: WorldGraphNode) { return node.kind[0]?.toUpperCase() + node.kind.slice(1); }
function nodeSummary(node: WorldGraphNode) {
  return [displayStatus(node), node.stale ? "stale" : null, node.focused ? "focused" : null,
    node.kind === "host" ? node.connectionState : null,
    node.kind === "agent" ? "agent" : node.kind === "terminal" ? "empty terminal" : null,
    node.stateLabel, node.modelLabel, node.taskSummary].filter(Boolean).join(" · ");
}
function NodeIcon({ node }: { node: WorldGraphNode }) {
  if (node.kind === "host") return <Server size={17} aria-hidden="true" />;
  if (node.kind === "space") return <GitFork size={17} aria-hidden="true" />;
  if (node.agentKind) return <span aria-hidden="true"><AgentIcon kind={node.agentKind} /></span>;
  return node.kind === "agent" ? <Bot size={17} aria-hidden="true" /> : <SquareTerminal size={17} aria-hidden="true" />;
}
function clampZoom(value: number) { return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value)); }
