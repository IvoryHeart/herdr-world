import "../worldAsks.css";
import {
  findCell,
  zoomToRoom,
  zoomToBuilding,
  roomZoom,
  buildingZoom,
} from "./townCameraTargets";
import {
  NOTHING_VISIBLE,
  townVisibleHosts,
  type TownVisible,
} from "./townVisibleHosts";
import { TownBoard } from "./TownBoard";
import { TownTeamsLayer, TownWorldLayer } from "./TownWorldLayer";
import { TownBuildingSigns } from "./townBuildingSigns";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TownMoveResult } from "./townMoves";
import {
  TOWN_MAGNET_MS,
  townDragFor,
  townDropTarget,
  townMagnetDesk,
  type TownDrag,
} from "./townDrag";
import {
  initialGesture,
  stepGesture,
  waitsForHold,
  type GestureEffect,
  type GestureEvent,
} from "../interaction/gesture";
import {
  TOWN_GESTURES,
  TOWN_HOLD_MS,
  type TownGestureTarget,
} from "./townGesture";
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
import { townRoomFocus, type TownLevel } from "./townCamera";
import { townHitKey, townHitTest, type TownHit } from "./townHitTest";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townGeometryKey,
  townReflowShift,
  townSeat,
  townShapeFor,
  townShapeKey,
  type TownLayout,
  type TownShape,
} from "./townLayout";
import { TownScene } from "./scene/townScene";
import { townBrowserClock } from "./townBrowserClock";
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
  const [scene] = useState(
    () => new TownScene(townBrowserClock, () => wakeReflow((n) => n + 1)),
  );
  useEffect(() => () => scene.dispose(), [scene]);
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

  const anchorFrame = useRef<number | null>(null);
  const reportAnchors = () => {
    const { onAnchorChange: report, onSelectedAnchorChange: reportSelected } =
      latest.current;
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if ((!report && !reportSelected) || !renderer || !host) return;
    const rect = host.getBoundingClientRect();
    const camera = renderer.camera;
    const toAnchor = (
      world: { x: number; y: number } | null,
    ): WorldCanvasAnchor | null => {
      if (!world) return null;
      const screen = camera.toScreen(world.x, world.y);
      const x = rect.left + screen.x;
      const y = rect.top + screen.y;
      const visible =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      const edge: WorldCanvasAnchor["edge"] = visible
        ? null
        : x < rect.left
          ? "left"
          : x > rect.right
            ? "right"
            : y < rect.top
              ? "top"
              : "bottom";
      return {
        x: Math.min(rect.right - 10, Math.max(rect.left + 10, x)),
        y: Math.min(rect.bottom - 10, Math.max(rect.top + 10, y)),
        visible,
        edge,
      };
    };
    const worldAnchor = (key: string | null): WorldCanvasAnchors => {
      if (!key) return { agent: null, workbench: null };
      const { model: m, layout: l } = latest.current;
      const position = renderer.actorPosition(key);
      let agent: { x: number; y: number } | null = null;
      if (position) {
        if (position.seated) {
          const seat = m.agentSeats.get(key);
          const cell = seat && findCell(l, seat.deskKey);
          if (seat && cell) {
            const geometry = townSeat(cell, seat.seat);
            agent = {
              x: geometry.cx,
              y: geometry.top ? geometry.tableY + 6 : geometry.tableY + 40,
            };
          }
        } else agent = { x: position.x, y: position.y - 12 };
      }
      const deskKey = m.desks.has(key)
        ? key
        : (m.agentSeats.get(key)?.deskKey ?? m.devices.get(key)?.deskKey);
      const cell = deskKey ? findCell(l, deskKey) : null;
      const workbench = cell
        ? { x: (cell.x + 3) * T, y: cell.y * T + 28 }
        : null;
      return { agent: toAnchor(agent), workbench: toAnchor(workbench) };
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
    anchorFrame.current = requestAnimationFrame(() => {
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
  const lastCamera = useRef("");
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
  // Only on-screen buildings keep DOM cards, plaques and receptions.
  const [visible, setVisible] = useState<TownVisible>(NOTHING_VISIBLE);
  const visibleKey = useRef(NOTHING_VISIBLE.key);
  // The camera as last drawn. The canvas and its targets show this one until
  // the next frame, so presses are hit-tested against it: a pan not yet drawn
  // (an arrow key, an edge pan during a carry) must not move what is pressed.
  const drawnCamera = useRef({ x: 0, y: 0, z: 0, width: 0, height: 0 });
  /** Aims a carried desk or agent again at the frame just drawn. */
  const reaimCarry = useRef<(() => void) | null>(null);
  const onFrame = (camera: TownRendererHandle["camera"], level: TownLevel) => {
    const drawn = drawnCamera.current;
    const moved =
      drawn.x !== camera.x ||
      drawn.y !== camera.y ||
      drawn.z !== camera.z ||
      drawn.width !== camera.viewport.width ||
      drawn.height !== camera.viewport.height;
    drawn.x = camera.x;
    drawn.y = camera.y;
    drawn.z = camera.z;
    drawn.width = camera.viewport.width;
    drawn.height = camera.viewport.height;
    // A camera that moved under a still carry (an edge pan, an arrow key)
    // puts something else under it: the target follows what is now drawn.
    if (moved) reaimCarry.current?.();
    const layer = worldRef.current;
    const nextVisible = townVisibleHosts(camera, latest.current.layout, level);
    if (nextVisible.key !== visibleKey.current) {
      visibleKey.current = nextVisible.key;
      setVisible(nextVisible);
    }
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
    const signature = `${camera.x.toFixed(1)},${camera.y.toFixed(1)},${camera.z.toFixed(4)}`;
    const signatureChanged = signature !== lastCamera.current;
    if (signatureChanged) {
      lastCamera.current = signature;
      savedCameras.set(townShapeKey(latest.current.layout.shape), {
        x: camera.x,
        y: camera.y,
        z: camera.z,
      });
    }
    // Inspected agents walk under a still camera, so their lines follow every
    // drawn frame. World keeps unchanged anchors, so idle frames commit nothing.
    if (signatureChanged || latest.current.conversationTargets.length > 0)
      scheduleAnchors();
  };
  const onFrameRef = useRef(onFrame);

  onFrameRef.current = onFrame;

  const viewport = () => {
    const host = hostRef.current!;
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    const narrow = width < 640;
    return {
      width,
      height,
      inset: {
        top: narrow ? 12 : 16,
        right: narrow ? 12 : Math.max(72, latest.current.chrome.right),
        bottom: narrow ? 12 : 16,
        left: narrow ? 12 : Math.max(16, latest.current.chrome.left),
      },
    };
  };

  const frameHome = (
    renderer: TownRendererHandle,
    l: TownLayout,
    animate: boolean,
  ) => {
    const limits = renderer.camera.limits;
    if (!limits) return;
    const record = () => {
      const target = renderer.camera.flying ? null : renderer.camera;
      homePose.current = target
        ? { x: target.x, y: target.y, z: target.z }
        : null;
    };
    if (l.formFactor === "narrow") {
      const first = l.buildings[0];
      const x = (l.width * T) / 2;
      const focus = renderer.camera.focusPoint();
      const y = first
        ? first.y * T - 24 + (focus.y - viewport().inset.top) / limits.home
        : (l.height * T) / 2;
      if (animate) renderer.camera.flyTo(x, y, limits.home);
      else renderer.camera.jumpTo(x, y, limits.home);
    } else if (animate)
      renderer.camera.flyTo((l.width * T) / 2, (l.height * T) / 2, limits.home);
    else
      renderer.camera.jumpTo(
        (l.width * T) / 2,
        (l.height * T) / 2,
        limits.home,
      );
    if (!animate) record();
    else homePose.current = null;
    renderer.invalidate("home");
  };
  const homePose = useRef<{ x: number; y: number; z: number } | null>(null);
  const atHome = (renderer: TownRendererHandle) => {
    const home = homePose.current;
    const camera = renderer.camera;
    return (
      home !== null &&
      Math.abs(camera.z - home.z) < home.z * 0.01 &&
      Math.hypot(camera.x - home.x, camera.y - home.y) * camera.z < 4
    );
  };

  // Panels opening or closing re-frame the town only if it is still at home.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !hostRef.current) return;
    const wasHome = atHome(renderer);
    renderer.setViewport(viewport());
    if (wasHome) frameHome(renderer, latest.current.layout, false);
    // viewport() reads the latest chrome.
  }, [chrome.left, chrome.right]);

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
        renderer.setScene(m, l, sceneState());
        renderer.camera.configure(l, viewport());
        const saved = savedCameras.get(townShapeKey(l.shape));
        if (saved) {
          renderer.camera.x = saved.x;
          renderer.camera.y = saved.y;
          renderer.camera.setZoom(
            saved.z,
            renderer.camera.viewport.width / 2,
            renderer.camera.viewport.height / 2,
          );
        } else frameHome(renderer, l, false);
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
      if (anchorFrame.current !== null)
        cancelAnimationFrame(anchorFrame.current);
      latest.current.onAnchorChange?.(null);
      latest.current.onSelectedAnchorChange?.(null);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const shapeKey = townShapeKey(layout.shape);
    const shapeChanged =
      renderer.camera.limits !== null && shapeKey !== lastShape.current;
    const previous = lastLayout.current;
    renderer.setScene(model, layout, sceneState());
    renderer.camera.configure(layout, viewport());
    if (shapeChanged) {
      const saved = savedCameras.get(shapeKey);
      if (saved) renderer.camera.jumpTo(saved.x, saved.y, saved.z);
      else frameHome(renderer, layout, false);
    } else if (
      previous &&
      previous !== layout &&
      !renderer.camera.flying &&
      townGeometryKey(previous) !== townGeometryKey(layout)
    ) {
      // Rooms moved: follow the room in view, so it stays where it was.
      const camera = renderer.camera;
      const focus = camera.focusPoint();
      const shift = townReflowShift(
        previous,
        layout,
        camera.toWorld(focus.x, focus.y),
      );
      if (shift.x || shift.y) {
        const at = camera.toWorld(focus.x, focus.y);
        camera.jumpTo(at.x + shift.x, at.y + shift.y, camera.z);
        renderer.invalidate("reflow");
      }
    }
    lastShape.current = shapeKey;
    lastLayout.current = layout;
    scheduleAnchors();
  }, [model, layout]);
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
  const lastShape = useRef(townShapeKey(layout.shape));
  const lastLayout = useRef<TownLayout | null>(null);

  useEffect(() => {
    rendererRef.current?.setState(sceneState());
    scheduleAnchors();
  }, [selectedKey, hover, completionSeenKeys, summonedKeys, askingKeys, calm]);

  // Re-report after any render, so anchors World cleared come back. World
  // keeps unchanged anchors, so a report alone never renders again.
  useEffect(() => {
    scheduleAnchors();
  });

  /* ---------- pointer input ---------- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Pointer input runs through World's shared gesture machine; Town hit
    // tests the canvas and applies what it decides.
    let gesture = initialGesture<TownGestureTarget>();
    let holdTimer = 0;
    /** The desk or agent being carried, and where it would land. */
    let carrying: TownDrag | null = null;
    /** A desk the carried desk rests on: after a moment it snaps (groups). */
    let magnet: { key: string; timer: number; on: boolean } | null = null;
    const clearMagnet = () => {
      if (magnet) window.clearTimeout(magnet.timer);
      magnet = null;
    };
    const ghost = document.createElement("div");
    ghost.className = "town-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    let pinch: null | {
      distance: number;
      z: number;
      world: { x: number; y: number };
    } = null;
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hitAt = (x: number, y: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return null;
      const { layout: l, model: m } = latest.current;
      // Before the first frame nothing is drawn; the live camera is all there is.
      const shown = drawnCamera.current.z ? drawnCamera.current : null;
      const world = shown
        ? {
            x: shown.x + (x - shown.width / 2) / shown.z,
            y: shown.y + (y - shown.height / 2) / shown.z,
          }
        : renderer.camera.toWorld(x, y);
      return townHitTest(
        {
          layout: l,
          model: m,
          level: renderer.level,
          zoom: shown?.z ?? renderer.camera.z,
          roofAlpha: (hostKey) => renderer.roofAlpha(hostKey),
          standing: function* () {
            for (const agent of m.agents.values()) {
              const position = renderer.actorPosition(agent.key);
              if (position && !position.seated)
                yield { key: agent.key, hostKey: agent.hostKey, ...position };
            }
          },
        },
        world.x,
        world.y,
      );
    };
    // Where the carried desk or agent is, and the frame that pans the town
    // while it is held near an edge (rooms stack out of view on a phone).
    let carryAt: { x: number; y: number } | null = null;
    let edgeFrame = 0;
    /**
     * Show where the carry would land at screen point `at`. Resting on
     * another desk starts the magnet: after a moment it snaps (groups).
     */
    const carryTo = (at: { x: number; y: number }) => {
      if (!carrying || !rendererRef.current) return;
      carryAt = at;
      const hit = hitAt(at.x, at.y);
      const under = townMagnetDesk(carrying, hit, latest.current.model);
      if (under !== magnet?.key) {
        clearMagnet();
        if (under)
          magnet = {
            key: under,
            on: false,
            timer: window.setTimeout(() => {
              if (!magnet || !carrying || !carryAt) return;
              magnet.on = true;
              aim(hitAt(carryAt.x, carryAt.y), carryAt);
            }, TOWN_MAGNET_MS),
          };
      }
      aim(hit, at);
    };
    reaimCarry.current = () => {
      if (carryAt) carryTo(carryAt);
    };
    const EDGE = 56;
    const EDGE_SPEED = 14;
    const edgePan = () => {
      edgeFrame = 0;
      const renderer = rendererRef.current;
      if (!carrying || !carryAt || !renderer) return;
      const { width, height, inset } = renderer.camera.viewport;
      const push = (p: number, low: number, high: number) =>
        p < low + EDGE
          ? Math.min(1, (low + EDGE - p) / EDGE) * EDGE_SPEED
          : p > high - EDGE
            ? -Math.min(1, (p - high + EDGE) / EDGE) * EDGE_SPEED
            : 0;
      const dx = push(carryAt.x, inset.left, width - inset.right);
      const dy = push(carryAt.y, inset.top, height - inset.bottom);
      if (dx || dy) {
        renderer.camera.panBy(dx, dy);
        renderer.invalidate("edge-pan");
        carryTo(carryAt);
      }
      edgeFrame = requestAnimationFrame(edgePan);
    };
    const startDrag = (drag: TownDrag, at: { x: number; y: number }) => {
      carrying = drag;
      carryAt = at;
      cancelAnimationFrame(edgeFrame);
      edgeFrame = requestAnimationFrame(edgePan);
      latest.current.onHover?.(null);
      ghost.textContent = drag.label;
      ghost.dataset.valid = "false";
      ghost.style.transform = `translate(${at.x}px, ${at.y}px)`;
      host.append(ghost);
      const renderer = rendererRef.current;
      if (renderer) {
        const world = renderer.camera.toWorld(at.x, at.y);
        renderer.beginDrag(drag.kind, drag.key, world.x, world.y);
      }
    };
    const endDrag = () => {
      ghost.remove();
      clearMagnet();
      cancelAnimationFrame(edgeFrame);
      edgeFrame = 0;
      carryAt = null;
      const drag = carrying;
      carrying = null;
      return drag;
    };
    /** Show where the carried desk or agent would land, and snap to it. */
    const aim = (hit: TownHit | null, at: { x: number; y: number }) => {
      const renderer = rendererRef.current;
      if (!carrying || !renderer) return;
      const target = townDropTarget(
        carrying,
        hit,
        latest.current.model,
        latest.current.teams.deskTeams,
        magnet?.on ? magnet.key : null,
        latest.current.teams.groupedDesks,
      );
      carrying.target = target;
      ghost.textContent = target.label;
      ghost.dataset.valid = String(target.key !== null);
      ghost.dataset.action = target.action ?? "";
      ghost.style.transform = `translate(${at.x}px, ${at.y}px)`;
      const world = renderer.camera.toWorld(at.x, at.y);
      renderer.moveDrag(
        world.x,
        world.y,
        target.key,
        target.action === "group",
      );
    };
    const tap = (target: TownGestureTarget) => {
      const renderer = rendererRef.current;
      const hit = target.hit;
      if (!renderer || !hit) return;
      if (hit.kind === "building") {
        const building = latest.current.layout.buildings.find(
          (b) => b.hostKey === hit.key,
        );
        if (building && renderer.roofAlpha(building.hostKey) > 0.5) {
          zoomToBuilding(renderer, latest.current.layout, building.hostKey);
        }
        return;
      }
      if (hit.kind === "room" || hit.kind === "cell") {
        const roomKey = hit.kind === "room" ? hit.key : hit.roomKey;
        latest.current.onActivateRoom(roomKey);
        if (renderer.level !== "desk")
          zoomToRoom(renderer, latest.current.layout, roomKey);
        return;
      }
      const key = townHitKey(hit);
      if (key) latest.current.onSelect(key);
    };
    /** Carry out what the gesture machine decided. */
    const apply = (effect: GestureEffect<TownGestureTarget>) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      switch (effect.type) {
        case "stopCamera":
          renderer.camera.stop();
          return;
        case "panBy":
          latest.current.onHover?.(null);
          renderer.camera.panBy(effect.dx, effect.dy);
          renderer.invalidate("pan");
          return;
        case "fling":
          renderer.camera.release(effect.vx, effect.vy);
          renderer.invalidate("fling");
          return;
        case "pinchStart":
          pinch = {
            distance: effect.distance,
            z: renderer.camera.z,
            world: renderer.camera.toWorld(effect.mid.x, effect.mid.y),
          };
          return;
        case "pinch": {
          if (!pinch) return;
          const camera = renderer.camera;
          const z = camera.clampZoom(pinch.z * effect.scale);
          camera.setZoom(z, effect.mid.x, effect.mid.y);
          camera.x =
            pinch.world.x - (effect.mid.x - camera.viewport.width / 2) / z;
          camera.y =
            pinch.world.y - (effect.mid.y - camera.viewport.height / 2) / z;
          renderer.invalidate("pinch");
          return;
        }
        case "liftCard":
          if (!effect.target.drag) return;
          startDrag(effect.target.drag, effect.at);
          if (effect.held) navigator.vibrate?.(12);
          return;
        case "moveCard":
          carryTo(effect.at);
          return;
        case "dropCard": {
          // Judge the drop where it is released, against the frame drawn now.
          carryTo(effect.at);
          const drag = endDrag();
          const targetKey = drag?.target?.key;
          if (!drag || !targetKey) {
            renderer.endDrag("cancel");
            return;
          }
          // Wait at the target while Herdr moves it, then land or spring back.
          renderer.endDrag("park");
          const actions = latest.current.roomActions;
          const action = drag.target?.action;
          void (
            drag.kind === "agent"
              ? actions.onDropAgent(drag.key, targetKey)
              : action === "group"
                ? actions.onGroupDesk(drag.key, targetKey)
                : action === "ungroup"
                  ? actions.onUngroupDesk(drag.key)
                  : action === "reorder"
                    ? actions.onReorderDesk(
                        drag.key,
                        targetKey === drag.from ? null : targetKey,
                      )
                    : actions.onDropDesk(drag.key, targetKey)
          )
            .catch((): TownMoveResult => "uncertain")
            .then((result) => rendererRef.current?.finishMove(result));
          return;
        }
        case "settleCard":
          if (endDrag()) renderer.endDrag("cancel");
          return;
        case "tap":
          tap(effect.target);
          return;
        case "doubleTap": {
          const hit = effect.target.hit;
          const key = townHitKey(hit);
          if (
            hit &&
            (hit.kind === "agent" ||
              hit.kind === "desk" ||
              hit.kind === "pane") &&
            key
          )
            latest.current.onActivateAgent(key);
          else {
            renderer.camera.zoomAt(2, effect.at.x, effect.at.y);
            renderer.invalidate("zoom");
          }
          return;
        }
        default:
          // Lines, groups and picks are Board's; Town has none.
          return;
      }
    };
    const feed = (event: GestureEvent<TownGestureTarget>) => {
      const before = gesture.mode.name;
      const result = stepGesture(gesture, event, TOWN_GESTURES);
      gesture = result.state;
      // Town's targets are live hits and drags: trace a summary of each.
      if (DEVTOOLS)
        traceGesture(
          traceRef.current,
          before,
          gesture.mode.name,
          event,
          result.effects,
          (target) => ({
            hit: target.hit?.kind ?? null,
            key: TOWN_GESTURES.key(target),
            drag: Boolean(target.drag),
          }),
        );
      if (gesture.mode.name !== "pinching") pinch = null;
      for (const effect of result.effects) apply(effect);
    };
    const down = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        // A pointer the browser no longer tracks cannot be captured.
      }
      const point = local(event);
      const hit = hitAt(point.x, point.y);
      const target: TownGestureTarget = {
        hit,
        drag: townDragFor(hit, latest.current.model, renderer.level),
      };
      feed({
        type: "down",
        id: event.pointerId,
        at: point,
        time: performance.now(),
        target,
        primary: event.isPrimary,
        pointerType: event.pointerType,
      });
      // Touch: a desk or agent held still lifts; the machine ignores a hold
      // that comes after the finger moved or lifted.
      window.clearTimeout(holdTimer);
      if (waitsForHold(TOWN_GESTURES, target, event.pointerType)) {
        const id = event.pointerId;
        holdTimer = window.setTimeout(
          () => feed({ type: "hold", id, time: performance.now() }),
          TOWN_HOLD_MS,
        );
      }
    };
    const move = (event: PointerEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const point = local(event);
      if (gesture.pointers.has(event.pointerId)) {
        feed({
          type: "move",
          id: event.pointerId,
          at: point,
          time: performance.now(),
        });
        return;
      }
      // No press: a mouse hovering shows what is under it.
      if (event.pointerType !== "mouse" || gesture.pointers.size) return;
      const hit = hitAt(point.x, point.y);
      const key =
        hit?.kind === "building" ? `building:${hit.key}` : townHitKey(hit);
      if (key !== latest.current.hover) setHover(key);
      host.style.cursor = hit && hit.kind !== "building" ? "pointer" : "";
      const hoverKey = townHitKey(hit);
      latest.current.onHover?.(
        hoverKey
          ? { key: hoverKey, clientX: event.clientX, clientY: event.clientY }
          : null,
      );
    };
    const up = (event: PointerEvent) => {
      window.clearTimeout(holdTimer);
      if (!gesture.pointers.has(event.pointerId)) return;
      if (event.type === "pointercancel")
        feed({ type: "cancel", id: event.pointerId });
      else
        feed({
          type: "up",
          id: event.pointerId,
          at: local(event),
          time: performance.now(),
        });
    };
    const leave = () => {
      if (!gesture.pointers.size) {
        setHover(null);
        latest.current.onHover?.(null);
      }
    };
    const wheel = (event: WheelEvent) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      event.preventDefault();
      const point = local(event);
      renderer.camera.zoomAt(
        Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018)),
        point.x,
        point.y,
      );
      renderer.invalidate("wheel");
    };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      reaimCarry.current = null;
      window.clearTimeout(holdTimer);
      cancelAnimationFrame(edgeFrame);
      ghost.remove();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
    };
  }, []);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const renderer = rendererRef.current;
    if (!renderer || event.target !== event.currentTarget) return;
    const step = 60;
    const camera = renderer.camera;
    if (event.key === "ArrowLeft") camera.panBy(step, 0);
    else if (event.key === "ArrowRight") camera.panBy(-step, 0);
    else if (event.key === "ArrowUp") camera.panBy(0, step);
    else if (event.key === "ArrowDown") camera.panBy(0, -step);
    else if (event.key === "+" || event.key === "=")
      camera.zoomAt(1.3, camera.viewport.width / 2, camera.viewport.height / 2);
    else if (event.key === "-")
      camera.zoomAt(
        1 / 1.3,
        camera.viewport.width / 2,
        camera.viewport.height / 2,
      );
    else return;
    event.preventDefault();
    renderer.invalidate("keyboard");
  };

  const zoomBy = (factor: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.camera.zoomAt(
      factor,
      renderer.camera.viewport.width / 2,
      renderer.camera.viewport.height / 2,
    );
    renderer.invalidate("zoom");
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
    const renderer = rendererRef.current;
    const camera = renderer?.camera;
    if (!renderer || !camera?.limits) return;
    const limits = camera.limits;
    const l = latest.current.layout;
    const focus = camera.focusPoint();
    const at = camera.toWorld(focus.x, focus.y);
    const distance = (x: number, y: number, w: number, h: number) =>
      Math.hypot(
        Math.max(x * T - at.x, 0, at.x - (x + w) * T),
        Math.max(y * T - at.y, 0, at.y - (y + h) * T),
      );
    const building = [...l.buildings].sort(
      (a, b) =>
        distance(a.x, a.y, a.w, a.h + TOWN_FACADE) -
        distance(b.x, b.y, b.w, b.h + TOWN_FACADE),
    )[0];
    if (!building) return;
    const room = [...building.rooms].sort(
      (a, b) => distance(a.x, a.y, a.w, a.h) - distance(b.x, b.y, b.w, b.h),
    )[0];
    const cell = room
      ? [...room.cells]
          .filter((candidate) => candidate.deskKey)
          .sort(
            (a, b) => distance(a.x, a.y, 6, 4) - distance(b.x, b.y, 6, 4),
          )[0]
      : undefined;
    // Steps out to in: the whole town (when it differs from home, as on a
    // phone where home fits one building's width), home, the nearest
    // building, its nearest room and a desk.
    const whole = limits.all < limits.home * 0.93;
    const steps: { z: number; go(z: number): void }[] = [
      ...(whole
        ? [
            {
              z: limits.all,
              go: (z: number) =>
                camera.flyTo((l.width * T) / 2, (l.height * T) / 2, z),
            },
          ]
        : []),
      { z: limits.home, go: () => frameHome(renderer, l, true) },
      {
        // Stop where the building's room summaries show, as on a phone, so
        // the next step goes into a room.
        z: Math.min(buildingZoom(camera, building), limits.card * 0.95),
        go: (z) =>
          camera.flyTo(
            (building.x + building.w / 2) * T,
            (building.y + (building.h + TOWN_FACADE) / 2) * T,
            z,
            0.7,
          ),
      },
      ...(room
        ? [
            {
              z: roomZoom(camera, room),
              // A room larger than the view opens at its first desks, as
              // when its card is chosen.
              go: (z: number) => {
                const focus = townRoomFocus(room, camera.viewport, z);
                camera.flyTo(focus.x, focus.y, z, 0.6);
              },
            },
          ]
        : []),
      ...(cell
        ? [
            {
              z: Math.max(limits.desk * 1.2, limits.desk + 0.2),
              go: (z: number) =>
                camera.flyTo((cell.x + 3) * T, (cell.y + 2) * T, z, 0.6),
            },
          ]
        : []),
    ];
    for (let i = 1; i < steps.length; i += 1)
      steps[i]!.z = Math.min(
        limits.max,
        Math.max(steps[i]!.z, steps[i - 1]!.z * 1.2),
      );
    let step = 0;
    steps.forEach(({ z }, index) => {
      if (camera.z >= z * 0.93) step = index;
    });
    const next = step + direction;
    if (next < 0) {
      steps[0]!.go(steps[0]!.z);
      return;
    }
    if (next >= steps.length) {
      zoomBy(1.4);
      return;
    }
    steps[next]!.go(steps[next]!.z);
    renderer.invalidate("zoom-step");
  };

  const focusTarget = (target: TownTarget) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const camera = renderer.camera;
    const centre = camera.toScreen(
      target.rect.x + target.rect.width / 2,
      target.rect.y + target.rect.height / 2,
    );
    const { width, height } = camera.viewport;
    if (
      centre.x < 40 ||
      centre.y < 40 ||
      centre.x > width - 40 ||
      centre.y > height - 40 ||
      renderer.level === "town"
    ) {
      const z = Math.max(camera.z, camera.limits?.card ?? camera.z);
      camera.flyTo(
        target.rect.x + target.rect.width / 2,
        target.rect.y + target.rect.height / 2,
        z,
        0.4,
      );
      renderer.invalidate("focus");
    }
  };

  const zoomToRoomKey = (roomKey: string) => {
    const renderer = rendererRef.current;
    if (renderer) zoomToRoom(renderer, latest.current.layout, roomKey);
  };
  // A request waits for renderer setup and its admitted layout, then runs once.
  const consumedRoomFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!roomFocus || !ready || consumedRoomFocus.current === roomFocus.seq)
      return;
    const renderer = rendererRef.current;
    if (
      !renderer ||
      !layout.buildings.some((building) =>
        building.rooms.some((room) => room.key === roomFocus.roomKey),
      )
    )
      return;
    zoomToRoom(renderer, layout, roomFocus.roomKey);
    consumedRoomFocus.current = roomFocus.seq;
  }, [roomFocus, ready, layout]);

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
        <TownWorldLayer
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
          onClick={() => {
            const renderer = rendererRef.current;
            if (!renderer?.camera.limits) return;
            const l = latest.current.layout;
            renderer.camera.flyTo(
              (l.width * T) / 2,
              (l.height * T) / 2,
              renderer.camera.limits.all,
            );
            renderer.invalidate("fit");
          }}
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
