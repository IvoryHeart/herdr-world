import "../worldAsks.css";
import { TownBoard } from "./TownBoard";
import { TownTeamsLayer, TownWorldLayer } from "./TownWorldLayer";
import { TownBuildingSigns } from "./townBuildingSigns";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TownMoveResult } from "./townMoves";
import { TOWN_GESTURES } from "./townGesture";
import { DEVTOOLS, NO_TRACE, type ViewTrace } from "../devtools/flag";
import { traceGesture } from "../devtools/trace";
import { EllipsisVertical } from "lucide-react";
import { useMobileControls } from "../../components/MobileControls";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import type {
  WorldCanvasAnchor,
  WorldCanvasAnchors,
  WorldCanvasHover,
  WorldConversationAnchors,
  WorldConversationAnchorTarget,
} from "../worldConnectorGeometry";
import type { OfficeObservability } from "../officeObservability";
import { TownCamera, type TownLevel } from "./townCamera";
import { townShapeFor, townShapeKey, type TownShape } from "./townLayout";
import { TownScene } from "./scene/townScene";
import { TownSceneDiff } from "./scene/townSceneDiff";
import { TownHud, townScreenAnchor, townWorldAnchor } from "./scene/townHud";
import { TownHudContext, useTownHud } from "./useTownHud";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownInteraction } from "./scene/townInteraction";
import { townBrowserClock, townBrowserFrames } from "./townBrowserClock";
import type { TownSummary } from "./townSummary";
import {
  createTownRenderer,
  nextTownTask,
  type TownRendererHandle,
} from "./townRenderer";
import {
  advancePixiSystemTicker,
  holdPixiSystemTicker,
} from "./pixiSystemTicker";
import type { TownTarget } from "./townTargets";
import type { TerminalColors } from "../terminalColor";
import type { Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import { placeDeskPin, type DeskPins } from "../useDeskPins";
import { useWorldSources } from "../worldSources";
import {
  NO_FOLDED_ACTIVITY,
  type TownFoldedActivity,
} from "./townFoldedActivity";
import "./town.css";
import { markAway, type TownQuestMark } from "./townQuestPennant";
import "./townBoard.css";
import "./townTeams.css";

/** A place's colour in the shared picker (ColorSwatch.tsx). */
export type PlaceColorChoice = {
  palette: readonly { id: string; hex: string }[];
  current: { id: string; custom: boolean };
  onColor(id: string | null): void;
  /** The default's colour, shown while the place has none of its own. */
  defaultHex?: string;
};

export type TownRoomActions = {
  showCreateSeat(roomKey: string): boolean;
  canCreateSeat(roomKey: string): boolean;
  createSeatReason(roomKey: string): string | null;
  /** Open this room's launcher: Terminal, a profile or an agent kind. */
  onNewAgent(roomKey: string): void;
  showCreateRoom(roomKey: string | null): boolean;
  canCreateRoom(roomKey: string | null): boolean;
  createRoomReason(roomKey: string | null): string | null;
  onCreateRoom(roomKey: string | null): void;
  canRenameRoom(roomKey: string): boolean;
  onRenameRoom(roomKey: string): void;
  canCloseRoom(roomKey: string): boolean;
  onCloseRoom(roomKey: string): void;
  /** List every pane of a desk with more panes than drawn seats. */
  onChoosePanes(deskKey: string): void;
  /** Keyboard move: choose another room for a desk (key M on its target). */
  onMoveDesk(deskKey: string): void;
  /** Keyboard move: choose another desk for an agent (key M on its target). */
  onMoveAgent(agentKey: string): void;
  /**
   * A room's (workspace's) or building's (host's) colour for the shared
   * picker; null when it cannot be changed here.
   */
  placeColor(kind: "room" | "host", key: string): PlaceColorChoice | null;
  /** A desk dragged onto another room; resolves how the move ended. */
  onDropDesk(deskKey: string, roomKey: string): Promise<TownMoveResult>;
  /**
   * A desk dragged within its room: into `ontoDeskKey`'s slot, or last when
   * null. Resolves how the reorder ended.
   */
  onReorderDesk(
    deskKey: string,
    ontoDeskKey: string | null,
  ): Promise<TownMoveResult>;
  /** An agent dragged onto another desk; resolves how the move ended. */
  onDropAgent(agentKey: string, deskKey: string): Promise<TownMoveResult>;
  /** Reveal the next group of desks, or fold the room back to 24. */
  onToggleFold?(roomKey: string, nextLimit?: number): void;
  /** A desk dragged onto another desk: join its team (townTeams.ts). */
  onGroupDesk(deskKey: string, targetDeskKey: string): Promise<TownMoveResult>;
  /** A grouped desk dropped on its own room's floor: leave its team. */
  onUngroupDesk(deskKey: string): Promise<TownMoveResult>;
};

/** Camera kept across Office visits within one page session. */
const savedCameras = new Map<string, { x: number; y: number; z: number }>();

const NO_COLORS: TerminalColors = {};
const NO_RELATIONS = { relations: [], places: new Map() };
const NO_PINS: DeskPins = {};
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_QUESTS: ReadonlyMap<string, TownQuestMark> = new Map();

export function TownCanvas({
  projection,
  foldedActivity = NO_FOLDED_ACTIVITY,
  foldRevision = 0,
  selectedKey,
  completionSeenKeys,
  summonedKeys = NO_KEYS,
  askingKeys = NO_KEYS,
  onActivateAsk,
  quests = NO_QUESTS,
  conversationTargets,
  onSelect,
  onActivateAgent,
  onActivateRoom,
  onHover,
  onAnchorChange,
  onSelectedAnchorChange,
  roomActions,
  selectedRoomKey,
  observability,
  summaryCounts,
  onOpenSummary,
  roomFocus = null,
  calm = false,
  terminalColors = NO_COLORS,
  relations = NO_RELATIONS,
  deskPins = NO_PINS,
  chrome = NO_CHROME,
  trace = NO_TRACE,
}: {
  /** Which terminals know each other (world/relations.ts). */
  relations?: {
    relations: readonly Relation[];
    places: ReadonlyMap<string, TerminalPlace>;
  };
  observability: OfficeObservability;
  /**
   * The Town summary's shared counts (townSummary.ts): the board sign shows
   * the same needs-you and finished counts as the call rail and reception.
   */
  summaryCounts?: TownSummary["counts"];
  /** Open the Town summary window from the board sign or the phone chip. */
  onOpenSummary?: () => void;
  /** A room to move the camera to (a new `seq` asks again), as from the summary. */
  roomFocus?: { roomKey: string; seq: number } | null;
  /** Town's event trace (development builds only; see world/devtools). */
  trace?: ViewTrace;
  calm?: boolean;
  /** Screen pixels covered by panels on wide screens (rail, chat dock). */
  chrome?: { left: number; right: number };
  projection: HerdrOfficeProjection;
  /** Hidden call/Ask state from the same complete attention source as the rail. */
  foldedActivity?: ReadonlyMap<string, TownFoldedActivity>;
  /** Explicit Fold/Expand admission revision, committed with its projection. */
  foldRevision?: number;
  selectedKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
  /** Agents the user opened, who walk back to their desks. */
  summonedKeys?: ReadonlySet<string>;
  askingKeys?: ReadonlySet<string>;
  onActivateAsk?: (nodeId: string) => void;
  /** Quest progress by agent key, marked over each agent's desk. */
  quests?: ReadonlyMap<string, TownQuestMark>;
  conversationTargets: readonly WorldConversationAnchorTarget[];
  onSelect: (key: string) => void;
  onActivateAgent: (key: string) => void;
  onActivateRoom: (key: string) => void;
  onHover?: (hover: WorldCanvasHover | null) => void;
  onAnchorChange?: (anchors: WorldConversationAnchors | null) => void;
  onSelectedAnchorChange?: (anchor: WorldCanvasAnchor | null) => void;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
  /** Saved terminal colours (useTerminalColors); desks use their tab's. */
  terminalColors?: TerminalColors;
  /** Saved desk pins (useDeskPins); a pinned desk keeps its cell. */
  deskPins?: DeskPins;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const traceRef = useRef(trace);
  traceRef.current = trace;
  if (DEVTOOLS && window.__HERDR_TOWN_RENDERER__)
    window.__HERDR_TOWN_RENDERER__.trace = trace;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<TownRendererHandle | null>(null);
  const pennants = useRef(new Set<HTMLElement>());
  const [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false);
  const sources = useWorldSources();
  // The town's shape follows its container, measured on every resize.
  const [shape, setShape] = useState<TownShape>(() =>
    typeof window !== "undefined"
      ? townShapeFor(window.innerWidth, window.innerHeight)
      : townShapeFor(1440, 900),
  );
  // The scene model derives what the town is; a held reflow wakes it again.
  const [, wakeReflow] = useState(0);
  // What the renderer has applied, and so what it must apply next.
  const [diff] = useState(() => new TownSceneDiff());
  const [scene] = useState(
    () => new TownScene(townBrowserClock, () => wakeReflow((n) => n + 1)),
  );
  useEffect(() => () => scene.dispose(), [scene]);
  // Where the camera goes; the renderer steps its motion each frame.
  const [view] = useState(
    () =>
      new TownSceneCamera(savedCameras, (reason) =>
        rendererRef.current?.invalidate(reason),
      ),
  );
  const semantics = scene.derive({
    projection,
    terminalColors,
    deskPins,
    relations,
    sources,
    shape,
    foldRevision,
  });
  const { model, placed, layout, teams, targets, deskBadges, blockedSince } =
    semantics;
  // A desk just pinned keeps the cell it has; save it so it stays there.
  const deskPinned = model.deskPins;
  useEffect(() => {
    for (const { pinKey, cell } of scene.pinPlacements(
      deskPinned,
      layout,
      placed,
    ))
      void placeDeskPin(pinKey, cell).finally(() => scene.pinPlaced(pinKey));
  }, [scene, layout, placed, deskPinned]);
  const [hover, setHover] = useState<string | null>(null);
  const latest = useRef({
    chrome,
    model,
    layout,
    teams,
    selectedKey,
    hover,
    calm,
    completionSeenKeys,
    summonedKeys,
    askingKeys,
    quests,
    conversationTargets,
    onSelect,
    onActivateAgent,
    onActivateRoom,
    onHover,
    onAnchorChange,
    onSelectedAnchorChange,
    roomActions,
  });
  latest.current = {
    chrome,
    calm,
    model,
    layout,
    teams,
    selectedKey,
    hover,
    completionSeenKeys,
    summonedKeys,
    askingKeys,
    quests,
    conversationTargets,
    onSelect,
    onActivateAgent,
    onActivateRoom,
    onHover,
    onAnchorChange,
    onSelectedAnchorChange,
    roomActions,
  };

  const anchorFrame = useRef<(() => void) | null>(null);
  const reportAnchors = () => {
    const { onAnchorChange: report, onSelectedAnchorChange: reportSelected } =
      latest.current;
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if ((!report && !reportSelected) || !renderer || !host) return;
    const rect = host.getBoundingClientRect();
    const { model: m, layout: l } = latest.current;
    const worldAnchor = (key: string | null): WorldCanvasAnchors => {
      const at = townWorldAnchor(key, m, l, (agentKey) =>
        renderer.actorPosition(agentKey),
      );
      return {
        agent: townScreenAnchor(at.agent, renderer.camera, rect),
        workbench: townScreenAnchor(at.workbench, renderer.camera, rect),
      };
    };
    if (report) {
      const anchors: WorldConversationAnchors = {};
      for (const target of latest.current.conversationTargets)
        anchors[target.id] = worldAnchor(target.targetKey);
      report(anchors);
    }
    if (reportSelected) {
      const selected = worldAnchor(latest.current.selectedKey);
      reportSelected(selected.agent ?? selected.workbench);
    }
  };
  const reportRef = useRef(reportAnchors);
  reportRef.current = reportAnchors;
  const scheduleAnchors = () => {
    if (anchorFrame.current !== null) return;
    anchorFrame.current = townBrowserFrames.next(() => {
      anchorFrame.current = null;
      reportRef.current();
    });
  };

  const levelRef = useRef<TownLevel>("overview");
  const [signs] = useState(
    () =>
      new TownBuildingSigns(() =>
        rendererRef.current?.invalidate("building-sign"),
      ),
  );
  const hoverEntry = useCallback(
    (key: string | null, rect?: DOMRect) =>
      latest.current.onHover?.(
        key && rect
          ? {
              key,
              clientX: rect.right,
              clientY: rect.top + rect.height / 2,
            }
          : null,
      ),
    [],
  );
  // What the HUD shows; drawn frames reach React only when it changes.
  const [hud] = useState(() => new TownHud(townBrowserClock));
  // Only on-screen buildings keep DOM cards, plaques and receptions.
  const visible = useTownHud(hud, "visible");
  /** Aims a carried desk or agent again at the frame just drawn. */
  const reaimCarry = useRef<(() => void) | null>(null);
  const onFrame = (camera: TownRendererHandle["camera"], level: TownLevel) => {
    // The canvas and its targets show this camera until the next frame, so
    // presses are hit-tested against it (view.drawn).
    const { moved, posed } = view.drew(camera, level, latest.current.layout);
    // A camera that moved under a still carry (an edge pan, an arrow key)
    // puts something else under it: the target follows what is now drawn.
    if (moved) reaimCarry.current?.();
    const layer = worldRef.current;
    hud.drew(camera, level, latest.current.layout);
    if (layer) {
      const tx = camera.viewport.width / 2 - camera.x * camera.z;
      const ty = camera.viewport.height / 2 - camera.y * camera.z;
      layer.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.z})`;
      layer.style.setProperty("--z", String(camera.z));
      layer.style.setProperty("--iz", String(1 / camera.z));
      if (levelRef.current !== level) {
        levelRef.current = level;
        layer.dataset.level = level;
      }
      const renderer = rendererRef.current;
      if (renderer) {
        signs.update((hostKey) => renderer.roofAlpha(hostKey));
        if (level !== "overview")
          for (const pennant of pennants.current) markAway(pennant, renderer);
      }
    }
    hud.framed();
    // Inspected agents walk under a still camera, so their lines follow every
    // drawn frame. World keeps unchanged anchors, so idle frames commit nothing.
    if (posed || latest.current.conversationTargets.length > 0)
      scheduleAnchors();
  };
  const onFrameRef = useRef(onFrame);

  onFrameRef.current = onFrame;

  const viewport = () => {
    const host = hostRef.current!;
    return townViewport(
      host.clientWidth || 1,
      host.clientHeight || 1,
      latest.current.chrome,
    );
  };

  // Panels opening or closing re-frame the town only if it is still at home.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !hostRef.current) return;
    view.reframe(latest.current.layout, viewport(), (next) =>
      renderer.setViewport(next),
    );
    // viewport() reads the latest chrome.
  }, [view, chrome.left, chrome.right]);

  const sceneState = () => ({
    selectedKey: latest.current.selectedKey,
    hoverKey: latest.current.hover,
    completionSeenKeys: latest.current.completionSeenKeys,
    summonedKeys: latest.current.summonedKeys,
    askingKeys: latest.current.askingKeys,
    openHostKey: null,
    calm: latest.current.calm,
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const abort = new AbortController();
    const camera = new TownCamera();
    void createTownRenderer(
      host,
      (camera, level) => {
        advancePixiSystemTicker();
        onFrameRef.current(camera, level);
      },
      abort.signal,
      DEVTOOLS
        ? (error) =>
            traceRef.current.record("error", {
              where: "frame",
              message: String(error),
            })
        : undefined,
      DEVTOOLS ? (frame) => traceRef.current.record("frame", frame) : undefined,
      camera,
    )
      .then(async (renderer) => {
        holdPixiSystemTicker();
        // Building the scene is its own task, after the renderer's setup.
        if (!disposed) await nextTownTask();
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        renderer.setViewport(viewport());
        const { model: m, layout: l } = latest.current;
        // A new renderer has applied nothing: its first frame places all.
        diff.reset();
        renderer.apply(diff.next(m, l, sceneState()));
        view.attach(camera, l, viewport());
        renderer.invalidate("ready");
        setReady(true);
      })
      .catch((error: unknown) => {
        if (disposed) return;
        if (DEVTOOLS)
          traceRef.current.record("error", {
            where: "renderer",
            message: String(error),
          });
        if (window.__HERDR_TOWN_RENDERER__)
          window.__HERDR_TOWN_RENDERER__.lastError =
            error instanceof Error
              ? error.message.slice(0, 160)
              : "renderer failed";
        setFailure(true);
      });
    const observer = new ResizeObserver(() => {
      const renderer = rendererRef.current;
      if (!renderer || !hostRef.current) return;
      const next = viewport();
      const fit = townShapeFor(next.width, next.height);
      setShape((was) => (townShapeKey(was) === townShapeKey(fit) ? was : fit));
      renderer.setViewport(next);
    });
    observer.observe(host);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      anchorFrame.current?.();
      anchorFrame.current = null;
      latest.current.onAnchorChange?.(null);
      latest.current.onSelectedAnchorChange?.(null);
      view.detach();
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [view, diff]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.apply(diff.next(model, layout, sceneState()));
    view.follow(layout, viewport());
    scheduleAnchors();
  }, [view, diff, model, layout]);
  // Presses, scrolls and zooms on the town hold back a reflow (see above).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const touch = () => scene.touch();
    const down = () => scene.pointerDown();
    const up = () => scene.pointerUp();
    host.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    host.addEventListener("wheel", touch, { capture: true, passive: true });
    return () => {
      host.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      host.removeEventListener("wheel", touch, true);
    };
  }, [scene]);

  useEffect(() => {
    const { model: m, layout: l } = latest.current;
    rendererRef.current?.apply(diff.next(m, l, sceneState()));
    scheduleAnchors();
  }, [
    diff,
    selectedKey,
    hover,
    completionSeenKeys,
    summonedKeys,
    askingKeys,
    calm,
  ]);

  // Re-report after any render, so anchors World cleared come back. World
  // keeps unchanged anchors, so a report alone never renders again.
  useEffect(() => {
    scheduleAnchors();
  });

  /* ---------- pointer input ---------- */
  // The scene's interaction decides what presses, drags and wheels do; this
  // adapter reads DOM events, captures pointers and draws the drag ghost.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ghost = document.createElement("div");
    ghost.className = "town-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    const place = (at: { x: number; y: number }) => {
      ghost.style.transform = `translate(${at.x}px, ${at.y}px)`;
    };
    const interaction = new TownInteraction({
      clock: townBrowserClock,
      frames: townBrowserFrames,
      view,
      stage: () => rendererRef.current,
      world: () => latest.current,
      hovered: () => latest.current.hover,
      setHovered: setHover,
      hover: (hover) => latest.current.onHover?.(hover),
      cursor: (pointer) => {
        host.style.cursor = pointer ? "pointer" : "";
      },
      select: (key) => latest.current.onSelect(key),
      activateAgent: (key) => latest.current.onActivateAgent(key),
      activateRoom: (key) => latest.current.onActivateRoom(key),
      move: (command) => {
        const actions = latest.current.roomActions;
        switch (command.kind) {
          case "agent":
            return actions.onDropAgent(command.agentKey, command.deskKey);
          case "group":
            return actions.onGroupDesk(command.deskKey, command.targetDeskKey);
          case "ungroup":
            return actions.onUngroupDesk(command.deskKey);
          case "reorder":
            return actions.onReorderDesk(command.deskKey, command.ontoDeskKey);
          case "desk":
            return actions.onDropDesk(command.deskKey, command.roomKey);
        }
      },
      ghost: {
        lift(label, at) {
          ghost.textContent = label;
          ghost.dataset.valid = "false";
          place(at);
          host.append(ghost);
        },
        aim(label, valid, action, at) {
          ghost.textContent = label;
          ghost.dataset.valid = String(valid);
          ghost.dataset.action = action;
          place(at);
        },
        remove: () => ghost.remove(),
      },
      held: () => navigator.vibrate?.(12),
      // Town's targets are live hits and drags: trace a summary of each.
      trace: DEVTOOLS
        ? (before, after, event, effects) =>
            traceGesture(
              traceRef.current,
              before,
              after,
              event,
              effects,
              (target) => ({
                hit: target.hit?.kind ?? null,
                key: TOWN_GESTURES.key(target),
                drag: Boolean(target.drag),
              }),
            )
        : undefined,
    });
    reaimCarry.current = () => interaction.reaim();
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const down = (event: PointerEvent) => {
      if (!rendererRef.current) return;
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks cannot be captured.
      }
      interaction.down({
        id: event.pointerId,
        at: local(event),
        primary: event.isPrimary,
        pointerType: event.pointerType,
      });
    };
    const move = (event: PointerEvent) =>
      interaction.move({
        id: event.pointerId,
        at: local(event),
        pointerType: event.pointerType,
        client: { x: event.clientX, y: event.clientY },
      });
    const up = (event: PointerEvent) =>
      interaction.up({
        id: event.pointerId,
        at: local(event),
        cancel: event.type === "pointercancel",
      });
    const leave = () => interaction.leave();
    const wheel = (event: WheelEvent) => {
      if (interaction.wheel(local(event), event.deltaY, event.ctrlKey))
        event.preventDefault();
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      reaimCarry.current = null;
      interaction.dispose();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
    };
  }, [view]);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rendererRef.current || event.target !== event.currentTarget) return;
    if (view.key(event.key)) event.preventDefault();
  };

  /**
   * The zoom buttons step between whole town, one building, one room and one
   * desk, choosing whatever is nearest the centre of the screen. The current
   * step is read from the zoom, so pinching and wheel zoom mix freely.
   */
  const shellControls = useMobileControls();
  const ownsShellControls = shellControls !== null;
  useEffect(() => {
    if (!ownsShellControls) return;
    document.documentElement.dataset.townControls = "";
    return () => {
      delete document.documentElement.dataset.townControls;
    };
  }, [ownsShellControls]);
  const stepZoom = (direction: 1 | -1) => {
    if (rendererRef.current)
      view.stepZoom(direction, latest.current.layout, viewport());
  };

  const focusTarget = (target: TownTarget) => view.focusTarget(target);

  const zoomToRoomKey = (roomKey: string) =>
    view.zoomToRoom(latest.current.layout, roomKey);
  // A request waits for renderer setup and its admitted layout, then runs once.
  useEffect(() => {
    if (ready) view.roomFocus(roomFocus, layout);
  }, [view, roomFocus, ready, layout]);

  return (
    <div className="town-shell" ref={shellRef}>
      {failure ? (
        <div className="world-renderer-fallback" role="status">
          <strong>Visual scene unavailable</strong>
          <span>The complete roster and inspector remain available.</span>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className="town-canvas-host"
        data-renderer={failure ? "unavailable" : "pixi"}
        hidden={failure}
        tabIndex={0}
        role="application"
        aria-label="Office town. Arrow keys pan, plus and minus zoom."
        onKeyDown={keyboard}
      />
      <div
        className="town-world"
        ref={worldRef}
        data-level="overview"
        aria-hidden={!ready}
      >
        <TownTeamsLayer teams={teams} />
        <TownHudContext.Provider value={hud}>
          <TownWorldLayer
            hud={hud}
            foldedActivity={foldedActivity}
            askingKeys={askingKeys}
            onActivateAsk={onActivateAsk}
            model={model}
            layout={layout}
            visible={visible}
            signs={signs}
            onHoverEntry={hoverEntry}
            selectedKey={selectedKey}
            blockedSince={blockedSince}
            roomActions={roomActions}
            selectedRoomKey={selectedRoomKey}
            onSelect={onSelect}
            onActivate={onActivateAgent}
            onActivateRoom={(key) => {
              onActivateRoom(key);
              zoomToRoomKey(key);
            }}
            onFocusTarget={focusTarget}
            targets={targets}
            deskBadges={deskBadges}
            quests={quests}
            renderer={rendererRef}
            pennants={pennants.current}
          />
        </TownHudContext.Provider>
      </div>
      <TownBoard
        model={model}
        observability={observability}
        summaryCounts={summaryCounts}
        onOpenSummary={onOpenSummary}
      />
      <div className="town-zoom" role="group" aria-label="Camera">
        <button type="button" aria-label="Zoom in" onClick={() => stepZoom(1)}>
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => stepZoom(-1)}
        >
          −
        </button>
        <button
          type="button"
          className="town-zoom-all"
          aria-label="Show the whole town"
          onClick={() => view.fitAll(latest.current.layout)}
        >
          ALL
        </button>
        {shellControls ? (
          // The shell's More menu joins the camera group on the phone, so
          // Town has one set of floating controls.
          <button
            type="button"
            className="town-zoom-more"
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={shellControls.moreOpen}
            onClick={shellControls.toggleMore}
          >
            <EllipsisVertical size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const NO_CHROME = { left: 0, right: 0 };
