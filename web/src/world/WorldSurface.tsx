import {
  ChevronLeft,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SurfaceComponentProps } from "../surfaceRegistry";
import { PixelOfficeCanvas } from "./PixelOfficeCanvas";
import type {
  OfficeConversationAnchors,
  OfficeConversationAnchorTarget,
  OfficeCanvasAnchor,
  OfficeCanvasHover,
} from "./PixelOfficeCanvas";
import { useWorldConversationLayout } from "./WorldConversationLayer";
import type { WorldConversationBubblePanel } from "./WorldConversationLayer";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import { OFFICE_PRESENTATION_BOUNDS } from "./herdrOfficeProjection";
import { officeCalloutForKey } from "./officeSelection";
import type { OfficeCallout } from "./officeSelection";
import type { OfficeObservability } from "./officeObservability";
import {
  deskAnchor,
  OFFICE_GEOMETRY,
} from "./officeGeometry";
import type {
  OfficeLongRoomTitleMode,
  OfficeRoomAlignment,
} from "./officeGeometry";
import type { PublishedOfficeLayout } from "./officeLayout";
import { officeSemanticTargets } from "./officeSemanticTargets";
import { readWorldViewPrefs, writeWorldViewPrefs } from "./worldViewPrefs";
import {
  officeAgentHandoffRequest,
  officeRoomHandoffRequest,
} from "./herdrOfficeHandoff";
import type { OfficeHandoffRequest } from "./herdrOfficeHandoff";

export type WorldSurfaceContext = {
  projection: HerdrOfficeProjection;
  observability: OfficeObservability;
  selectedKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
  onSelect: (key: string | null) => void;
  compact: boolean;
  onBackToSidebar: () => void;
  onToggleSidebar: () => void;
  onOpenInSpaces: (request: OfficeHandoffRequest) => void;
  handoffStatus: string | null;
  conversationBubbles: readonly WorldConversationBubblePanel[];
  onCloseConversation: (id: string) => void;
  onFocusConversation: (id: string) => void;
  agentActivityTransitions: ReadonlyMap<string, number>;
  roomAlignment: OfficeRoomAlignment;
  longRoomTitleMode: OfficeLongRoomTitleMode;
  canCreateSeat: (roomKey: string) => boolean;
  onNewSeat: (roomKey?: string) => void;
  canCreateRoom: (roomKey?: string) => boolean;
  onCreateRoom: (roomKey?: string) => void;
  canRenameRoom: (roomKey: string) => boolean;
  onRenameRoom: (roomKey: string) => void;
  canCloseRoom: (roomKey: string) => boolean;
  onCloseRoom: (roomKey: string) => void;
};

const FALLBACK_CONTEXT: WorldSurfaceContext = {
  projection: {
    version: 1,
    generatedAt: 0,
    hosts: [],
    rooms: [],
    receptions: [],
    barAgents: [],
    roomRoster: [],
    deskRoster: [],
    roster: [],
    unresolved: [],
    coverage: {
      configuredHosts: 0,
      observedHosts: 0,
      compatibleHosts: 0,
      connectingHosts: 0,
      staleHosts: 0,
      incompatibleHosts: 0,
      disabledHosts: 0,
      observedWorkspaces: 0,
      observedDesks: 0,
      observedAgents: 0,
      status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
      omittedRooms: 0,
      omittedDesks: 0,
      omittedRoomAgents: 0,
      omittedReceptionDesks: 0,
      omittedWaitingAgents: 0,
      omittedBarAgents: 0,
    },
    presentationBounds: {
      ...OFFICE_PRESENTATION_BOUNDS,
      totalRooms: 0,
      renderedRooms: 0,
      totalDesks: 0,
      renderedDesks: 0,
      totalRoomAgents: 0,
      renderedRoomAgents: 0,
      totalReceptionDesks: 0,
      renderedReceptionDesks: 0,
      totalWaitingAgents: 0,
      renderedWaitingAgents: 0,
      totalBarAgents: 0,
      renderedBarAgents: 0,
    },
  },
  selectedKey: null,
  observability: {
    health: "unavailable",
    providerId: null,
    sourceCount: 0,
    configuredSourceCount: 0,
    failedSourceCount: 0,
    observedAt: 0,
    windowSeconds: null,
    models: [],
    totalCostUsd: null,
    totalUsage: 0,
  },
  completionSeenKeys: new Set(),
  onSelect: () => {},
  compact: false,
  onBackToSidebar: () => {},
  onToggleSidebar: () => {},
  onOpenInSpaces: () => {},
  handoffStatus: null,
  conversationBubbles: [],
  onCloseConversation: () => {},
  onFocusConversation: () => {},
  agentActivityTransitions: new Map(),
  roomAlignment: "left",
  longRoomTitleMode: "expand",
  canCreateSeat: () => false,
  onNewSeat: () => {},
  canCreateRoom: () => false,
  onCreateRoom: () => {},
  canRenameRoom: () => false,
  onRenameRoom: () => {},
  canCloseRoom: () => false,
  onCloseRoom: () => {},
};

