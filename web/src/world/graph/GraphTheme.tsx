import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  PanelLeft,
  Search,
  SquareTerminal,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import { AgentIcon } from "../../AgentIcon";
import type { SurfaceComponentProps } from "../../surfaceRegistry";
import { GraphCanvas } from "./GraphCanvas";
import type { GraphCanvasHandle, GraphConversationTarget } from "./GraphCanvas";
import type { WorldConversationBubblePanel } from "../WorldSurface";
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
  const [conversationTargets, setConversationTargets] = useState<GraphConversationTarget[]>([]);
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
            onSelect={selectFromCanvas}
            onActivate={context.onGraphOpenTerminal}
            onToggleCollapse={toggleCollapse}
            onViewChange={updateViewPrefs}
          />
          <div className="graph-visual-help">
            Double-click a terminal to open it · drag nodes to pin · scroll to zoom
          </div>
          {projection.omittedSpaceCount > 0 ? (
            <div className="graph-overflow-badge">
              +{projection.omittedSpaceCount} spaces outside presentation bound
            </div>
          ) : null}
          <GraphConversationLayer
            visualRef={visualRef}
            panels={context.conversationBubbles}
            compact={context.compact}
            onFocus={context.onFocusConversation}
            onClose={context.onCloseConversation}
            onTargetsChange={setConversationTargets}
          />
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
                aria-label={`${terminal.label}, ${terminal.agentRunning ? "agent terminal" : "empty shell"}. Double-click to open terminal.`}
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

function GraphConversationLayer({
  visualRef,
  panels,
  compact,
  onFocus,
  onClose,
  onTargetsChange,
}: {
  visualRef: RefObject<HTMLDivElement | null>;
  panels: readonly WorldConversationBubblePanel[];
  compact: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onTargetsChange: (targets: GraphConversationTarget[]) => void;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const lastMeasurementRef = useRef("");
  const measureRef = useRef<() => void>(() => {});
  const interactionRef = useRef<{
    id: string;
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [movingId, setMovingId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    if (panels.length === 0) {
      if (lastMeasurementRef.current !== "") {
        lastMeasurementRef.current = "";
        onTargetsChange([]);
      }
      return;
    }
    const measure = () => {
      const visualRect = visual.getBoundingClientRect();
      const targets = panels.flatMap((panel): GraphConversationTarget[] => {
        const element = refs.current.get(panel.id);
        const selectionKey = panel.selectedKey ?? panel.targetKey;
        if (!element || !selectionKey) return [];
        const rect = element.getBoundingClientRect();
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
      const measurement = JSON.stringify(targets);
      if (measurement === lastMeasurementRef.current) return;
      lastMeasurementRef.current = measurement;
      onTargetsChange(targets);
    };
    measureRef.current = measure;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (window.__HERDR_GRAPH_RENDERER__) {
      window.__HERDR_GRAPH_RENDERER__.activeConversationObservers += 1;
    }
    observer.observe(visual);
    for (const panel of panels) {
      const element = refs.current.get(panel.id);
      if (element) observer.observe(element);
    }
    return () => {
      measureRef.current = () => {};
      observer.disconnect();
      if (window.__HERDR_GRAPH_RENDERER__) {
        window.__HERDR_GRAPH_RENDERER__.activeConversationObservers -= 1;
      }
    };
  }, [onTargetsChange, panels, visualRef]);

  useLayoutEffect(() => measureRef.current(), [offsets]);

  const movePanel = (id: string, requestedX: number, requestedY: number) => {
    const visual = visualRef.current;
    const panel = refs.current.get(id);
    if (!visual || !panel) return;
    const visualRect = visual.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const deltaX = Math.max(
      visualRect.left - panelRect.left,
      Math.min(visualRect.right - panelRect.right, requestedX),
    );
    const deltaY = Math.max(
      visualRect.top - panelRect.top,
      Math.min(visualRect.bottom - panelRect.bottom, requestedY),
    );
    if (deltaX === 0 && deltaY === 0) return;
    setOffsets((current) => {
      const offset = current[id] ?? { x: 0, y: 0 };
      return { ...current, [id]: { x: offset.x + deltaX, y: offset.y + deltaY } };
    });
  };

  const beginMove = (panel: WorldConversationBubblePanel, event: ReactPointerEvent<HTMLDivElement>) => {
    onFocus(panel.id);
    const target = event.target instanceof Element ? event.target : null;
    if (
      event.button !== 0 ||
      !target?.closest(".world-conversation-header") ||
      target.closest("button, a, input, textarea, select")
    ) {
      return;
    }
    interactionRef.current = {
      id: panel.id,
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
    setMovingId(panel.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const continueMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - interaction.lastX;
    const deltaY = event.clientY - interaction.lastY;
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    movePanel(interaction.id, deltaX, deltaY);
  };

  const endMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    setMovingId(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const moveWithKeyboard = (
    panel: WorldConversationBubblePanel,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".world-conversation-header")) return;
    const step = event.shiftKey ? 48 : 16;
    const deltaX = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    const deltaY = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
    if (deltaX === 0 && deltaY === 0) return;
    event.preventDefault();
    movePanel(panel.id, deltaX, deltaY);
  };

  return panels.map((panel, index) => (
    <div
      key={panel.id}
      ref={(element) => {
        if (element) refs.current.set(panel.id, element);
        else refs.current.delete(panel.id);
      }}
      className="world-conversation-slot graph-conversation-slot"
      data-window-id={panel.id}
      data-positioned="true"
      data-active={index === panels.length - 1 ? "true" : undefined}
      data-interaction={movingId === panel.id ? "moving" : undefined}
      aria-busy={movingId === panel.id}
      style={{
        zIndex: 20 + index,
        "--graph-conversation-index": index,
        transform: `translate(${offsets[panel.id]?.x ?? 0}px, ${offsets[panel.id]?.y ?? 0}px)`,
      } as CSSProperties}
      onPointerDown={(event) => beginMove(panel, event)}
      onPointerMove={continueMove}
      onPointerUp={endMove}
      onPointerCancel={endMove}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          index === panels.length - 1 &&
          !(event.target instanceof Element && event.target.closest(".world-conversation-terminal"))
        ) {
          event.preventDefault();
          onClose(panel.id);
          return;
        }
        moveWithKeyboard(panel, event);
      }}
      data-compact={compact ? "true" : undefined}
    >
      {panel.content}
    </div>
  ));
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
  else parts.push(
    node.agentRunning ? "agent running" : "empty shell",
    node.stateLabel ?? null,
    node.modelLabel ?? null,
  );
  return parts.filter(Boolean).join(" · ");
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}
