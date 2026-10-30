import { townReceptionVisitors } from "./townReception";
import "../worldAsks.css";
import { TownBuildingSign } from "./TownBuildingSign";
import { TownBuildingSigns } from "./townBuildingSigns";
import { ConnectionRecoveryBanner } from "../ConnectionRecoveryBanner";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { ChevronsLeft, ChevronsRight, Plus } from "lucide-react";
import {
  TOWN_DESK_EXPANSION_STEP,
  type HerdrOfficeProjection,
  type OfficeAgent,
} from "../herdrOfficeProjection";
import type {
  WorldCanvasAnchor,
  WorldCanvasAnchors,
  WorldCanvasHover,
  WorldConversationAnchors,
  WorldConversationAnchorTarget,
} from "../worldConnectorGeometry";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
  type OfficeObservability,
} from "../officeObservability";
import { townRoomFocus, type TownLevel } from "./townCamera";
import { townHitKey, townHitTest, type TownHit } from "./townHitTest";
import {
  layoutTown,
  TOWN_FACADE,
  TOWN_TILE as T,
  townDeskSlots,
  townGeometryKey,
  townReflowShift,
  townSeat,
  townShapeFor,
  townShapeKey,
  townPinCell,
  type TownLayout,
  type TownPlacementMemory,
  type TownShape,
} from "./townLayout";
import {
  townAttention,
  keepPlaceColors,
  NO_PLACE_COLORS,
  townDeskColors,
  townDeskPins,
  townModelFromProjection,
  townPlaceColors,
  type TownPlaceColors,
  townPinnedCells,
  type TownDeskPin,
  townRoomCounts,
  type TownModel,
} from "./townModel";
import type { TownSummary } from "./townSummary";
import { townCarpetFor, townCarpetOf } from "./townPaint";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import {
  createTownRenderer,
  nextTownTask,
  type TownRendererHandle,
} from "./townRenderer";
import { townPortrait } from "./townSprites";
import { townTargets, type TownTarget } from "./townTargets";
import { yieldWorldTask } from "../worldObject";
import {
  TERMINAL_COLOR_HEX,
  type TerminalColor,
  type TerminalColors,
} from "../terminalColor";
import { townTeams, type TownTeams } from "./townTeams";
import type { Relation } from "../../../../shared/relations";
import type { TerminalPlace } from "../relations";
import { placeDeskPin, type DeskPins } from "../useDeskPins";
import { useWorldSources } from "../worldSources";
import {
  sameTownBadges,
  townDeskBadges,
  type TownDeskBadge,
} from "./townBadges";
import { DeskWorkBadge } from "./DeskWorkBadge";
import { TownRoomPlaque } from "./TownRoomPlaque";
import { TownFoldIndicators } from "./TownFoldIndicators";
import {
  NO_FOLDED_ACTIVITY,
  townFoldedActivityLabel,
  type TownFoldedActivity,
} from "./townFoldedActivity";
import "./town.css";
import {
  markAway,
  TownQuestPennant,
  type TownQuestMark,
} from "./townQuestPennant";
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

/**
 * A reflow that moves rooms or buildings waits this long after the user's last
 * press, scroll or zoom, so the town does not shift under a hand or eye.
 */
const REFLOW_IDLE_MS = 1200;

const portrait = townPortrait;
const NO_COLORS: TerminalColors = {};
const NO_RELATIONS = { relations: [], places: new Map() };
const NO_PINS: DeskPins = {};
const NO_KEYS: ReadonlySet<string> = new Set();
const NO_QUESTS: ReadonlyMap<string, TownQuestMark> = new Map();

