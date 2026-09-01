import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelLeft,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SurfaceComponentProps } from "../../surfaceRegistry";
import { GraphCanvas } from "./GraphCanvas";
import type { GraphCanvasHandle } from "./GraphCanvas";
import type { WorldGraphNode, WorldGraphSpace } from "./herdrGraphProjection";
import {
  readGraphViewPrefs,
  writeGraphViewPrefs,
} from "./graphViewPrefs";
import type { GraphCamera, GraphViewPrefs, SavedGraphPosition } from "./graphViewPrefs";
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
  const [initialPrefs] = useState(readGraphViewPrefs);
  const [collapsedIds, setCollapsedIds] = useState(
    () => new Set(initialPrefs.collapsedIds),
  );
  const [query, setQuery] = useState("");
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
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
      ? projection.spaces.filter(({ node, agents }) =>
          matches?.has(node.id) || agents.some(({ id }) => matches?.has(id)),
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
  ) => {
    schedulePrefsWrite({
      camera,
      positions,
      collapsedIds: [...collapsedIdsRef.current],
    });
  }, [schedulePrefsWrite]);

  const setSemanticButtonRef = (selectionKey: string, node: HTMLButtonElement | null) => {
    if (node) semanticButtonsRef.current.set(selectionKey, node);
    else semanticButtonsRef.current.delete(selectionKey);
  };

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
          <span>{projection.coverage.presentedSpaces} spaces · {projection.coverage.presentedAgents} agents</span>
        </div>
        <label className="graph-search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Search Graph</span>
          <input
            type="search"
            value={query}
            placeholder="Search spaces and agents"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <button className="btn graph-fit" type="button" onClick={() => canvasRef.current?.fit()}>
          <Maximize2 size={14} aria-hidden="true" />
          Fit graph
        </button>
      </header>
      <div className="graph-content">
        <div className="graph-visual" aria-label="Interactive World graph">
          <GraphCanvas
            ref={canvasRef}
            projection={projection}
            collapsedIds={collapsedIds}
            selectedKey={context.selectedKey}
            matchedIds={matches}
            initialPrefs={initialPrefs}
            onSelect={selectFromCanvas}
            onToggleCollapse={toggleCollapse}
            onViewChange={updateViewPrefs}
          />
          <div className="graph-visual-help">
            Drag nodes to pin · drag background to pan · scroll to zoom
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
              onOpen={() => selectedNode.handoff && context.onOpenInSpaces(selectedNode.handoff)}
            />
          ) : (
            <p className="graph-details-empty">Select a space or agent to inspect it.</p>
          )}
          <ul className="graph-tree" aria-label="Presented projects, spaces, and agents">
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
                onOpen={(node) => node.handoff && context.onOpenInSpaces(node.handoff)}
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
  onOpen,
  setButtonRef,
}: {
  space: WorldGraphSpace;
  collapsed: boolean;
  selectedKey: string | null;
  matches: ReadonlySet<string> | null;
  queryActive: boolean;
  onToggle: () => void;
  onSelect: (node: WorldGraphNode) => void;
  onOpen: (node: WorldGraphNode) => void;
  setButtonRef: (selectionKey: string, node: HTMLButtonElement | null) => void;
}) {
  const shownAgents = queryActive
    ? space.agents.filter(({ id }) => matches?.has(id))
    : space.agents;
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
          <button className="graph-tree-open" type="button" onClick={() => onOpen(space.node)}>
            Open in Spaces
          </button>
        ) : null}
      </div>
      {!collapsed ? (
        <ul aria-label={`Agents in ${space.node.label}`}>
          {shownAgents.map((agent) => (
            <li key={agent.id} data-status={displayStatus(agent)}>
              <button
                ref={(node) => setButtonRef(agent.selectionKey, node)}
                className="graph-tree-select graph-tree-agent"
                type="button"
                aria-pressed={selectedKey === agent.selectionKey}
                onClick={() => onSelect(agent)}
              >
                <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(agent)}</span>
                <span>
                  <strong>{agent.label}</strong>
                  <small>{nodeSummary(agent)}</small>
                </span>
              </button>
              {agent.actionable ? (
                <button className="graph-tree-open" type="button" onClick={() => onOpen(agent)}>
                  Open in Spaces
                </button>
              ) : null}
            </li>
          ))}
          {space.agents.length === 0 ? <li className="graph-tree-empty">No detected agents</li> : null}
          {space.omittedAgentCount > 0 ? (
            <li className="graph-tree-overflow">
              {space.omittedAgentCount} additional {plural(space.omittedAgentCount, "agent", "agents")} omitted by the per-space bound.
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function GraphDetails({ node, onOpen }: { node: WorldGraphNode; onOpen: () => void }) {
  return (
    <section className="graph-details" aria-label="Selected Graph entity">
      <div>
        <span className="graph-status-symbol" aria-hidden="true">{statusSymbol(node)}</span>
        <div>
          <strong>{node.label}</strong>
          <span>{node.kind === "space" ? "Space" : "Agent"} · {nodeSummary(node)}</span>
        </div>
      </div>
      {node.taskSummary ? <p>{node.taskSummary}</p> : null}
      <dl>
        <div><dt>Host</dt><dd>{node.hostLabel}</dd></div>
        <div><dt>Status</dt><dd>{displayStatus(node)}</dd></div>
        {node.subtitle ? <div><dt>Project</dt><dd>{node.subtitle}</dd></div> : null}
        {node.modelLabel ? <div><dt>Agent</dt><dd>{node.modelLabel}</dd></div> : null}
      </dl>
      {node.actionable ? (
        <button className="btn btn-primary" type="button" onClick={onOpen}>Open in Spaces</button>
      ) : (
        <span className="graph-action-unavailable">Open in Spaces unavailable</span>
      )}
    </section>
  );
}

export function graphMatches(spaces: readonly WorldGraphSpace[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const space of spaces) {
    if (space.node.searchText.includes(query)) {
      matches.add(space.node.id);
      for (const agent of space.agents) matches.add(agent.id);
      continue;
    }
    for (const agent of space.agents) {
      if (agent.searchText.includes(query)) {
        matches.add(space.node.id);
        matches.add(agent.id);
      }
    }
  }
  return matches;
}

function displayStatus(node: WorldGraphNode) {
  return node.stale ? "disconnected" : node.status;
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
  const parts = [displayStatus(node), node.focused ? "focused" : null];
  if (node.kind === "space") parts.push(node.hostLabel, node.subtitle ?? null);
  else parts.push(node.stateLabel ?? null, node.modelLabel ?? null);
  return parts.filter(Boolean).join(" · ");
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}
