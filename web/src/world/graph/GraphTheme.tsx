import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelLeft,
  Search,
  Server,
  SquareTerminal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AgentIcon } from "../../AgentIcon";
import type { SurfaceComponentProps } from "../../surfaceRegistry";
import { useWorldConversationLayout } from "../WorldConversationLayer";
import { isWorldThemeContext } from "../worldThemeContext";
import type { WorldThemeContext } from "../worldThemeContext";
import { GraphCanvas } from "./GraphCanvas";
import type { GraphCanvasHandle, GraphConversationTarget } from "./GraphCanvas";
import {
  readInitialGraphViewPrefs,
  writeGraphViewPrefs,
} from "./graphViewPrefs";
import type {
  GraphCamera,
  GraphCameraMode,
  GraphViewPrefs,
  SavedGraphPosition,
} from "./graphViewPrefs";
import type {
  WorldGraphHost,
  WorldGraphNode,
  WorldGraphSpace,
} from "./herdrGraphProjection";

export default function GraphTheme({ context: value }: SurfaceComponentProps) {
  if (!isWorldThemeContext(value)) {
    return (
      <div className="surface-unavailable" role="alert">
        <strong>Graph unavailable</strong>
        <span>The shared World context is not ready.</span>
      </div>
    );
  }
  return <GraphStage context={value} />;
}