function ago(since: number, now: number) {
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;
}

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
  const badgesRef = useRef<ReadonlyMap<string, TownDeskBadge>>(new Map());
  const deskBadges = useMemo(() => {
    const next = townDeskBadges(projection, sources);
    if (!sameTownBadges(next, badgesRef.current)) badgesRef.current = next;
    return badgesRef.current;
  }, [projection, sources]);
  // The town's shape follows its container, measured on every resize.
  const [shape, setShape] = useState<TownShape>(() =>
    typeof window !== "undefined"
      ? townShapeFor(window.innerWidth, window.innerHeight)
      : townShapeFor(1440, 900),
  );
  const memoryRef = useRef<{ shape: string; memory: TownPlacementMemory }>({
    shape: townShapeKey(shape),
    memory: new Map(),
  });
  const topology = useMemo(
    () => townModelFromProjection(projection),
    [projection],
  );
  // Colours ride on the model but not its layout input: a new colour repaints
  // tables without placing the town again.
  const lastDeskColors = useRef<ReadonlyMap<string, TerminalColor>>(new Map());
  const lastPlaceColors = useRef<TownPlaceColors>(NO_PLACE_COLORS);
  const colouredModel = useMemo(() => {
    // The same colours keep the same map, so status updates never rebuild.
    const next = townDeskColors(projection, terminalColors);
    const last = lastDeskColors.current;
    if (
      next.size !== last.size ||
      [...next].some(([key, color]) => last.get(key) !== color)
    )
      lastDeskColors.current = next;
    lastPlaceColors.current = keepPlaceColors(
      lastPlaceColors.current,
      townPlaceColors(projection, terminalColors),
    );
    return {
      ...topology,
      deskColors: lastDeskColors.current,
      placeColors: lastPlaceColors.current,
    };
  }, [topology, projection, terminalColors]);
  // Pins ride on the model too; the same pins keep the same map.
  const lastDeskPins = useRef<ReadonlyMap<string, TownDeskPin>>(new Map());
  const model = useMemo(() => {
    const next = townDeskPins(projection, deskPins);
    const last = lastDeskPins.current;
    if (
      next.size !== last.size ||
      [...next].some(([key, pin]) => {
        const was = last.get(key);
        return (
          !was ||
          was.key !== pin.key ||
          was.cell?.col !== pin.cell?.col ||
          was.cell?.row !== pin.cell?.row
        );
      })
    )
      lastDeskPins.current = next;
    return { ...colouredModel, deskPins: lastDeskPins.current };
  }, [colouredModel, projection, deskPins]);
  const pinnedCells = useMemo(
    () => townPinnedCells(model.deskPins),
    [model.deskPins],
  );
  const placed = useMemo(() => {
    const key = townShapeKey(shape);
    const previous =
      memoryRef.current.shape === key ? memoryRef.current.memory : new Map();
    const result = layoutTown(model.input, shape, previous, pinnedCells);
    memoryRef.current = { shape: key, memory: result.memory };
    return result.layout;
    // Placement depends only on topology and pins, not on agent status.
  }, [model.input, shape, pinnedCells]);
  // While the user presses, scrolls or zooms, a reflow that would move rooms
  // or buildings waits until they pause (then the camera follows the room in
  // view). Explicit Fold/Expand applies immediately; its admission and revision
  // arrive in the same render. A held layout must still name only valid desks.
  const inputAt = useRef(0);
  const pressing = useRef(false);
  const shownLayout = useRef<TownLayout | null>(null);
  const appliedFoldRevision = useRef(foldRevision);
  useEffect(() => {
    appliedFoldRevision.current = foldRevision;
  }, [foldRevision]);
  const [, wakeReflow] = useState(0);
  const held = shownLayout.current;
  const holding =
    foldRevision === appliedFoldRevision.current &&
    held !== null &&
    held !== placed &&
    townShapeKey(held.shape) === townShapeKey(placed.shape) &&
    (pressing.current ||
      performance.now() - inputAt.current < REFLOW_IDLE_MS) &&
    townGeometryKey(held) !== townGeometryKey(placed) &&
    held.buildings.every((b) =>
      b.rooms.every((r) =>
        r.cells.every((c) => !c.deskKey || model.desks.has(c.deskKey)),
      ),
    );
  const layout = holding ? held : placed;
  shownLayout.current = layout;
  useEffect(() => {
    if (!holding) return;
    const timer = window.setTimeout(
      () => wakeReflow((n) => n + 1),
      REFLOW_IDLE_MS / 3,
    );
    return () => window.clearTimeout(timer);
  });
  const teams = useMemo(
    () => townTeams(model, layout, relations.relations, relations.places),
    [model, layout, relations],
  );
  // A desk just pinned keeps the cell it has; save it so it stays there.
  const placing = useRef(new Set<string>());
  useEffect(() => {
    for (const [deskKey, pin] of model.deskPins) {
      if (pin.cell || placing.current.has(pin.key)) continue;
      const cell = townPinCell(layout, placed, deskKey);
      if (!cell) continue;
      placing.current.add(pin.key);
      void placeDeskPin(pin.key, { col: cell.col, row: cell.row }).finally(() =>
        placing.current.delete(pin.key),
      );
    }
  }, [layout, placed, model.deskPins]);
  const blockedSince = useRef(new Map<string, number>());
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

  // Track when agents became blocked so reception and the rail share age order.
  const now = Date.now();
  for (const agent of model.agents.values()) {
    if (agent.semanticStatus === "blocked") {
      if (!blockedSince.current.has(agent.key))
        blockedSince.current.set(agent.key, now);
    } else blockedSince.current.delete(agent.key);
  }

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
    if (signature !== lastCamera.current) {
      lastCamera.current = signature;
      savedCameras.set(townShapeKey(latest.current.layout.shape), {
        x: camera.x,
        y: camera.y,
        z: camera.z,
      });
      scheduleAnchors();
    }
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
      (camera, level) => onFrameRef.current(camera, level),
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
    const touch = () => {
      inputAt.current = performance.now();
    };
    const down = () => {
      pressing.current = true;
      touch();
    };
    const up = () => {
      pressing.current = false;
      touch();
    };
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
  }, []);
  const lastShape = useRef(townShapeKey(layout.shape));
  const lastLayout = useRef<TownLayout | null>(null);

  useEffect(() => {
    rendererRef.current?.setState(sceneState());
    scheduleAnchors();
  }, [selectedKey, hover, completionSeenKeys, summonedKeys, askingKeys, calm]);

  useEffect(() => {
    scheduleAnchors();
  }, [conversationTargets]);

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
          teams={teams}
          model={model}
          layout={layout}
          visible={visible}
          signs={signs}
          onHoverEntry={hoverEntry}
          selectedKey={selectedKey}
          blockedSince={blockedSince.current}
          roomActions={roomActions}
          selectedRoomKey={selectedRoomKey}
          onSelect={onSelect}
          onActivate={onActivateAgent}
          onActivateRoom={(key) => {
            onActivateRoom(key);
            zoomToRoomKey(key);
          }}
          onFocusTarget={focusTarget}
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

