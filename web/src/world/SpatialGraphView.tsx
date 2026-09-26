import {
  ChevronRight,
  Maximize2,
  Server,
  SquareTerminal,
  Waypoints,
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
import { createPortal } from "react-dom";
import { worldLocalStorage } from "../browserStorage";
import { AgentIcon } from "../components/AgentIcon";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
import { GraphCanvas } from "./graph/GraphCanvas";
import type { GraphCanvasHandle } from "./graph/GraphCanvas";
import {
  readGraphPreferences,
  writeGraphPreferences,
} from "./graph/graphPreferences";
import type {
  GraphCamera,
  GraphCameraMode,
  GraphPreferences,
  SavedGraphPosition,
} from "./graph/graphPreferences";
import {
  projectWorldGraph,
  type WorldGraphHost,
  type WorldGraphNode,
  type WorldGraphSpace,
} from "./graph/graphProjection";
import type { WorldObject } from "./worldObject";
import { WorldViewToolbar } from "./WorldViewToolbar";

export default function SpatialGraphView({
  world,
  toolbarPortal = null,
  selectedId,
  conversationNodeIds,
  onSelect,
  onOpenTerminal,
  onSelectedAnchorChange,
  onNodeAnchorsChange,
}: {
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  conversationNodeIds: readonly string[];
  onSelect(id: string): void;
  onOpenTerminal(id: string): Promise<void>;
  onSelectedAnchorChange(anchor: OfficeCanvasAnchor | null): void;
  onNodeAnchorsChange(anchors: Record<string, OfficeCanvasAnchor> | null): void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const projection = useMemo(
    () => projectWorldGraph(world, selectedId),
    [selectedId, world],
  );
  const [initialView] = useState(() => readGraphPreferences(worldLocalStorage));
  const { prefs: initialPrefs, fitOnMount } = initialView;
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(initialPrefs.collapsedIds),
  );
  const [query, setQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const prefsRef = useRef<GraphPreferences>(initialPrefs);
  const collapsedIdsRef = useRef(collapsedIds);
  const persistTimerRef = useRef<number | null>(null);
  const matches = useMemo(
    () => graphMatches(projection.hosts, query),
    [projection.hosts, query],
  );
  const searchActive = matches !== null;
  const effectiveCollapsedIds = useMemo(
    () => (searchActive ? new Set<string>() : collapsedIds),
    [collapsedIds, searchActive],
  );
  const visibleHosts = searchActive
    ? projection.hosts.filter(({ node }) => matches.has(node.id))
    : projection.hosts;
  const anchorNodeIds = useMemo(
    () => [
      ...new Set([...(selectedId ? [selectedId] : []), ...conversationNodeIds]),
    ],
    [conversationNodeIds, selectedId],
  );

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useLayoutEffect(() => {
    if (!compact) return;
    const root = rootRef.current;
    if (!root) return;
    let frame: number | null = null;
    const report = () => {
      frame = null;
      const wanted = new Set(anchorNodeIds);
      const anchors: Record<string, OfficeCanvasAnchor> = {};
      for (const element of root.querySelectorAll<HTMLElement>(
        "[data-graph-node-anchor]",
      )) {
        const id = element.dataset.graphNodeAnchor;
        if (!id || !wanted.has(id) || element.offsetParent === null) continue;
        anchors[id] = graphElementAnchor(element, root);
      }
      onNodeAnchorsChange(anchors);
      onSelectedAnchorChange(selectedId ? (anchors[selectedId] ?? null) : null);
    };
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(report);
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
      onSelectedAnchorChange(null);
      onNodeAnchorsChange(null);
    };
  }, [
    anchorNodeIds,
    collapsedIds,
    compact,
    matches,
    onNodeAnchorsChange,
    onSelectedAnchorChange,
    selectedId,
  ]);

  const schedulePrefsWrite = useCallback((next: GraphPreferences) => {
    prefsRef.current = next;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      writeGraphPreferences(worldLocalStorage, prefsRef.current);
    }, 120);
  }, []);

  useEffect(
    () => () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      writeGraphPreferences(worldLocalStorage, prefsRef.current);
      onSelectedAnchorChange(null);
      onNodeAnchorsChange(null);
    },
    [onNodeAnchorsChange, onSelectedAnchorChange],
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      if (searchActive) return;
      setCollapsedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        collapsedIdsRef.current = next;
        schedulePrefsWrite({
          ...prefsRef.current,
          collapsedIds: [...next],
        });
        return next;
      });
    },
    [schedulePrefsWrite, searchActive],
  );

  const updateView = useCallback(
    (
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
    },
    [schedulePrefsWrite],
  );

  const publishAnchors = useCallback(
    (anchors: Record<string, OfficeCanvasAnchor> | null) => {
      onNodeAnchorsChange(anchors);
      onSelectedAnchorChange(
        selectedId && anchors ? (anchors[selectedId] ?? null) : null,
      );
    },
    [onNodeAnchorsChange, onSelectedAnchorChange, selectedId],
  );

  const runAction = useCallback((action: () => Promise<void>) => {
    setActionError(null);
    void action().catch((cause) => {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    });
  }, []);

  const activateNode = useCallback(
    (node: WorldGraphNode) => {
      runAction(() => onOpenTerminal(node.id));
    },
    [onOpenTerminal, runAction],
  );

  if (!world.hosts.length) {
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );
  }

  const overflowCount =
    projection.omittedHostCount +
    projection.omittedSpaceCount +
    projection.coverage.omittedTerminals;
  const toolbar = (
    <WorldViewToolbar
      viewLabel="Graph"
      query={query}
      onQueryChange={setQuery}
      resultLabel={
        searchActive
          ? visibleHosts.length
            ? `${matches?.size ?? 0} matching items`
            : "No matches"
          : undefined
      }
    >
      <div
        className="world-spatial-graph-zoom"
        role="group"
        aria-label="Graph zoom controls"
      >
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => canvasRef.current?.zoomOut()}
        >
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => canvasRef.current?.zoomIn()}
        >
          <ZoomIn size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="world-spatial-graph-fit"
          title="Fit graph"
          onClick={() => canvasRef.current?.fit()}
        >
          <Maximize2 size={15} aria-hidden="true" />
          Fit
        </button>
        <button
          type="button"
          aria-label="Arrange graph"
          title="Arrange graph"
          onClick={() => canvasRef.current?.arrange()}
        >
          <Waypoints size={16} aria-hidden="true" />
        </button>
      </div>
    </WorldViewToolbar>
  );
  return (
    <>
      {toolbarPortal ? createPortal(toolbar, toolbarPortal) : toolbar}
      <div ref={rootRef} className="world-spatial-graph-shell">
        <div className="world-spatial-graph-content">
          <aside
            className="world-spatial-graph-outline"
            aria-label="Graph semantic hierarchy"
          >
            <div
              className="world-spatial-graph-outline-head"
              aria-live="polite"
            >
              {searchActive
                ? `${visibleHosts.length} matching host branches`
                : `${projection.hosts.length} presented host branches`}
            </div>
            {visibleHosts.length ? (
              <ul>
                {visibleHosts.map((host) => (
                  <SemanticHost
                    key={host.node.id}
                    host={host}
                    collapsedIds={effectiveCollapsedIds}
                    selectedId={selectedId}
                    matches={matches}
                    searchActive={searchActive}
                    onToggle={toggleCollapse}
                    onSelect={onSelect}
                    onOpenTerminal={onOpenTerminal}
                    runAction={runAction}
                  />
                ))}
              </ul>
            ) : (
              <p className="world-spatial-graph-empty">No Graph matches.</p>
            )}
            {projection.omittedHostCount ? (
              <p className="world-spatial-graph-overflow-copy">
                {projection.omittedHostCount} hosts omitted by the 128-host
                bound.
              </p>
            ) : null}
            {projection.omittedSpaceCount ? (
              <p className="world-spatial-graph-overflow-copy">
                {projection.omittedSpaceCount} spaces omitted by the 128-space
                bound.
              </p>
            ) : null}
            {actionError ? (
              <p className="world-spatial-graph-action-error" role="status">
                {actionError}
              </p>
            ) : null}
          </aside>
          {!compact ? (
            <div className="world-spatial-graph-visual">
              <GraphCanvas
                ref={canvasRef}
                projection={projection}
                collapsedIds={effectiveCollapsedIds}
                selectedId={selectedId}
                matchedIds={matches}
                anchorNodeIds={anchorNodeIds}
                initialPrefs={initialPrefs}
                fitOnMount={fitOnMount}
                onSelect={onSelect}
                onActivate={activateNode}
                onToggleCollapse={toggleCollapse}
                onViewChange={updateView}
                onAnchorsChange={publishAnchors}
              />
              <div className="world-spatial-graph-help">
                Double-click a leaf to open its terminal · drag nodes to pin ·
                drag empty space to pan
              </div>
              {overflowCount ? (
                <div className="world-spatial-graph-overflow">
                  +{overflowCount} outside presentation bounds
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

type SemanticProps = {
  collapsedIds: ReadonlySet<string>;
  selectedId: string | null;
  matches: ReadonlySet<string> | null;
  searchActive: boolean;
  onToggle(id: string): void;
  onSelect(id: string): void;
  onOpenTerminal(id: string): Promise<void>;
  runAction(action: () => Promise<void>): void;
};

function SemanticHost({
  host,
  ...props
}: { host: WorldGraphHost } & SemanticProps) {
  const expanded = !props.collapsedIds.has(host.node.id);
  const spaces = props.searchActive
    ? host.spaces.filter(({ node }) => props.matches?.has(node.id))
    : host.spaces;
  return (
    <li
      data-state={host.node.source.hostState}
      data-graph-host-id={host.node.id}
    >
      <SemanticParentRow node={host.node} expanded={expanded} {...props} />
      {expanded ? (
        <ul>
          {spaces.map((space) => (
            <SemanticSpace key={space.node.id} space={space} {...props} />
          ))}
          {spaces.length === 0 ? <li className="is-empty">No spaces</li> : null}
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
}: { space: WorldGraphSpace } & SemanticProps) {
  const expanded = !props.collapsedIds.has(space.node.id);
  const children = props.searchActive
    ? space.children.filter(({ id }) => props.matches?.has(id))
    : space.children;
  return (
    <li data-state={space.node.status}>
      <SemanticParentRow node={space.node} expanded={expanded} {...props} />
      {expanded ? (
        <ul>
          {children.map((child) => (
            <li key={child.id} data-state={child.status}>
              <SemanticLeaf node={child} {...props} />
            </li>
          ))}
          {children.length === 0 ? (
            <li className="is-empty">No agents or terminals</li>
          ) : null}
          {space.omittedChildCount ? (
            <li className="is-overflow">
              +{space.omittedChildCount} omitted leaves
            </li>
          ) : null}
          {space.watchedOmittedChildCount ? (
            <li className="is-overflow">
              +{space.watchedOmittedChildCount} watched leaves hidden by view
              limit
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function SemanticParentRow({
  node,
  expanded,
  searchActive,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: WorldGraphNode;
  expanded: boolean;
  searchActive: boolean;
} & SemanticProps) {
  return (
    <div className="world-spatial-graph-row">
      <button
        type="button"
        className="world-spatial-graph-toggle"
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
      <button
        type="button"
        className="world-spatial-graph-select"
        data-graph-node-anchor={node.id}
        aria-pressed={selectedId === node.id}
        onClick={() => onSelect(node.id)}
      >
        {node.kind === "host" ? (
          <Server size={16} aria-hidden="true" />
        ) : (
          <span className="world-spatial-graph-status" aria-hidden="true">
            {statusSymbol(node)}
          </span>
        )}
        <span>
          <strong>{node.label}</strong>
          <small>{nodeSummary(node)}</small>
        </span>
      </button>
      <span />
    </div>
  );
}

function SemanticLeaf({
  node,
  selectedId,
  onSelect,
  onOpenTerminal,
  runAction,
}: { node: WorldGraphNode } & SemanticProps) {
  return (
    <div className="world-spatial-graph-row">
      <span className="world-spatial-graph-spacer" />
      <button
        type="button"
        className="world-spatial-graph-select"
        data-graph-node-anchor={node.id}
        aria-pressed={selectedId === node.id}
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => {
          if (node.source.capabilities.openTerminal) {
            runAction(() => onOpenTerminal(node.id));
          }
        }}
      >
        {node.source.kind === "agent" ? (
          <AgentIcon agent={node.source.pane.agent ?? "agent"} compact />
        ) : (
          <SquareTerminal size={16} aria-hidden="true" />
        )}
        <span>
          <strong>{node.label}</strong>
          <small>{nodeSummary(node)}</small>
        </span>
      </button>
      {node.source.capabilities.openTerminal ? (
        <button
          type="button"
          className="world-spatial-graph-action"
          aria-label={`Open ${node.label} terminal`}
          title="Open terminal"
          onClick={() => runAction(() => onOpenTerminal(node.id))}
        >
          <SquareTerminal size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

export function graphMatches(
  hosts: readonly WorldGraphHost[],
  rawQuery: string,
) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return null;
  const matches = new Set<string>();
  for (const host of hosts) {
    if (host.node.searchText.includes(query)) {
      addHost(matches, host);
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

function addHost(matches: Set<string>, host: WorldGraphHost) {
  matches.add(host.node.id);
  for (const space of host.spaces) {
    matches.add(space.node.id);
    for (const child of space.children) matches.add(child.id);
  }
}

function statusSymbol(node: WorldGraphNode) {
  if (node.stale) return "⏸";
  return node.status === "working"
    ? "▶"
    : node.status === "blocked"
      ? "!"
      : node.status === "done"
        ? "✓"
        : node.status === "idle"
          ? "○"
          : "?";
}

function nodeSummary(node: WorldGraphNode) {
  const source = node.source;
  if (source.kind === "agent" || source.kind === "terminal") {
    return [
      source.stale
        ? "stale"
        : (source.stateLabels[source.status] ?? source.status),
      source.focused ? "focused" : null,
      source.modelLabel,
      source.taskSummary,
      source.hostLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    node.source.hostState === "active"
      ? "Active"
      : node.source.hostState === "ready-inactive"
        ? "Ready · inactive"
        : node.source.hostState === "reconnecting"
          ? "Reconnecting"
          : "Offline · stale",
    node.kind === "space" ? node.hostLabel : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function graphElementAnchor(
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
  return {
    x: Math.max(clip.left + 4, Math.min(clip.right - 4, rect.right)),
    y: Math.max(clip.top + 4, Math.min(clip.bottom - 4, centerY)),
    visible,
    edge: visible
      ? null
      : centerY < clip.top
        ? "top"
        : centerY > clip.bottom
          ? "bottom"
          : centerX < clip.left
            ? "left"
            : "right",
  };
}