function GraphStage({ context }: { context: WorldThemeContext }) {
  const projection = context.graphProjection;
  const [initialView] = useState(readInitialGraphViewPrefs);
  const { prefs: initialPrefs, fitOnMount } = initialView;
  const [collapsedIds, setCollapsedIds] = useState(() => new Set(initialPrefs.collapsedIds));
  const [query, setQuery] = useState("");
  const [conversationTargets, setConversationTargets] = useState<GraphConversationTarget[]>([]);
  const { rects: conversationRects } = useWorldConversationLayout();
  const conversationPanelsRef = useRef(context.conversationBubbles);
  conversationPanelsRef.current = context.conversationBubbles;
  const conversationPanelTargetsKey = context.conversationBubbles.map((panel) =>
    `${panel.id}:${panel.selectedKey ?? panel.targetKey}`
  ).join("|");
  const conversationTargetSignatureRef = useRef("");
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const semanticButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const focusSelectionRef = useRef<string | null>(null);
  const prefsRef = useRef<GraphViewPrefs>(initialPrefs);
  const persistTimerRef = useRef<number | null>(null);
  const collapsedIdsRef = useRef(collapsedIds);

  const schedulePrefsWrite = useCallback((next: GraphViewPrefs) => {
    prefsRef.current = next;
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      writeGraphViewPrefs(prefsRef.current);
    }, 120);
  }, []);

  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    writeGraphViewPrefs(prefsRef.current);
  }, []);

  const matches = useMemo(() => graphMatches(projection.hosts, query), [projection.hosts, query]);
  const visibleHosts = useMemo(
    () => query.trim()
      ? projection.hosts.filter(({ node }) => matches?.has(node.id))
      : projection.hosts,
    [matches, projection.hosts, query],
  );
  const selectedNode = projection.nodes.find(
    ({ selectionKey }) => selectionKey === context.selectedKey,
  ) ?? null;

  useEffect(() => {
    const selectionKey = focusSelectionRef.current;
    if (!selectionKey || context.selectedKey !== selectionKey) return;
    focusSelectionRef.current = null;
    semanticButtonsRef.current.get(selectionKey)?.focus();
  }, [context.selectedKey]);

  const selectFromCanvas = useCallback((selectionKey: string, hostKey: string) => {
    focusSelectionRef.current = selectionKey;
    context.onGraphSelect(selectionKey, hostKey);
  }, [context]);

  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      collapsedIdsRef.current = next;
      schedulePrefsWrite({ ...prefsRef.current, collapsedIds: [...next] });
      return next;
    });
  }, [schedulePrefsWrite]);

  const updateViewPrefs = useCallback((
    camera: GraphCamera,
    positions: Record<string, SavedGraphPosition>,
    cameraMode: GraphCameraMode,
  ) => {
    schedulePrefsWrite({
      camera,
      cameraMode,
      positions,
      collapsedIds: [...collapsedIdsRef.current],
    });
  }, [schedulePrefsWrite]);

  const setSemanticButtonRef = (selectionKey: string, node: HTMLButtonElement | null) => {
    if (node) semanticButtonsRef.current.set(selectionKey, node);
    else semanticButtonsRef.current.delete(selectionKey);
  };

  useLayoutEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    const visualRect = visual.getBoundingClientRect();
    const targets = conversationPanelsRef.current.flatMap((panel): GraphConversationTarget[] => {
      const rect = conversationRects[panel.id];
      const selectionKey = panel.selectedKey ?? panel.targetKey;
      if (!rect || !selectionKey) return [];
      return [{
        id: panel.id,
        selectionKey,
        rect: {
          left: rect.left - visualRect.left,
          top: rect.top - visualRect.top,
          right: rect.right - visualRect.left,
          bottom: rect.bottom - visualRect.top,
        },
      }];
    });
    const signature = JSON.stringify(targets);
    if (signature === conversationTargetSignatureRef.current) return;
    conversationTargetSignatureRef.current = signature;
    setConversationTargets(targets);
  }, [conversationPanelTargetsKey, conversationRects]);

  const overflowCount = projection.omittedHostCount +
    projection.omittedSpaceCount +
    projection.coverage.omittedTerminals;
  return (
    <div className="graph-stage-shell">
      <header className="graph-stage-bar">
        <button
          className="icon-btn"
          type="button"
          aria-label={context.compact ? "Back to Herdr sidebar" : "Toggle sidebar"}
          title={context.compact ? "Back" : "Toggle sidebar"}
          onClick={context.compact ? context.onBackToSidebar : context.onToggleSidebar}
        >
          {context.compact ? <ChevronLeft size={20} /> : <PanelLeft size={18} />}
        </button>
        <div className="graph-stage-heading">
          <strong>World Graph</strong>
          <span>
            {projection.coverage.presentedHosts} {plural(projection.coverage.presentedHosts, "host", "hosts")} · {projection.coverage.presentedSpaces} {plural(projection.coverage.presentedSpaces, "space", "spaces")} · {projection.coverage.presentedAgents} {plural(projection.coverage.presentedAgents, "agent", "agents")} · {projection.coverage.presentedShells} {plural(projection.coverage.presentedShells, "terminal", "terminals")}
          </span>
        </div>
        <label className="graph-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Search Graph</span>
          <input
            type="search"
            value={query}
            placeholder="Search hosts, spaces, agents"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div className="graph-zoom-controls" role="group" aria-label="Graph zoom controls">
          <button className="icon-btn graph-zoom-button" type="button" aria-label="Zoom out" title="Zoom out" onClick={() => canvasRef.current?.zoomOut()}>
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <button className="icon-btn graph-zoom-button" type="button" aria-label="Zoom in" title="Zoom in" onClick={() => canvasRef.current?.zoomIn()}>
            <ZoomIn size={16} aria-hidden="true" />
          </button>
        </div>
        <button className="btn graph-fit" type="button" onClick={() => canvasRef.current?.fit()}>
          <Maximize2 size={14} aria-hidden="true" />
          Fit graph
        </button>
      </header>
      <div className="graph-content">
        <div ref={visualRef} className="graph-visual" aria-label="Interactive World graph">
          <GraphCanvas
            ref={canvasRef}
            projection={projection}
            collapsedIds={collapsedIds}
            selectedKey={context.selectedKey}
            matchedIds={matches}
            conversationTargets={conversationTargets}
            initialPrefs={initialPrefs}
            fitOnMount={fitOnMount}
            onSelect={selectFromCanvas}
            onActivate={context.onGraphOpenTerminal}
            onToggleCollapse={toggleCollapse}
            onViewChange={updateViewPrefs}
          />
          <div className="graph-visual-help">
            Double-click an agent or terminal to open it · drag nodes to pin · use zoom controls or scroll
          </div>
          {overflowCount > 0 ? (
            <div className="graph-overflow-badge">+{overflowCount} nodes outside presentation bounds</div>
          ) : null}
        </div>
        <aside className="graph-semantic" aria-label="Graph semantic view">
          <div className="graph-semantic-head">
            <div>
              <strong>Hosts and spaces</strong>
              <span aria-live="polite">
                {query.trim()
                  ? `${visibleHosts.length} matching ${plural(visibleHosts.length, "host", "hosts")}`
                  : `${projection.hosts.length} presented ${plural(projection.hosts.length, "host", "hosts")}`}
              </span>
            </div>
          </div>
          <div className="graph-details-slot">
            {selectedNode ? (
              <GraphDetails
                node={selectedNode}
                onOpenTerminal={() => context.onGraphOpenTerminal(selectedNode)}
                onOpenInSpaces={() => context.onGraphOpenInSpaces(selectedNode)}
              />
            ) : (
              <p className="graph-details-empty">Select a host, space, agent, or terminal to inspect it.</p>
            )}
          </div>
          <ul className="graph-tree" aria-label="Presented hosts, spaces, agents, and terminals">
            {visibleHosts.map((host) => (
              <GraphSemanticHost
                key={host.node.id}
                host={host}
                collapsedIds={collapsedIds}
                selectedKey={context.selectedKey}
                matches={matches}
                queryActive={Boolean(query.trim())}
                onToggle={toggleCollapse}
                onSelect={(node) => context.onGraphSelect(node.selectionKey, node.hostKey)}
                onOpenTerminal={context.onGraphOpenTerminal}
                onOpenInSpaces={context.onGraphOpenInSpaces}
                setButtonRef={setSemanticButtonRef}
              />
            ))}
          </ul>
          {visibleHosts.length === 0 ? <p className="graph-empty">No presented hosts match this search.</p> : null}
          {projection.omittedHostCount > 0 ? (
            <p className="graph-semantic-overflow">
              {projection.omittedHostCount} additional {plural(projection.omittedHostCount, "host", "hosts")} omitted by the 128-host presentation bound.
            </p>
          ) : null}
          {projection.omittedSpaceCount > 0 ? (
            <p className="graph-semantic-overflow">
              {projection.omittedSpaceCount} additional {plural(projection.omittedSpaceCount, "space", "spaces")} omitted by the 128-space presentation bound.
            </p>
          ) : null}
          {context.handoffStatus ? <p className="world-handoff-status" role="status">{context.handoffStatus}</p> : null}
        </aside>
      </div>
    </div>
  );
}