function findCell(layout: TownLayout, deskKey: string) {
  const at = layout.deskCells.get(deskKey);
  if (!at) return null;
  for (const building of layout.buildings)
    for (const room of building.rooms)
      if (room.key === at.roomKey) return room.cells[at.cellIndex] ?? null;
  return null;
}

function zoomToRoom(
  renderer: TownRendererHandle,
  layout: TownLayout,
  roomKey: string,
) {
  const room = layout.buildings
    .flatMap((b) => b.rooms)
    .find((r) => r.key === roomKey);
  if (!room) return;
  const camera = renderer.camera;
  const z = roomZoom(camera, room);
  const focus = townRoomFocus(room, camera.viewport, z);
  camera.flyTo(focus.x, focus.y, z, 0.6);
  renderer.invalidate("room");
}

function zoomToBuilding(
  renderer: TownRendererHandle,
  layout: TownLayout,
  hostKey: string,
) {
  const building = layout.buildings.find((b) => b.hostKey === hostKey);
  if (!building) return;
  const camera = renderer.camera;
  const z = buildingZoom(camera, building);
  camera.flyTo(
    (building.x + building.w / 2) * T,
    (building.y + (building.h + TOWN_FACADE) / 2) * T,
    z,
    0.8,
  );
  renderer.invalidate("building");
}

type TownCameraHandle = TownRendererHandle["camera"];

function roomZoom(
  camera: TownCameraHandle,
  room: TownLayout["buildings"][number]["rooms"][number],
) {
  const { width, height, inset } = camera.viewport;
  const fit = Math.min(
    (width - inset.left - inset.right - 60) / (room.w * T + 40),
    (height - inset.top - inset.bottom - 20) / (room.h * T + 40),
  );
  const limits = camera.limits;
  return Math.max(Math.min(fit, 3), limits ? limits.card * 1.05 : 0.7);
}

function buildingZoom(
  camera: TownCameraHandle,
  building: TownLayout["buildings"][number],
) {
  const { width, height, inset } = camera.viewport;
  const usableWidth = width - inset.left - inset.right - 40;
  const widthFit = usableWidth / (building.w * T + 40);
  const fit = Math.min(
    widthFit,
    (height - inset.top - inset.bottom - 10) /
      ((building.h + TOWN_FACADE) * T + 30),
  );
  // Phones already open at a building's width; a building step fills the width.
  const z = width < 640 ? widthFit : fit;
  return Math.max(z, (camera.limits?.roof ?? 0) * 1.06);
}

const NO_CHROME = { left: 0, right: 0 };

/* ---------- DOM world layer ---------- */

type TownVisible = {
  key: string;
  hosts: ReadonlySet<string>;
  /** Room cards are drawn only from the overview level up to the room level. */
  cards: boolean;
  /** Rooms on screen whose desks carry name tags (room and desk levels). */
  tagRooms: ReadonlySet<string>;
};

const NOTHING_VISIBLE: TownVisible = {
  key: "",
  hosts: new Set(),
  cards: false,
  tagRooms: new Set(),
};

/** Buildings within half a viewport of the screen, plus whether cards show. */
function townVisibleHosts(
  camera: TownRendererHandle["camera"],
  layout: TownLayout,
  level: TownLevel,
): TownVisible {
  const { width, height } = camera.viewport;
  const left = camera.toWorld(-width / 2, -height / 2);
  const right = camera.toWorld(width * 1.5, height * 1.5);
  const hosts: string[] = [];
  for (const b of layout.buildings)
    if (
      b.x * T < right.x &&
      (b.x + b.w) * T > left.x &&
      (b.y - 2) * T < right.y &&
      (b.y + b.h + TOWN_FACADE + 8) * T > left.y
    )
      hosts.push(b.hostKey);
  const cards = level === "overview" || level === "room";
  // Name tags only for rooms on screen, so a large town adds few elements.
  const tagRooms: string[] = [];
  if (level === "room" || level === "desk") {
    const from = camera.toWorld(0, 0);
    const to = camera.toWorld(width, height);
    for (const b of layout.buildings)
      for (const room of b.rooms)
        if (
          room.x * T < to.x &&
          (room.x + room.w) * T > from.x &&
          room.y * T < to.y &&
          (room.y + room.h) * T > from.y
        )
          tagRooms.push(room.key);
  }
  return {
    key: `${cards ? 1 : 0}:${hosts.join("\u0000")}:${tagRooms.join("\u0000")}`,
    hosts: new Set(hosts),
    cards,
    tagRooms: new Set(tagRooms),
  };
}