export default function WorldSurface({ context }: SurfaceComponentProps) {
  const worldContext = isWorldSurfaceContext(context) ? context : FALLBACK_CONTEXT;
  const onActivateAgent = (key: string) => {
    const agent = worldContext.projection.roster.find(
      (entry) => entry.agent.key === key,
    )?.agent;
    if (!agent) {
      return;
    }
    worldContext.onSelect(key);
    worldContext.onOpenInSpaces(officeAgentHandoffRequest(agent));
  };
  const onActivateRoom = (key: string) => {
    const room = worldContext.projection.roomRoster.find((entry) => entry.key === key);
    if (!room) {
      return;
    }
    worldContext.onSelect(key);
    worldContext.onOpenInSpaces(officeRoomHandoffRequest(room));
  };
  return (
    <WorldStage
      projection={worldContext.projection}
      context={worldContext}
      onActivateAgent={onActivateAgent}
      onActivateRoom={onActivateRoom}
    />
  );
}

function WorldStage({
  projection,
  context,
  onActivateAgent,
  onActivateRoom,
}: {
  projection: HerdrOfficeProjection;
  context: WorldSurfaceContext;
  onActivateAgent: (key: string) => void;
  onActivateRoom: (key: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const scrollRestoreRef = useRef(false);
  const scrollSaveTimerRef = useRef<number | null>(null);
  const { rects: conversationRects } = useWorldConversationLayout();
  const [conversationAnchors, setConversationAnchors] = useState<OfficeConversationAnchors>({});
  const [officeLayout, setOfficeLayout] = useState<PublishedOfficeLayout | null>(null);
  const [canvasRenderedRevision, setCanvasRenderedRevision] = useState(0);
  const [shellSize, setShellSize] = useState({ width: 0, height: 0 });
  const [canvasHover, setCanvasHover] = useState<(OfficeCanvasHover & { left: number; top: number }) | null>(null);
  const [selectedCanvasAnchor, setSelectedCanvasAnchor] = useState<(OfficeCanvasAnchor & { left: number; top: number }) | null>(null);

  const persistWorldView = useCallback(() => {
    const latest = readWorldViewPrefs();
    writeWorldViewPrefs({
      ...latest,
      scrollTop: Math.max(0, scrollRef.current?.scrollTop ?? latest.scrollTop),
    });
  }, []);

  const scheduleWorldViewPersist = useCallback(() => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
    }
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = null;
      persistWorldView();
    }, 120);
  }, [persistWorldView]);
  const conversationTargets = useMemo(
    () => context.conversationBubbles.map((panel): OfficeConversationAnchorTarget => ({
      id: panel.id,
      selectedKey: panel.selectedKey,
      targetKey: panel.targetKey,
    })),
    [context.conversationBubbles],
  );
  const selectedRoomKey = projection.rooms.find(({ key }) => key === context.selectedKey)?.key ??
    projection.deskRoster.find(({ desk }) => desk.key === context.selectedKey)?.desk.roomKey ??
    projection.roster.find(({ agent }) => agent.key === context.selectedKey)?.agent.roomKey ??
    null;
  const agentBarRect = officeLayout?.agentBarRect;
  const agentBarReady = Boolean(
    officeLayout &&
      !officeLayout.fallbackMessage &&
      officeLayout.layoutRevision > 0 &&
      officeLayout.layoutRevision === canvasRenderedRevision,
  );
  const onCanvasHover = (hover: OfficeCanvasHover | null) => {
    if (!hover) {
      setCanvasHover(null);
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    setCanvasHover({
      ...hover,
      left: hover.clientX - shellRect.left,
      top: hover.clientY - shellRect.top,
    });
  };

  const onSelectedCanvasAnchorChange = (anchor: OfficeCanvasAnchor | null) => {
    if (!anchor) {
      setSelectedCanvasAnchor(null);
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    setSelectedCanvasAnchor({
      ...anchor,
      left: anchor.x - shellRect.left,
      top: anchor.y - shellRect.top,
    });
  };

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const measure = () => {
      const nextSize = { width: shell.clientWidth, height: shell.clientHeight };
      setShellSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    if (context.compact || scrollRestoreRef.current) {
      return;
    }
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    const restore = () => {
      scroll.scrollTop = readWorldViewPrefs().scrollTop;
      scrollRestoreRef.current = true;
    };
    const frame = window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [context.compact, projection.generatedAt]);

  useEffect(() => {
    if (context.compact) {
      return;
    }
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }
    const onScroll = () => scheduleWorldViewPersist();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [context.compact, scheduleWorldViewPersist]);

  useEffect(() => {
    const ids = new Set(context.conversationBubbles.map(({ id }) => id));
    setConversationAnchors((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => ids.has(id)),
    ));
  }, [context.conversationBubbles]);

  const connector = (() => {
    const shell = shellRef.current;
    if (
      !shell ||
      context.conversationBubbles.length === 0 ||
      shellSize.width <= 0 ||
      shellSize.height <= 0
    ) {
      return null;
    }
    const shellRect = shell.getBoundingClientRect();
    const paths = context.conversationBubbles.flatMap((panel) => {
      const conversationRect = conversationRects[panel.id];
      const anchors = conversationAnchors[panel.id];
      if (!conversationRect || !anchors) {
        return [];
      }
      const bubbleLeft = conversationRect.left - shellRect.left;
      const bubbleRight = conversationRect.right - shellRect.left;
      const bubbleTop = conversationRect.top - shellRect.top;
      const bubbleBottom = conversationRect.bottom - shellRect.top;
      const bubbleCenterX = (bubbleLeft + bubbleRight) / 2;
      return (["workbench", "agent"] as const).flatMap((kind) => {
        const anchor = anchors[kind];
        if (!anchor) {
          return [];
        }
        const targetX = anchor.x - shellRect.left;
        const targetY = anchor.y - shellRect.top;
        const edgeX = targetX <= bubbleCenterX ? bubbleLeft : bubbleRight;
        const preferredEdgeY = targetY + (kind === "workbench" ? -10 : 10);
        const edgeY = Math.max(bubbleTop + 22, Math.min(bubbleBottom - 22, preferredEdgeY));
        const bendX = targetX + (edgeX - targetX) * 0.55;
        const path = `M ${targetX.toFixed(1)} ${targetY.toFixed(1)} C ${bendX.toFixed(1)} ${targetY.toFixed(1)}, ${bendX.toFixed(1)} ${edgeY.toFixed(1)}, ${edgeX.toFixed(1)} ${edgeY.toFixed(1)}`;
        return [{
          id: `${panel.id}:${kind}`,
          windowId: panel.id,
          kind,
          path,
          targetX,
          targetY,
          offscreen: anchor.edge,
        }];
      });
    });
    if (paths.length === 0) {
      return null;
    }
    return (
      <svg
        className="world-conversation-connector"
        aria-hidden="true"
        width={shellSize.width}
        height={shellSize.height}
        viewBox={`0 0 ${shellSize.width} ${shellSize.height}`}
        preserveAspectRatio="none"
      >
        {paths.map(({ id, windowId, kind, path, targetX, targetY, offscreen }) => (
          <g key={id} data-anchor={kind} data-window-id={windowId} data-offscreen={offscreen ?? undefined}>
            <path
              data-anchor={kind}
              data-window-id={windowId}
              data-offscreen={offscreen ?? undefined}
              d={path}
            />
            <circle
              data-anchor={kind}
              data-window-id={windowId}
              data-offscreen={offscreen ?? undefined}
              cx={targetX}
              cy={targetY}
              r="4"
            />
          </g>
        ))}
      </svg>
    );
  })();

  return (
    <div ref={shellRef} className="world-stage-shell">
      <header className="stage-bar world-stage-bar">
        <button
          className="icon-btn"
          type="button"
          aria-label={context.compact ? "Back to Herdr sidebar" : "Toggle sidebar"}
          title={context.compact ? "Back to sidebar" : "Toggle sidebar"}
          onClick={context.compact ? context.onBackToSidebar : context.onToggleSidebar}
        >
          {context.compact ? <ChevronLeft size={20} /> : <PanelLeft size={18} />}
        </button>
        <div className="stage-id">
          <span className="stage-title">Pixel Office</span>
          <span className="stage-sub">Shared Herdr state · live board in CEO Office</span>
        </div>
        <button
          className="icon-btn"
          type="button"
          aria-label="Reset office view"
          title="Reset view"
          onClick={() => scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" })}
        >
          <RotateCcw size={16} />
        </button>
      </header>
      {context.compact ? (
        <WorldCompactTargetChooser
          projection={projection}
          selectedKey={context.selectedKey}
          onSelect={context.onSelect}
          onActivateAgent={onActivateAgent}
          onActivateRoom={onActivateRoom}
        />
      ) : null}
      <div
        ref={scrollRef}
        className="world-stage-scroll"
        role="region"
        aria-label="Scrollable Pixel Office scene"
        tabIndex={0}
      >
        <PixelOfficeCanvas
          projection={projection}
          observability={context.observability}
          selectedKey={context.selectedKey}
          completionSeenKeys={context.completionSeenKeys}
          conversationTargets={conversationTargets}
          onSelect={context.onSelect}
          onActivateAgent={onActivateAgent}
          onActivateRoom={onActivateRoom}
          canCreateSeat={context.canCreateSeat}
          onNewSeat={context.onNewSeat}
          onLayoutChange={setOfficeLayout}
          onCanvasRendered={setCanvasRenderedRevision}
          roomAlignment={context.roomAlignment}
          longRoomTitleMode={context.longRoomTitleMode}
          onHover={onCanvasHover}
          onAnchorChange={(anchors) => setConversationAnchors(anchors ?? {})}
          onSelectedAnchorChange={onSelectedCanvasAnchorChange}
        >
          <WorldAgentBar
            className="world-canvas-agent-bar"
            projection={projection}
            selectedKey={context.selectedKey}
            barWidth={agentBarRect?.width ?? OFFICE_GEOMETRY.agentBarPreferredWidth}
            barHeight={agentBarRect?.height ?? OFFICE_GEOMETRY.ceoBandHeight - 4}
            left={agentBarRect?.x}
            top={agentBarRect?.y}
            interactive={agentBarReady}
            onSelect={context.onSelect}
            onActivateAgent={onActivateAgent}
          />
          {officeLayout ? (
            <WorldSemanticTargets
              layout={officeLayout}
              projection={projection}
              selectedKey={context.selectedKey}
              interactive={agentBarReady}
              onSelect={context.onSelect}
              onActivateAgent={onActivateAgent}
              onActivateRoom={onActivateRoom}
              onHover={onCanvasHover}
            />
          ) : null}
          {officeLayout ? (
            <WorldRoomActions
              layout={officeLayout}
              projection={projection}
              selectedRoomKey={selectedRoomKey}
              context={context}
              canvasRenderedRevision={canvasRenderedRevision}
            />
          ) : null}
        </PixelOfficeCanvas>
      </div>
      {context.selectedKey && selectedCanvasAnchor ? (
        <WorldCanvasCallout
          callout={officeCalloutForKey(projection, context.selectedKey)}
          left={selectedCanvasAnchor.left}
          top={selectedCanvasAnchor.top}
          persistent
        />
      ) : null}
      {canvasHover && !(canvasHover.key === context.selectedKey && officeCalloutForKey(projection, canvasHover.key)?.summary) ? (
        <WorldCanvasCallout
          callout={officeCalloutForKey(projection, canvasHover.key)}
          left={canvasHover.left}
          top={canvasHover.top}
        />
      ) : null}
      {connector}
    </div>
  );
}

function WorldSemanticTargets({
  layout,
  projection,
  selectedKey,
  interactive,
  onSelect,
  onActivateAgent,
  onActivateRoom,
  onHover,
}: {
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  interactive: boolean;
  onSelect: (key: string) => void;
  onActivateAgent: (key: string) => void;
  onActivateRoom: (key: string) => void;
  onHover: (hover: OfficeCanvasHover | null) => void;
}) {
  const targets = officeSemanticTargets(projection, layout);
  return (
    <div
      className="world-semantic-targets-overlay"
      aria-label="Office scene targets"
      aria-hidden={!interactive}
    >
      {targets.map((target) => (
        <button
          key={`${target.kind}:${target.key}`}
          className="world-semantic-target"
          type="button"
          data-kind={target.kind}
          data-target-key={target.key}
          aria-label={target.label}
          aria-pressed={selectedKey === target.key}
          disabled={!interactive}
          title={target.label}
          style={{
            left: `${target.rect.x}px`,
            top: `${target.rect.y}px`,
            width: `${target.rect.width}px`,
            height: `${target.rect.height}px`,
          }}
          onClick={() => onSelect(target.key)}
          onPointerMove={(event) => onHover({
            key: target.key,
            clientX: event.clientX,
            clientY: event.clientY,
          })}
          onPointerLeave={() => onHover(null)}
          onDoubleClick={() => {
            if (!target.canActivate) {
              return;
            }
            if (target.kind === "agent") {
              onActivateAgent(target.key);
            } else if (target.kind === "room") {
              onActivateRoom(target.key);
            }
          }}
        />
      ))}
    </div>
  );
}

const COMPACT_TARGET_PAGE_SIZE = OFFICE_PRESENTATION_BOUNDS.rosterPage;

function WorldCompactTargetChooser({
  projection,
  selectedKey,
  onSelect,
  onActivateAgent,
  onActivateRoom,
}: {
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onActivateAgent: (key: string) => void;
  onActivateRoom: (key: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const agents = projection.roster.slice(0, COMPACT_TARGET_PAGE_SIZE);
  const rooms = projection.roomRoster.slice(0, COMPACT_TARGET_PAGE_SIZE);
  const desks = projection.deskRoster.slice(0, COMPACT_TARGET_PAGE_SIZE);
  const select = (key: string) => {
    onSelect(key);
    detailsRef.current?.removeAttribute("open");
  };
  const activate = (callback: () => void) => {
    callback();
    detailsRef.current?.removeAttribute("open");
  };
  return (
    <details ref={detailsRef} className="world-compact-target-chooser">
      <summary>
        <span>Office targets</span>
        <small>{projection.roster.length} agents · {projection.roomRoster.length} rooms</small>
      </summary>
      <div className="world-compact-target-panel">
        <TargetListSection title="Agents" total={projection.roster.length} shown={agents.length}>
          {agents.map(({ agent, roomLabel, hostLabel }) => {
            const status = agent.stale
              ? "stale"
              : agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus;
            return (
              <li key={agent.key}>
                <button
                  type="button"
                  className="world-compact-target-select"
                  data-target-key={agent.key}
                  aria-pressed={selectedKey === agent.key}
                  onClick={() => select(agent.key)}
                >
                  <strong>{agent.displayLabel}</strong>
                  <span>{status} · {roomLabel} · {hostLabel}</span>
                  {agent.taskSummary ? <small>{agent.taskSummary}</small> : null}
                </button>
                {agent.canOpenInSpaces ? (
                  <button
                    type="button"
                    className="world-compact-target-open"
                    aria-label={`Open ${agent.displayLabel} in Spaces`}
                    onClick={() => activate(() => onActivateAgent(agent.key))}
                  >
                    Open
                  </button>
                ) : null}
              </li>
            );
          })}
        </TargetListSection>
        <TargetListSection title="Rooms" total={projection.roomRoster.length} shown={rooms.length}>
          {rooms.map((room) => (
            <li key={room.key}>
              <button
                type="button"
                className="world-compact-target-select"
                data-target-key={room.key}
                aria-pressed={selectedKey === room.key}
                onClick={() => select(room.key)}
              >
                <strong>{room.displayLabel}</strong>
                <span>{room.stale ? "stale · " : ""}{room.hostLabel}</span>
              </button>
              {room.canOpenInSpaces ? (
                <button
                  type="button"
                  className="world-compact-target-open"
                  aria-label={`Open room ${room.displayLabel} in Spaces`}
                  onClick={() => activate(() => onActivateRoom(room.key))}
                >
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </TargetListSection>
        <TargetListSection title="Desks" total={projection.deskRoster.length} shown={desks.length}>
          {desks.map(({ desk, roomLabel, hostLabel }) => (
            <li key={desk.key}>
              <button
                type="button"
                className="world-compact-target-select"
                data-target-key={desk.key}
                aria-pressed={selectedKey === desk.key}
                onClick={() => select(desk.key)}
              >
                <strong>{desk.displayLabel}</strong>
                <span>{roomLabel} · {hostLabel}</span>
              </button>
            </li>
          ))}
        </TargetListSection>
      </div>
    </details>
  );
}

function TargetListSection({
  title,
  total,
  shown,
  children,
}: {
  title: string;
  total: number;
  shown: number;
  children: ReactNode;
}) {
  if (total === 0) {
    return null;
  }
  return (
    <section className="world-compact-target-section" aria-labelledby={`world-targets-${title.toLowerCase()}`}>
      <h3 id={`world-targets-${title.toLowerCase()}`}>{title}</h3>
      <ul>{children}</ul>
      {total > shown ? <p>Showing {shown} of {total} {title.toLowerCase()}.</p> : null}
    </section>
  );
}

function WorldCanvasCallout({
  callout,
  left,
  top,
  persistent = false,
}: {
  callout: OfficeCallout | null;
  left: number;
  top: number;
  persistent?: boolean;
}) {
  if (!callout) {
    return null;
  }
  return (
    <div
      className={`world-canvas-callout${persistent ? " world-canvas-callout-persistent" : ""}`}
      data-kind={callout.kind}
      data-status={callout.status ?? undefined}
      style={{ left: `${left}px`, top: `${top}px` }}
      role={persistent ? "status" : "tooltip"}
      aria-live={persistent ? "polite" : undefined}
    >
      <strong>{callout.title}</strong>
      {callout.summary ? <span className="world-canvas-callout-summary">{callout.summary}</span> : null}
      <span>{callout.detail}</span>
    </div>
  );
}

function WorldRoomActions({
  layout,
  projection,
  selectedRoomKey,
  context,
  canvasRenderedRevision,
}: {
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  selectedRoomKey: string | null;
  context: WorldSurfaceContext;
  canvasRenderedRevision: number;
}) {
  const layoutReady = layout.layoutRevision > 0 && layout.layoutRevision === canvasRenderedRevision;
  const roomBottom = layout.rooms.reduce(
    (bottom, room) => Math.max(bottom, room.y + room.height),
    layout.roomStartY,
  );
  return (
    <div className="world-room-actions-overlay" aria-label="Office room actions">
      {layout.overflowMarker ? (
        <div className="sr-only" role="status" aria-live="polite">
          {layout.overflowMarker.label}
        </div>
      ) : null}
      {projection.rooms.map((room, index) => {
        const rect = layout.rooms.find(({ index: roomIndex }) => roomIndex === index);
        if (!rect) {
          return null;
        }
        const ready = layoutReady;
        const header = rect.header;
        return (
          <div
            key={room.key}
            className={`world-room-actions${ready ? "" : " world-room-actions-stale"}`}
            aria-hidden={!ready}
            style={{
              left: `${rect.headerRect.x}px`,
              top: `${rect.headerRect.y}px`,
              width: `${rect.headerRect.width}px`,
              height: `${rect.headerRect.height}px`,
            }}
          >
            <button
              className="world-room-overlay-action world-room-overlay-action-rename"
              type="button"
              aria-label={`Rename room ${room.accessibleLabel ?? room.displayLabel}`}
              title={`Rename ${room.accessibleLabel ?? room.displayLabel}`}
              disabled={!ready || !context.canRenameRoom(room.key)}
              style={{
                left: `${header?.renameX ?? Math.max(0, rect.headerRect.width - 52)}px`,
                top: "2px",
              }}
              onClick={() => context.onRenameRoom(room.key)}
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
            <button
              className="world-room-overlay-action world-room-overlay-action-danger"
              type="button"
              aria-label={`Close room ${room.accessibleLabel ?? room.displayLabel}`}
              title={`Close ${room.accessibleLabel ?? room.displayLabel}`}
              disabled={!ready || !context.canCloseRoom(room.key)}
              style={{
                left: `${header?.closeX ?? Math.max(0, rect.headerRect.width - OFFICE_GEOMETRY.roomHeaderActionWidth)}px`,
                top: "2px",
              }}
              onClick={() => context.onCloseRoom(room.key)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {projection.rooms.map((room, index) => {
        const rect = layout.rooms.find(({ index: roomIndex }) => roomIndex === index);
        if (!rect || !context.canCreateSeat(room.key)) {
          return null;
        }
        const full = room.desks.length >= OFFICE_GEOMETRY.desksPerRoom;
        const anchor = full
          ? { x: rect.x + rect.width / 2, deskY: rect.y + rect.height - 40 }
          : deskAnchor(rect, room.desks.length);
        return (
          <button
            key={`${room.key}:new-seat`}
            className={`world-new-seat-canvas-action${full ? " world-new-seat-canvas-action-full" : ""}`}
            type="button"
            aria-label={full
              ? `${room.accessibleLabel ?? room.displayLabel} room full`
              : `New seat in ${room.accessibleLabel ?? room.displayLabel}`}
            title={full
              ? `${room.accessibleLabel ?? room.displayLabel} is full`
              : `Start a new seat in ${room.accessibleLabel ?? room.displayLabel}`}
            disabled={!layoutReady || full}
            style={{ left: `${anchor.x - 25}px`, top: `${anchor.deskY}px` }}
            onClick={() => context.onNewSeat(room.key)}
          />
        );
      })}
      <div className="sr-only" aria-label="Office room names">
        {projection.rooms.map((room) => {
          const host = projection.hosts.find(({ key }) => key === room.hostKey);
          return (
            <span key={`${room.key}:semantic-name`}>
              {room.accessibleLabel ?? room.displayLabel} — {host?.accessibleLabel ?? host?.displayLabel ?? "host unavailable"}
            </span>
          );
        })}
      </div>
      {context.canCreateRoom(selectedRoomKey ?? undefined) ? (
        <button
          className="world-new-room-canvas-action"
          type="button"
          aria-label="New room"
          title="Create a new Herdr workspace"
          disabled={!layoutReady}
          style={{ left: `${layout.officeWidth / 2 - 28}px`, top: `${roomBottom + 8}px` }}
          onClick={() => context.onCreateRoom(selectedRoomKey ?? undefined)}
        >
          <Plus size={24} aria-hidden="true" />
          <span>NEW ROOM</span>
        </button>
      ) : null}
    </div>
  );
}

export function isWorldSurfaceContext(value: unknown): value is WorldSurfaceContext {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<WorldSurfaceContext>;
  return (
    typeof record.onSelect === "function" &&
    typeof record.onBackToSidebar === "function" &&
    typeof record.onToggleSidebar === "function" &&
    typeof record.onOpenInSpaces === "function" &&
    (record.roomAlignment === "left" ||
      record.roomAlignment === "center" ||
      record.roomAlignment === "right") &&
    (record.longRoomTitleMode === "expand" || record.longRoomTitleMode === "compact") &&
    typeof record.canCreateSeat === "function" &&
    typeof record.onNewSeat === "function" &&
    typeof record.canCreateRoom === "function" &&
    typeof record.onCreateRoom === "function" &&
    typeof record.canRenameRoom === "function" &&
    typeof record.onRenameRoom === "function" &&
    typeof record.canCloseRoom === "function" &&
    typeof record.onCloseRoom === "function" &&
    Boolean(record.projection)
  );
}

function WorldAgentBar({
  className,
  projection,
  selectedKey,
  barWidth,
  barHeight,
  left,
  top,
  interactive,
  onSelect,
  onActivateAgent,
}: {
  className?: string;
  projection: HerdrOfficeProjection;
  selectedKey: string | null;
  barWidth: number;
  barHeight: number;
  left?: number;
  top?: number;
  interactive: boolean;
  onSelect: (key: string) => void;
  onActivateAgent: (key: string) => void;
}) {
  const idleCount = projection.barAgents.filter(({ semanticStatus }) => semanticStatus === "idle").length;
  const blockedCount = projection.barAgents.filter(({ semanticStatus }) => semanticStatus === "blocked").length;
  const overflowCount = projection.coverage.omittedBarAgents;
  const columns = Math.max(3, Math.floor(Math.max(0, barWidth - 106) / 56));
  const rows = Math.max(2, Math.floor(Math.max(1, barHeight - 102) / 56));
  return (
    <section
      className={`world-office-overview${className ? ` ${className}` : ""}`}
      aria-label="Agent Bar"
      aria-hidden={!interactive}
      style={{
        width: `${barWidth}px`,
        height: `${barHeight}px`,
        ...(left === undefined ? {} : { left: `${left}px`, right: "auto" }),
        ...(top === undefined ? {} : { top: `${top}px` }),
        visibility: interactive ? "visible" : "hidden",
      }}
    >
      <div className="world-overview-heading">
        <strong>Agent Bar</strong>
        <span>{projection.barAgents.length} visible · {idleCount} idle · {blockedCount} needs input</span>
      </div>
      <ul
        className="world-agent-bar"
        aria-label="Agent Bar"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {projection.barAgents.length === 0 ? (
          <li className="world-agent-bar-empty">No completed or waiting agents</li>
        ) : (
          projection.barAgents.map((agent) => {
            const status = agent.stale ? "stale" : agent.semanticStatus;
            const statusLabel = agent.stale
              ? "STALE"
              : agent.stateLabels[agent.semanticStatus] ?? agent.semanticStatus.toUpperCase();
            return (
              <li key={agent.key} className="world-agent-bar-item-shell">
                <button
                  className="world-agent-bar-item"
                  type="button"
                  aria-pressed={selectedKey === agent.key}
                  data-status={status}
                  disabled={!interactive}
                  title={agent.taskSummary ?? `${agent.displayLabel} · ${statusLabel}`}
                  onClick={() => onSelect(agent.key)}
                  onDoubleClick={() => onActivateAgent(agent.key)}
                >
                  <img
                    className="world-agent-bar-avatar"
                    src={`/world/characters/${agent.characterIndex + 1}-D-1.png`}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="world-agent-bar-name">{agent.displayLabel}</span>
                  <span className="world-agent-bar-state">{statusLabel}</span>
                </button>
              </li>
            );
          })
        )}
        {overflowCount > 0 ? (
          <li className="world-agent-bar-overflow">+{overflowCount} more in roster</li>
        ) : null}
      </ul>
    </section>
  );
}
