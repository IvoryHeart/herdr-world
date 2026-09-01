import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelLeft,
  Search,
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
import { GraphCanvas } from "./GraphCanvas";
import type { GraphCanvasHandle, GraphConversationTarget } from "./GraphCanvas";
import { useWorldConversationLayout } from "../WorldConversationLayer";
import type { WorldGraphNode, WorldGraphSpace } from "./herdrGraphProjection";
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
import { isWorldThemeContext } from "../worldThemeContext";
import type { WorldThemeContext } from "../worldThemeContext";

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
  const [collapsedIds, setCollapsedIds] = useState(
    () => new Set(initialPrefs.collapsedIds),
  );
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

  const matches = useMemo(
    () => graphMatches(projection.spaces, query),
    [projection.spaces, query],
  );
  const visibleSpaces = useMemo(
    () => query.trim()
      ? projection.spaces.filter(({ node, terminals }) =>
          matches?.has(node.id) || terminals.some(({ id }) => matches?.has(id)),
        )
      : projection.spaces,
    [matches, projection.spaces, query],
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

  const toggleCollapse = useCallback((spaceId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(spaceId)) next.delete(spaceId);
      else next.add(spaceId);
      collapsedIdsRef.current = next;
      schedulePrefsWrite({
        ...prefsRef.current,
        collapsedIds: [...next],
      });
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
          <span>{projection.coverage.presentedSpaces} spaces · {projection.coverage.presentedTerminals} terminals</span>
        </div>
        <label className="graph-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Search Graph</span>
          <input
            type="search"
            value={query}
            placeholder="Search spaces and terminals"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div className="graph-zoom-controls" role="group" aria-label="Graph zoom controls">
          <button
            className="icon-btn graph-zoom-button"
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => canvasRef.current?.zoomOut()}
          >
            <ZoomOut size={16} aria-hidden="true" />
          </button>
          <button
            className="icon-btn graph-zoom-button"
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => canvasRef.current?.zoomIn()}
          >
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
            Double-click a terminal to open it · drag nodes to pin · use zoom controls or scroll
          </div>
          {projection.omittedSpaceCount > 0 ? (
            <div className="graph-overflow-badge">
              +{projection.omittedSpaceCount} spaces outside presentation bound
            </div>
          ) : null}
        </div>
        <aside className="graph-semantic" aria-label="Graph semantic view">
          <div className="graph-semantic-head">
            <div>
              <strong>Projects and spaces</strong>
              <span aria-live="polite">
                {query.trim() ? `${visibleSpaces.length} matching spaces` : `${projection.spaces.length} presented spaces`}
              </span>
            </div>
          </div>
          {selectedNode ? (
            <GraphDetails
              node={selectedNode}
              onOpenTerminal={() => context.onGraphOpenTerminal(selectedNode)}
              onOpenInSpaces={() => context.onGraphOpenInSpaces(selectedNode)}
            />
          ) : (
            <p className="graph-details-empty">Select a space or terminal to inspect it.</p>
          )}
          <ul className="graph-tree" aria-label="Presented projects, spaces, and terminals">
            {visibleSpaces.map((space) => (
              <GraphSemanticSpace
                key={space.node.id}
                space={space}
                collapsed={collapsedIds.has(space.node.id)}
                selectedKey={context.selectedKey}
                matches={matches}
                queryActive={Boolean(query.trim())}
                onToggle={() => toggleCollapse(space.node.id)}
                onSelect={(node) => context.onGraphSelect(node.selectionKey, node.hostKey)}
                onOpenTerminal={context.onGraphOpenTerminal}
                onOpenInSpaces={context.onGraphOpenInSpaces}
                setButtonRef={setSemanticButtonRef}
              />
            ))}
          </ul>
          {visibleSpaces.length === 0 ? (
            <p className="graph-empty">No presented spaces match this search.</p>
          ) : null}
          {projection.omittedSpaceCount > 0 ? (
            <p className="graph-semantic-overflow">
              {projection.omittedSpaceCount} additional {plural(projection.omittedSpaceCount, "space", "spaces")} omitted by the 128-space presentation bound.
            </p>
          ) : null}
          {context.handoffStatus ? (
            <p className="world-handoff-status" role="status">{context.handoffStatus}</p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function GraphSemanticSpace({
  space,
  collapsed,
  selectedKey,
  matches,
  queryActive,
  onToggle,
  onSelect,
  onOpenTerminal,
  onOpenInSpaces,
  setButtonRef,
}: {
  space: WorldGraphSpace;
  collapsed: boolean;
  selectedKey: string | null;
  matches: ReadonlySet<string> | null;
  queryActive: boolean;
  onToggle: () => void;
  onSelect: (node: WorldGraphNode) => void;
  onOpenTerminal: (node: WorldGraphNode) => void;
  onOpenInSpaces: (node: WorldGraphNode) => void;
  setButtonRef: (selectionKey: string, node: HTMLButtonElement | null) => void;
}) {
  const shownTerminals = queryActive
    ? space.terminals.filter(({ id }) => matches?.has(id))
    : space.terminals;
  return (
    <li className="graph-tree-space" data-status={displayStatus(space.node)}>
      <div className="graph-tree-row">
        <button
          className="graph-collapse"
          type="button"
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${space.node.label}`}
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <button
          ref={(node) => setButtonRef(space.node.selectionKey, node)}
          className="graph-tree-select"
          type="button"
          aria-pressed={selectedKey === space.node.selectionKey}
          onClick={() => onSelect(space.node)}
        >
          <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(space.node)}</span>
          <span>
            <strong>{space.node.label}</strong>
            <small>{nodeSummary(space.node)}</small>
          </span>
        </button>
        {space.node.actionable ? (
          <button className="graph-tree-open" type="button" onClick={() => onOpenInSpaces(space.node)}>
            Open in Spaces
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <ul aria-label={`Terminals in ${space.node.label}`}>
          {shownTerminals.map((terminal) => (
            <li key={terminal.id} data-status={displayStatus(terminal)}>
              <button
                ref={(node) => setButtonRef(terminal.selectionKey, node)}
                className="graph-tree-select graph-tree-terminal"
                type="button"
                aria-pressed={selectedKey === terminal.selectionKey}
                aria-label={`${terminal.label}, ${terminal.agentRunning ? "agent terminal" : "empty shell"}: ${nodeSummary(terminal)}. Double-click to open terminal.`}
                onClick={() => onSelect(terminal)}
                onDoubleClick={() => terminal.actionable && onOpenTerminal(terminal)}
              >
                <GraphTerminalIdentity node={terminal} />
                <span>
                  <strong>{terminal.label}</strong>
                  <small>{nodeSummary(terminal)}</small>
                </span>
              </button>
              {terminal.actionable ? (
                <span className="graph-tree-actions">
                  <button className="graph-tree-open" type="button" onClick={() => onOpenTerminal(terminal)}>
                    Open terminal
                  </button>
                  <button className="graph-tree-open" type="button" onClick={() => onOpenInSpaces(terminal)}>
                    Open in Spaces
                  </button>
                </span>
              ) : null}
            </li>
          ))}
          {space.terminals.length === 0 ? <li className="graph-tree-empty">No attached terminals</li> : null}
          {space.omittedTerminalCount > 0 ? (
            <li className="graph-tree-overflow">
              {space.omittedTerminalCount} additional {plural(space.omittedTerminalCount, "terminal", "terminals")} omitted by the per-space bound.
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
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
  return (
    <section className="graph-details" aria-label="Selected Graph entity">
      <div>
        {node.kind === "terminal"
          ? <GraphTerminalIdentity node={node} />
          : <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(node)}</span>}
        <div>
          <strong>{node.label}</strong>
          <span>{node.kind === "space" ? "Space" : node.agentRunning ? "Agent terminal" : "Empty shell"} · {nodeSummary(node)}</span>
        </div>
      </div>
      {node.taskSummary ? <p>{node.taskSummary}</p> : null}
      <dl>
        <div><dt>Host</dt><dd>{node.hostLabel}</dd></div>
        <div><dt>Status</dt><dd>{displayStatus(node)}</dd></div>
        {node.stale ? (
          <div><dt>Snapshot</dt><dd>{connectionSummary(node)}</dd></div>
        ) : null}
        {node.subtitle ? <div><dt>Project</dt><dd>{node.subtitle}</dd></div> : null}
        {node.modelLabel ? <div><dt>Agent</dt><dd>{node.modelLabel}</dd></div> : null}
      </dl>
      {node.actionable ? (
        <div className="graph-details-actions">
          {node.kind === "terminal" ? (
            <button className="btn btn-primary" type="button" onClick={onOpenTerminal}>Open terminal</button>
          ) : null}
          <button className={node.kind === "space" ? "btn btn-primary" : "btn"} type="button" onClick={onOpenInSpaces}>Open in Spaces</button>
        </div>
      ) : (
        <span className="graph-action-unavailable">Open in Spaces unavailable</span>
      )}
    </section>
  );
}

function GraphTerminalIdentity({ node }: { node: WorldGraphNode }) {
  return (
    <span
      className="graph-terminal-identity"
      data-agent-kind={node.agentKind ?? (node.agentRunning ? "unknown" : "shell")}
      title={node.agentRunning ? node.modelLabel ?? node.label : "Empty shell"}
      aria-hidden="true"
    >
      {node.agentKind
        ? <AgentIcon kind={node.agentKind} />
        : node.agentRunning
          ? <Bot size={16} />
          : <SquareTerminal size={16} />}
      <span className="graph-terminal-status">{statusSymbol(node)}</span>
    </span>
  );
}

export function graphMatches(spaces: readonly WorldGraphSpace[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const space of spaces) {
    if (space.node.searchText.includes(query)) {
      matches.add(space.node.id);
      for (const terminal of space.terminals) matches.add(terminal.id);
      continue;
    }
    for (const terminal of space.terminals) {
      if (terminal.searchText.includes(query)) {
        matches.add(space.node.id);
        matches.add(terminal.id);
      }
    }
  }
  return matches;
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
  if (node.kind === "space") parts.push(node.hostLabel, node.subtitle ?? null);
  else parts.push(
    node.agentRunning ? "agent running" : "empty shell",
    node.stateLabel ?? null,
    node.modelLabel ?? null,
  );
  return parts.filter(Boolean).join(" · ");
}

function connectionSummary(node: WorldGraphNode) {
  return `${node.connectionState} · stale`;
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}