/** Team walls and connectors, under the world layer's cards. */
const TownTeamsLayer = memo(function TownTeamsLayer({
  teams,
}: {
  teams: TownTeams;
}) {
  if (!teams.walls.length && !teams.links.length) return null;
  return (
    <svg className="town-teams" aria-hidden="true" data-testid="town-teams">
      {teams.walls.map((wall) => (
        <rect
          key={wall.key}
          className="town-team-wall"
          data-team={wall.team}
          data-current={String(wall.current)}
          data-desks={wall.desks}
          x={wall.x}
          y={wall.y}
          width={wall.w}
          height={wall.h}
          rx={10}
          style={{ stroke: TERMINAL_COLOR_HEX[wall.color] }}
        />
      ))}
      {teams.links.map((link) => (
        <line
          key={link.key}
          className="town-team-link"
          data-kind={link.kind}
          data-current={String(link.current)}
          x1={link.x1}
          y1={link.y1}
          x2={link.x2}
          y2={link.y2}
        />
      ))}
    </svg>
  );
});
const TownWorldLayer = memo(function TownWorldLayer({
  model,
  foldedActivity,
  askingKeys,
  onActivateAsk,
  layout,
  teams,
  selectedKey,
  blockedSince,
  roomActions,
  selectedRoomKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
  visible,
  onHoverEntry,
  deskBadges,
  quests,
  renderer,
  pennants,
  signs,
}: {
  signs: TownBuildingSigns;
  model: TownModel;
  askingKeys: ReadonlySet<string>;
  onActivateAsk?: (nodeId: string) => void;
  foldedActivity: ReadonlyMap<string, TownFoldedActivity>;
  layout: TownLayout;
  teams: TownTeams;
  visible: TownVisible;
  /** Pull request or ticket chips for desks (World sources). */
  deskBadges: ReadonlyMap<string, TownDeskBadge>;
  /** Quests by agent key, as pennants at their seats. */
  quests: ReadonlyMap<string, TownQuestMark>;
  /** Tells a pennant whether its agent is seated. */
  renderer: { readonly current: TownRendererHandle | null };
  pennants: Set<HTMLElement>;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
  selectedKey: string | null;
  blockedSince: ReadonlyMap<string, number>;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  const targets = useMemo(
    () => townTargets(model, layout, teams.deskTeams),
    [model, layout, teams.deskTeams],
  );
  const terminalAsksByHost = useMemo(() => {
    type Device = (typeof model.projection.paneRoster)[number]["device"];
    const byHost = new Map<string, Device[]>();
    if (!askingKeys.size) return byHost;
    for (const { device } of model.projection.paneRoster) {
      if (device.agentKey || !askingKeys.has(device.nodeId)) continue;
      const group = byHost.get(device.hostKey) ?? [];
      group.push(device);
      byHost.set(device.hostKey, group);
    }
    return byHost;
  }, [model.projection.paneRoster, askingKeys]);
  const attention = townAttention(model, blockedSince, askingKeys);
  const now = Date.now();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!attention.length) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 15_000);
    return () => window.clearInterval(timer);
  }, [attention.length]);
  const selectedHost = selectedRoomKey
    ? model.rooms.get(selectedRoomKey)?.hostKey
    : undefined;
  /** A room's carpet: its workspace's chosen colour, else its own default. */
  const roomCarpet = (roomKey: string) => {
    const chosen = model.placeColors.rooms.get(roomKey);
    return chosen
      ? townCarpetOf(TERMINAL_COLOR_HEX[chosen])
      : townCarpetFor(roomKey);
  };
  const newRoomBuilding =
    layout.buildings.find((b) => b.hostKey === selectedHost) ??
    layout.buildings[0];
  return (
    <>
      {layout.buildings.map((building) => {
        if (!visible.hosts.has(building.hostKey)) return null;
        const host = model.hosts.get(building.hostKey);
        const hostColor = roomActions.placeColor("host", building.hostKey);
        const queue = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            agent.semanticStatus === "blocked",
        );
        const questions = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            askingKeys.has(agent.key) &&
            agent.semanticStatus !== "blocked",
        );
        const terminalQuestions =
          terminalAsksByHost.get(building.hostKey) ?? [];
        const questionCount = questions.length + terminalQuestions.length;
        // Questions and finished agents wait after urgent blocked agents.
        const agentVisitors = attention.filter(
          (agent) =>
            agent.hostKey === building.hostKey &&
            (agent.semanticStatus === "blocked" ||
              agent.semanticStatus === "done" ||
              askingKeys.has(agent.key)),
        );
        const visitors = townReceptionVisitors(
          agentVisitors,
          terminalQuestions,
          askingKeys,
        );
        const shown = visitors.slice(0, 6);
        const counts = building.rooms.reduce(
          (sum, placed) => {
            const room = model.rooms.get(placed.key);
            if (!room) return sum;
            const c = townRoomCounts(model, room);
            return {
              rooms: sum.rooms + 1,
              desks: sum.desks + c.desks,
              working: sum.working + c.working,
            };
          },
          { rooms: 0, desks: 0, working: 0 },
        );
        return (
          <div
            key={building.hostKey}
            className="town-building-layer"
            data-stale={host?.stale || undefined}
          >
            <TownBuildingSign
              hostKey={building.hostKey}
              signs={signs}
              left={(building.x + building.w / 2) * T}
              top={(building.y + building.h * 0.38) * T}
            >
              <strong>{host?.displayLabel ?? building.hostKey}</strong>
              {host?.stale ? (
                <ConnectionRecoveryBanner
                  connectionId={host.connectionId}
                  label={host.displayLabel}
                  state={host.runtimeState}
                />
              ) : (
                <span>{`${counts.rooms} rooms · ${counts.desks} desks · ${counts.working} working`}</span>
              )}
              {queue.length ? (
                <em aria-label={`${queue.length} need you`}>!{queue.length}</em>
              ) : null}
              {questionCount ? (
                <em
                  className="town-reception-question"
                  aria-label={`${questionCount} owner questions`}
                >
                  ?{questionCount}
                </em>
              ) : null}
            </TownBuildingSign>
            <div
              className={`town-reception${queue.length ? " town-reception-busy" : ""}`}
              data-stale={host?.stale || undefined}
              style={{
                left: building.doorX * T,
                top: (building.y + building.h + TOWN_FACADE) * T + 6,
              }}
              role="group"
              aria-label={`${host?.displayLabel ?? "Host"} reception, ${queue.length} waiting`}
            >
              <div className="town-reception-title">
                {hostColor ? (
                  <ColorSwatchButton
                    className="town-place-color"
                    label={`Colour of ${host?.displayLabel ?? "host"}'s building`}
                    {...hostColor}
                  />
                ) : null}
                <span>
                  {(host?.displayLabel ?? "").toUpperCase()} RECEPTION
                </span>
                {queue.length ? <b>{queue.length}</b> : null}
              </div>
              {host?.stale ? (
                <ConnectionRecoveryBanner
                  connectionId={host.connectionId}
                  label={host.displayLabel}
                  state={host.runtimeState}
                />
              ) : null}
              {visitors.length ? (
                <div className="town-reception-queue">
                  {shown.map((agent) =>
                    "semanticStatus" in agent ? (
                      <ReceptionEntry
                        key={agent.key}
                        agent={agent}
                        asking={askingKeys.has(agent.key)}
                        since={blockedSince.get(agent.key) ?? now}
                        now={now}
                        selected={selectedKey === agent.key}
                        onSelect={onSelect}
                        onActivate={onActivate}
                        onHoverEntry={onHoverEntry}
                      />
                    ) : (
                      <button
                        key={agent.key}
                        type="button"
                        className="town-reception-entry"
                        data-owner-question="true"
                        data-owner-question-terminal={agent.nodeId}
                        aria-label={`${agent.displayLabel}, owner question`}
                        disabled={agent.stale || !agent.canOpenInSpaces}
                        onClick={() => onActivateAsk?.(agent.nodeId)}
                      >
                        <img
                          src={portrait(agent.key)}
                          alt=""
                          width={28}
                          height={40}
                        />
                        <span>{agent.displayLabel}</span>
                        <small>? Owner wanted</small>
                      </button>
                    ),
                  )}
                  {visitors.length > shown.length ? (
                    <span className="town-reception-more">
                      +{visitors.length - shown.length}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="town-reception-empty">Nobody waiting</div>
              )}
            </div>
            {building.rooms.map((placed) => {
              const room = model.rooms.get(placed.key);
              if (!room) return null;
              const c = townRoomCounts(model, room);
              const label = room.accessibleLabel ?? room.displayLabel;
              const total = Math.max(1, c.agents);
              const seatCell =
                placed.foldActionCells?.[0] ??
                placed.cells.find((cell) => !cell.deskKey);
              const foldCell = placed.foldActionCells?.[1];
              const overflow =
                room.omittedDeskCount + placed.overflowDeskKeys.length;
              const revealCount = Math.min(TOWN_DESK_EXPANSION_STEP, overflow);
              const activity = foldedActivity.get(room.key);
              const activityLabel = townFoldedActivityLabel(activity);
              const partiallyExpanded =
                room.deskFold === "expanded" && overflow > 0;
              const revealDescription =
                overflow > TOWN_DESK_EXPANSION_STEP
                  ? `Show up to ${revealCount} more hidden ${revealCount === 1 ? "desk" : "desks"}`
                  : `Show the remaining ${overflow} hidden ${overflow === 1 ? "desk" : "desks"}`;
              const reason = roomActions.createSeatReason(room.key);
              const roomColor = roomActions.placeColor("room", room.key);
              return (
                <div
                  key={room.key}
                  className="town-room"
                  style={{
                    left: placed.x * T,
                    top: placed.y * T,
                    width: placed.w * T,
                    height: placed.h * T,
                  }}
                >
                  {visible.cards ? (
                    <button
                      type="button"
                      className={`town-room-card${c.blocked ? " town-room-card-waiting" : ""}${selectedKey === room.key ? " town-selected" : ""}`}
                      style={
                        {
                          "--room-w": `${placed.w * T}px`,
                          "--carpet": roomCarpet(room.key),
                        } as React.CSSProperties
                      }
                      aria-label={`${label}: ${c.desks} desks, ${c.working} working${c.blocked ? `, ${c.blocked} need you` : ""}${c.done ? `, ${c.done} done` : ""}. Zoom in.`}
                      onClick={() => onActivateRoom(room.key)}
                      tabIndex={-1}
                    >
                      <span className="town-room-card-name">{label}</span>
                      {c.blocked ? (
                        <span className="town-room-card-badge">
                          !{c.blocked}
                        </span>
                      ) : null}
                      <span className="town-room-card-meta">
                        {c.desks} desks · {c.working} working
                        {overflow ? ` · +${overflow} more` : ""}
                      </span>
                      <span className="town-room-card-bar" aria-hidden="true">
                        {(["working", "blocked", "done", "idle"] as const).map(
                          (status) =>
                            c[status] ? (
                              <i
                                key={status}
                                data-status={status}
                                style={{ flexGrow: c[status] / total }}
                              />
                            ) : null,
                        )}
                      </span>
                    </button>
                  ) : null}
                  {visible.tagRooms.has(room.key)
                    ? placed.cells.map((cell) => {
                        const desk = cell.deskKey
                          ? model.desks.get(cell.deskKey)
                          : undefined;
                        if (!desk) return null;
                        return (
                          <div
                            key={desk.key}
                            className="town-desk-tags"
                            style={
                              {
                                left: (cell.x + 1 - placed.x) * T,
                                top: (cell.y - placed.y) * T,
                                "--desk-color":
                                  TERMINAL_COLOR_HEX[
                                    model.deskColors.get(desk.key) ?? "blue"
                                  ],
                              } as React.CSSProperties
                            }
                          >
                            {desk.appearanceStatus ? (
                              <span
                                className="town-appearance-status"
                                title={desk.appearanceStatus}
                              >
                                {desk.appearanceStatus}
                              </span>
                            ) : null}
                            <span className="town-desk-tag">
                              <span
                                className="town-desk-name"
                                aria-hidden="true"
                              >
                                {desk.displayLabel}
                              </span>
                              <DeskWorkBadge
                                badge={deskBadges.get(desk.key)}
                                deskLabel={desk.displayLabel}
                              />
                            </span>
                            {desk.observedPaneCount >
                            desk.paneDevices.length ? (
                              <button
                                type="button"
                                className="town-desk-more"
                                aria-label={`All ${desk.observedPaneCount} panes at ${desk.displayLabel}`}
                                onClick={() =>
                                  roomActions.onChoosePanes(desk.key)
                                }
                              >
                                +
                                {desk.observedPaneCount -
                                  desk.paneDevices.length}
                              </button>
                            ) : null}
                            {townDeskSlots(cell.seats).map((slot, seat) => {
                              const device = desk.paneDevices[seat];
                              const quest = device?.agentKey
                                ? quests.get(device.agentKey)
                                : undefined;
                              return device ? (
                                <Fragment key={device.key}>
                                  <span
                                    aria-hidden="true"
                                    className={`town-seat-tag${slot.top ? " town-seat-tag-top" : ""}${device.agentKey ? "" : " town-seat-tag-shell"}`}
                                    style={{ left: slot.chairX + 7 }}
                                  >
                                    {device.displayLabel}
                                  </span>
                                  {quest ? (
                                    <TownQuestPennant
                                      quest={quest}
                                      agentKey={device.agentKey!}
                                      agentLabel={device.displayLabel}
                                      renderer={renderer}
                                      pennants={pennants}
                                      top={slot.top}
                                      x={slot.chairX + 7}
                                    />
                                  ) : null}
                                </Fragment>
                              ) : null;
                            })}
                          </div>
                        );
                      })
                    : null}
                  <TownRoomPlaque
                    room={room}
                    label={label}
                    width={placed.w * T}
                    counts={c}
                    color={
                      roomColor && {
                        defaultHex: townCarpetFor(room.key),
                        ...roomColor,
                      }
                    }
                    actions={roomActions}
                  />
                  {roomActions.showCreateSeat(room.key) && seatCell ? (
                    <>
                      <button
                        className="world-new-seat-canvas-action town-new-seat"
                        type="button"
                        aria-label={`New agent or terminal in ${label}`}
                        title={reason ?? `New agent or terminal in ${label}`}
                        disabled={!roomActions.canCreateSeat(room.key)}
                        style={{
                          left: (seatCell.x - placed.x + 1) * T,
                          top: (seatCell.y - placed.y) * T + 4,
                          ...(partiallyExpanded ? { width: 40 } : {}),
                        }}
                        onClick={() => roomActions.onNewAgent(room.key)}
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                      {reason ? (
                        <span
                          className="world-creation-reason town-creation-reason"
                          role="status"
                          style={{
                            left: (seatCell.x - placed.x + 1) * T,
                            top: (seatCell.y - placed.y) * T + 60,
                          }}
                        >
                          {reason}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {room.deskFold &&
                  foldCell &&
                  roomActions.onToggleFold &&
                  (room.deskFold === "expanded" || overflow > 0) ? (
                    <button
                      className="town-new-seat town-fold-tile"
                      type="button"
                      aria-expanded={room.deskFold === "expanded"}
                      aria-label={
                        overflow > 0
                          ? `${revealDescription} in ${label}${activityLabel ? `. ${activityLabel}` : ""}`
                          : `Fold ${label} back to 24 desks`
                      }
                      title={
                        overflow > 0
                          ? `${revealDescription}${activityLabel ? `. ${activityLabel}` : ""}`
                          : "Fold this room back to 24 desks"
                      }
                      style={{
                        left:
                          partiallyExpanded && seatCell
                            ? (seatCell.x - placed.x + 1) * T + 44
                            : (foldCell.x - placed.x + 1) * T,
                        top: (foldCell.y - placed.y) * T + 4,
                        display: "flex",
                        width: partiallyExpanded ? 64 : 72,
                        justifyContent: "center",
                        gap: 3,
                      }}
                      onClick={() =>
                        roomActions.onToggleFold?.(
                          room.key,
                          overflow > 0
                            ? Math.min(
                                room.observedDeskCount,
                                room.desks.length + TOWN_DESK_EXPANSION_STEP,
                              )
                            : undefined,
                        )
                      }
                    >
                      {overflow > 0 ? (
                        <>
                          <ChevronsRight size={16} aria-hidden="true" />
                          <span>+{overflow}</span>
                        </>
                      ) : (
                        <>
                          <ChevronsLeft size={16} aria-hidden="true" />
                          <span>Fold</span>
                        </>
                      )}
                      <TownFoldIndicators activity={activity} />
                    </button>
                  ) : null}
                  {partiallyExpanded && seatCell && roomActions.onToggleFold ? (
                    <button
                      className="town-new-seat town-fold-reset"
                      type="button"
                      aria-label={`Fold ${label} back to 24 desks`}
                      title="Fold this room back to 24 desks"
                      style={{
                        left: (seatCell.x - placed.x + 1) * T + 112,
                        top: (seatCell.y - placed.y) * T + 4,
                        width: 40,
                      }}
                      onClick={() => roomActions.onToggleFold?.(room.key)}
                    >
                      <ChevronsLeft size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
      {roomActions.showCreateRoom(selectedRoomKey) && newRoomBuilding ? (
        <div
          className="town-new-room-wrap"
          style={{
            left: (newRoomBuilding.x + 18) * T,
            top: (newRoomBuilding.y + 3) * T,
          }}
        >
          <button
            className="world-new-room-canvas-action town-new-room"
            type="button"
            aria-label="New room"
            title={
              roomActions.createRoomReason(selectedRoomKey) ??
              "Create a new Herdr workspace"
            }
            disabled={!roomActions.canCreateRoom(selectedRoomKey)}
            onClick={() => roomActions.onCreateRoom(selectedRoomKey)}
          >
            <Plus size={16} strokeWidth={3} aria-hidden="true" />
            <span>New room</span>
          </button>
          {roomActions.createRoomReason(selectedRoomKey) ? (
            <span className="world-creation-reason" role="status">
              {roomActions.createRoomReason(selectedRoomKey)}
            </span>
          ) : null}
        </div>
      ) : null}
      <TownTargets
        targets={targets}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onActivate={onActivate}
        onActivateRoom={onActivateRoom}
        onFocusTarget={onFocusTarget}
        onMoveTarget={(kind, key) =>
          kind === "desk"
            ? roomActions.onMoveDesk(key)
            : roomActions.onMoveAgent(key)
        }
      />
    </>
  );
});

const TARGET_BATCH = 16;

/** Accessible targets, admitted in batches so dense scenes keep input responsive. */
function TownTargets({
  targets,
  selectedKey,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
  onMoveTarget,
}: {
  targets: readonly TownTarget[];
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
  /** Keyboard move (key M) for a focused desk or agent target. */
  onMoveTarget(kind: "desk" | "agent", key: string): void;
}) {
  const identity = useMemo(
    () => targets.map(({ kind, key }) => `${kind}:${key}`).join("|"),
    [targets],
  );
  const [progress, setProgress] = useState<{
    identity: string;
    limit: number;
  } | null>(null);
  const limit = progress?.identity === identity ? progress.limit : TARGET_BATCH;
  const admitted = useRef(new Set<string>());
  const rendered = targets.filter(
    (target, index) =>
      index < limit ||
      target.key === selectedKey ||
      admitted.current.has(`${target.kind}:${target.key}`),
  );
  useLayoutEffect(() => {
    admitted.current = new Set(
      rendered.map(({ kind, key }) => `${kind}:${key}`),
    );
  });
  const pending = targets.length - rendered.length;
  useEffect(() => {
    if (!pending) return;
    let current = true;
    void yieldWorldTask().then(() => {
      if (current) setProgress({ identity, limit: limit + TARGET_BATCH });
    });
    return () => {
      current = false;
    };
  }, [identity, limit, pending]);
  return (
    <div
      className="world-semantic-targets-overlay town-targets"
      aria-label="Office scene targets"
      aria-busy={pending > 0}
      onKeyDown={(event) => {
        // M moves the focused desk or agent; the canvas moves by drag.
        if (event.key !== "m" && event.key !== "M") return;
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const button = (event.target as HTMLElement).closest<HTMLElement>(
          ".world-semantic-target",
        );
        const kind = button?.dataset.kind;
        const key = button?.dataset.targetKey;
        if (!key || (kind !== "desk" && kind !== "agent")) return;
        event.preventDefault();
        onMoveTarget(kind, key);
      }}
    >
      {pending ? (
        <span className="town-visually-hidden" role="status">
          Rendering {pending} more observed targets
        </span>
      ) : null}
      {rendered.map((target) => (
        <TownTargetButton
          key={`${target.kind}:${target.key}`}
          target={target}
          selected={selectedKey === target.key}
          onSelect={onSelect}
          onActivate={onActivate}
          onActivateRoom={onActivateRoom}
          onFocusTarget={onFocusTarget}
        />
      ))}
    </div>
  );
}

const TownTargetButton = memo(function TownTargetButton({
  target,
  selected,
  onSelect,
  onActivate,
  onActivateRoom,
  onFocusTarget,
}: {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
}) {
  return (
    <button
      className="world-semantic-target"
      type="button"
      data-kind={target.kind}
      data-target-key={target.key}
      data-color={target.color}
      aria-label={target.label}
      aria-pressed={selected}
      title={target.label}
      style={{
        left: target.rect.x,
        top: target.rect.y,
        width: target.rect.width,
        height: target.rect.height,
      }}
      onFocus={() => onFocusTarget(target)}
      onClick={() =>
        target.kind === "room"
          ? onActivateRoom(target.key)
          : onSelect(target.key)
      }
      onDoubleClick={() => {
        if (target.canActivate && target.kind !== "room")
          onActivate(target.key);
      }}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.shiftKey &&
          target.canActivate &&
          target.kind !== "room"
        ) {
          event.preventDefault();
          onActivate(target.key);
        }
      }}
    />
  );
}, sameTargetButton);

type TownTargetButtonProps = {
  target: TownTarget;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onActivateRoom(key: string): void;
  onFocusTarget(target: TownTarget): void;
};

function sameTargetButton(
  previous: TownTargetButtonProps,
  next: TownTargetButtonProps,
) {
  const a = previous.target;
  const b = next.target;
  return (
    previous.selected === next.selected &&
    previous.onSelect === next.onSelect &&
    previous.onActivate === next.onActivate &&
    previous.onActivateRoom === next.onActivateRoom &&
    previous.onFocusTarget === next.onFocusTarget &&
    a.key === b.key &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.color === b.color &&
    a.canActivate === b.canActivate &&
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height
  );
}

function ReceptionEntry({
  agent,
  asking = false,
  since,
  now,
  selected,
  onSelect,
  onActivate,
  onHoverEntry,
}: {
  agent: OfficeAgent;
  asking?: boolean;
  since: number;
  now: number;
  selected: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  onHoverEntry(key: string | null, rect?: DOMRect): void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (selected) ref.current?.setAttribute("data-selected", "true");
    else ref.current?.removeAttribute("data-selected");
  }, [selected]);
  return (
    <button
      ref={ref}
      type="button"
      className={`town-reception-entry${!asking && agent.semanticStatus === "done" ? " town-reception-done" : ""}`}
      data-agent-key={agent.key}
      data-owner-question={asking || undefined}
      disabled={agent.stale || !agent.canOpenInSpaces}
      aria-label={
        asking
          ? `${agent.displayLabel}, owner question`
          : agent.semanticStatus === "done"
            ? `${agent.displayLabel}, finished`
            : `${agent.displayLabel}, needs input for ${ago(since, now)}`
      }
      title={agent.taskSummary ?? agent.displayLabel}
      onClick={() => (asking ? onActivate(agent.key) : onSelect(agent.key))}
      onDoubleClick={() => onActivate(agent.key)}
      onMouseEnter={(event) =>
        onHoverEntry(agent.key, event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => onHoverEntry(null)}
    >
      <img src={portrait(agent.key)} alt="" width={28} height={40} />
      <span>{agent.displayLabel}</span>
      <small>
        {asking
          ? "? Owner wanted"
          : agent.semanticStatus === "done"
            ? "done ✓"
            : ago(since, now)}
      </small>
    </button>
  );
}

function TownBoard({
  model,
  observability,
  summaryCounts,
  onOpenSummary,
}: {
  model: TownModel;
  observability: OfficeObservability;
  summaryCounts?: TownSummary["counts"];
  onOpenSummary?: () => void;
}) {
  const counts = { working: 0, blocked: 0, done: 0, idle: 0, unknown: 0 };
  for (const agent of model.agents.values()) counts[agent.semanticStatus] += 1;
  // The shared summary's counts, when Town provides them (see townSummary).
  if (summaryCounts) {
    counts.working = summaryCounts.working;
    counts.blocked = summaryCounts.needsYou;
    counts.done = summaryCounts.finished;
  }
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  // Phones show a compact chip; it opens the full board in place.
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };
  const summary = `${counts.working} working, ${counts.blocked} need you, ${counts.done} done`;
  return (
    <>
      <button
        type="button"
        className="town-board-chip"
        // With a summary to open, the chip opens it; otherwise the board.
        {...(onOpenSummary
          ? { "aria-haspopup": "dialog" as const }
          : { "aria-expanded": open, "aria-controls": "town-board" })}
        aria-label={`${onOpenSummary ? "Town summary" : "Town board"}: ${summary}`}
        title={
          onOpenSummary
            ? "Open the Town summary"
            : open
              ? "Hide the Town board"
              : "Show the Town board"
        }
        onClick={() =>
          onOpenSummary ? onOpenSummary() : setOpen((value) => !value)
        }
        onKeyDown={closeOnEscape}
      >
        <span data-status="working">{counts.working}</span>
        <span data-status="blocked">!{counts.blocked}</span>
        <span data-status="done">✓{counts.done}</span>
      </button>
      <div
        id="town-board"
        className="town-board"
        data-open={open}
        role="group"
        aria-label="Town board"
        onKeyDown={closeOnEscape}
      >
        <div className="town-board-title">
          TOWN BOARD
          {onOpenSummary ? (
            <button
              type="button"
              className="town-board-open"
              onClick={onOpenSummary}
            >
              Summary
            </button>
          ) : null}
        </div>
        <dl>
          <div>
            <dt>Working</dt>
            <dd>{counts.working}</dd>
          </div>
          <div>
            <dt>Need you</dt>
            <dd>{counts.blocked}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{counts.done}</dd>
          </div>
        </dl>
        <div className="town-board-economy">
          <span>ECONOMY</span>
          {available ? (
            <>
              <b>{formatOfficeCost(observability.totalCostUsd)}</b>
              <small>
                {formatOfficeUsage(observability.totalUsage)} tokens
                {observability.models.length
                  ? ` · ${formatOfficeModelNames(observability.models)}`
                  : ""}
              </small>
            </>
          ) : (
            <small>
              No cost data. Configure a metrics provider in settings.
            </small>
          )}
        </div>
      </div>
    </>
  );
}