type SemanticTreeProps = {
  collapsedIds: ReadonlySet<string>;
  selectedKey: string | null;
  matches: ReadonlySet<string> | null;
  queryActive: boolean;
  onToggle: (nodeId: string) => void;
  onSelect: (node: WorldGraphNode) => void;
  onOpenTerminal: (node: WorldGraphNode) => void;
  onOpenInSpaces: (node: WorldGraphNode) => void;
  setButtonRef: (selectionKey: string, node: HTMLButtonElement | null) => void;
};

function GraphSemanticHost({ host, ...props }: { host: WorldGraphHost } & SemanticTreeProps) {
  const collapsed = props.collapsedIds.has(host.node.id);
  const shownSpaces = props.queryActive
    ? host.spaces.filter(({ node }) => props.matches?.has(node.id))
    : host.spaces;
  return (
    <li className="graph-tree-space" data-status={displayStatus(host.node)}>
      <GraphParentRow
        node={host.node}
        collapsed={collapsed}
        selectedKey={props.selectedKey}
        onToggle={() => props.onToggle(host.node.id)}
        onSelect={props.onSelect}
        setButtonRef={props.setButtonRef}
        icon={<Server size={15} aria-hidden="true" />}
      />
      {!collapsed ? (
        <ul aria-label={`Spaces on ${host.node.label}`}>
          {shownSpaces.map((space) => <GraphSemanticSpace key={space.node.id} space={space} {...props} />)}
          {host.spaces.length === 0 ? <li className="graph-tree-empty">No observed spaces</li> : null}
          {host.omittedSpaceCount > 0 ? (
            <li className="graph-tree-overflow">{host.omittedSpaceCount} additional spaces omitted by the presentation bound.</li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function GraphSemanticSpace({ space, ...props }: { space: WorldGraphSpace } & SemanticTreeProps) {
  const collapsed = props.collapsedIds.has(space.node.id);
  const shownChildren = props.queryActive
    ? space.children.filter(({ id }) => props.matches?.has(id))
    : space.children;
  return (
    <li className="graph-tree-space" data-status={displayStatus(space.node)}>
      <GraphParentRow
        node={space.node}
        collapsed={collapsed}
        selectedKey={props.selectedKey}
        onToggle={() => props.onToggle(space.node.id)}
        onSelect={props.onSelect}
        onOpenInSpaces={() => props.onOpenInSpaces(space.node)}
        setButtonRef={props.setButtonRef}
      />
      {!collapsed ? (
        <ul aria-label={`Agents and terminals in ${space.node.label}`}>
          {shownChildren.map((child) => (
            <li key={child.id} data-status={displayStatus(child)}>
              <button
                ref={(node) => props.setButtonRef(child.selectionKey, node)}
                className="graph-tree-select graph-tree-terminal"
                type="button"
                aria-pressed={props.selectedKey === child.selectionKey}
                aria-label={`${child.label}, ${nodeKindLabel(child)}: ${nodeSummary(child)}. Double-click to open terminal.`}
                onClick={() => props.onSelect(child)}
                onDoubleClick={() => child.actionable && props.onOpenTerminal(child)}
              >
                <GraphTerminalIdentity node={child} />
                <span><strong>{child.label}</strong><small>{nodeSummary(child)}</small></span>
              </button>
              {child.actionable ? (
                <span className="graph-tree-actions">
                  <button className="graph-tree-open" type="button" onClick={() => props.onOpenTerminal(child)}>Open terminal</button>
                  <button className="graph-tree-open" type="button" onClick={() => props.onOpenInSpaces(child)}>Open in Spaces</button>
                </span>
              ) : null}
            </li>
          ))}
          {space.children.length === 0 ? <li className="graph-tree-empty">No agents or terminals</li> : null}
          {space.omittedChildCount > 0 ? (
            <li className="graph-tree-overflow">
              {space.omittedChildCount} additional {plural(space.omittedChildCount, "child", "children")} omitted by the per-space bound.
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function GraphParentRow({
  node,
  collapsed,
  selectedKey,
  onToggle,
  onSelect,
  onOpenInSpaces,
  setButtonRef,
  icon,
}: {
  node: WorldGraphNode;
  collapsed: boolean;
  selectedKey: string | null;
  onToggle: () => void;
  onSelect: (node: WorldGraphNode) => void;
  onOpenInSpaces?: () => void;
  setButtonRef: (selectionKey: string, node: HTMLButtonElement | null) => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="graph-tree-row">
      <button className="graph-collapse" type="button" aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.label}`} aria-expanded={!collapsed} onClick={onToggle}>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      <button ref={(button) => setButtonRef(node.selectionKey, button)} className="graph-tree-select" type="button" aria-pressed={selectedKey === node.selectionKey} onClick={() => onSelect(node)}>
        {icon ?? <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(node)}</span>}
        <span><strong>{node.label}</strong><small>{nodeSummary(node)}</small></span>
      </button>
      {node.actionable && onOpenInSpaces ? (
        <button className="graph-tree-open" type="button" onClick={onOpenInSpaces}>Open in Spaces</button>
      ) : null}
    </div>
  );
}

function GraphDetails({
  node,
  onOpenTerminal,
  onOpenInSpaces,
}: {
  node: WorldGraphNode;
  onOpenTerminal: () => void;
  onOpenInSpaces: () => void;
}) {
  const leaf = node.kind === "agent" || node.kind === "terminal";
  return (
    <section className="graph-details" aria-label="Selected Graph entity">
      <div>
        {leaf
          ? <GraphTerminalIdentity node={node} />
          : node.kind === "host"
            ? <Server size={17} aria-hidden="true" />
            : <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(node)}</span>}
        <div><strong>{node.label}</strong><span>{nodeKindLabel(node)} · {nodeSummary(node)}</span></div>
      </div>
      {node.taskSummary ? <p>{node.taskSummary}</p> : null}
      <dl>
        {node.kind !== "host" ? <div><dt>Host</dt><dd>{node.hostLabel}</dd></div> : null}
        <div><dt>Status</dt><dd>{displayStatus(node)}</dd></div>
        {node.kind === "host" ? <div><dt>Connection</dt><dd>{node.connectionState}</dd></div> : null}
        {node.stale ? <div><dt>Snapshot</dt><dd>{connectionSummary(node)}</dd></div> : null}
        {node.kind === "host" && node.subtitle ? <div><dt>Location</dt><dd>{node.subtitle}</dd></div> : null}
        {node.kind === "space" && node.subtitle ? <div><dt>Project</dt><dd>{node.subtitle}</dd></div> : null}
        {node.modelLabel ? <div><dt>Agent</dt><dd>{node.modelLabel}</dd></div> : null}
      </dl>
      {node.actionable ? (
        <div className="graph-details-actions">
          {leaf ? <button className="btn btn-primary" type="button" onClick={onOpenTerminal}>Open terminal</button> : null}
          <button className={node.kind === "space" ? "btn btn-primary" : "btn"} type="button" onClick={onOpenInSpaces}>Open in Spaces</button>
        </div>
      ) : node.kind !== "host" ? (
        <span className="graph-action-unavailable">Open in Spaces unavailable</span>
      ) : null}
    </section>
  );
}

function GraphTerminalIdentity({ node }: { node: WorldGraphNode }) {
  const agent = node.kind === "agent";
  return (
    <span className="graph-terminal-identity" data-agent-kind={node.agentKind ?? (agent ? "unknown" : "shell")} title={agent ? node.modelLabel ?? node.label : "Empty terminal"} aria-hidden="true">
      {node.agentKind
        ? <AgentIcon kind={node.agentKind} />
        : agent
          ? <Bot size={16} />
          : <SquareTerminal size={16} />}
      <span className="graph-terminal-status">{statusSymbol(node)}</span>
    </span>
  );
}

export function graphMatches(hosts: readonly WorldGraphHost[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const host of hosts) {
    if (host.node.searchText.includes(query)) {
      addHostTree(matches, host);
      continue;
    }
    for (const space of host.spaces) {
      if (space.node.searchText.includes(query)) {
        matches.add(host.node.id);
        matches.add(space.node.id);
        for (const child of space.children) matches.add(child.id);
        continue;
      }
      for (const child of space.children) {
        if (!child.searchText.includes(query)) continue;
        matches.add(host.node.id);
        matches.add(space.node.id);
        matches.add(child.id);
      }
    }
  }
  return matches;
}

function addHostTree(matches: Set<string>, host: WorldGraphHost) {
  matches.add(host.node.id);
  for (const space of host.spaces) {
    matches.add(space.node.id);
    for (const child of space.children) matches.add(child.id);
  }
}

function displayStatus(node: WorldGraphNode) {
  return node.disconnected ? "disconnected" : node.status;
}

function statusSymbol(node: WorldGraphNode) {
  if (node.stale) return "⏸";
  return node.status === "working" ? "▶"
    : node.status === "blocked" ? "!"
      : node.status === "done" ? "✓"
        : node.status === "idle" ? "○"
          : "?";
}

function nodeSummary(node: WorldGraphNode) {
  const parts = [
    displayStatus(node),
    node.stale ? connectionSummary(node) : null,
    node.focused ? "focused" : null,
  ];
  if (node.kind === "host") parts.push(node.connectionState, node.subtitle ?? null);
  else if (node.kind === "space") parts.push(node.hostLabel, node.subtitle ?? null);
  else parts.push(
    node.kind === "agent" ? "agent" : "empty terminal",
    node.stateLabel ?? null,
    node.modelLabel ?? null,
  );
  return parts.filter(Boolean).join(" · ");
}

function nodeKindLabel(node: WorldGraphNode) {
  return node.kind === "host" ? "Host"
    : node.kind === "space" ? "Space"
      : node.kind === "agent" ? "Agent"
        : "Terminal";
}

function connectionSummary(node: WorldGraphNode) {
  return `${node.connectionState} · stale`;
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}
