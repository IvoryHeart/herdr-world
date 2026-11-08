import { useDrawReadiness } from "../useDrawReadiness";
import "../worldAsks.css";
import { TownBoard } from "./TownBoard";
import {
  TownTeamsLayer,
  TownWorldLayer,
  type TownRoomPress,
} from "./TownWorldLayer";
import { TownBuildingSigns } from "./townBuildingSigns";
import { TownBuildingLayers } from "./townBuildingLayers";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { RoomPins } from "./townModel";
import { useTownRoomMoves } from "./townRoomPins";
import { TOWN_GESTURES } from "./townGesture";
import { DEVTOOLS, NO_TRACE, type ViewTrace } from "../devtools/flag";
import { traceGesture } from "../devtools/trace";
import { TownZoomControls } from "./TownZoomControls";
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
import { useTownCenterRing } from "./useTownCenterRing";
import {
  TownCenterMenu,
  TownCenterSign,
  type TownCenterAction,
} from "./TownCenterMenu";
import { TownScene } from "./scene/townScene";
import { holdTownReflowOnInput } from "./townSceneInput";
import { sharedTownJoinSeats, type TownJoinSeats } from "./townJoinSeats";
import { TownSceneDiff } from "./scene/townSceneDiff";
import { TownHud, townScreenAnchor, townWorldAnchor } from "./scene/townHud";
import { TownHudContext, useTownHud } from "./useTownHud";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownInteraction } from "./scene/townInteraction";
import { townBrowserClock, townBrowserFrames } from "./townBrowserClock";
import { townSummary, type TownSummary } from "./townSummary";
import { townCalls } from "./TownRail";
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
import { TownBusLayer, useTownBin } from "./TownBusLayer";
import { TownArrivalLayer, useTownArrivals } from "./TownArrivalLayer";
import { aimAtBin } from "../bin/binDrop";
import {
  townReceptionTakesAll,
  type TownReceptionTakes,
} from "./townReceptionFilter";
import "./townBoard.css";
import "./townTeams.css";
import { TownEdgeArrows, TownNextLabel, TownPulseRing } from "./TownEdgeLayer";
import { useTownEdgeNav, type TownNeedsYouOrder } from "./useTownEdgeNav";
import { TownLensBoard, TownLensLayer, useTownLenses } from "./TownLenses";
import type { OfficeAgent } from "../officeProjectionTypes";

export type { PlaceColorChoice, TownRoomActions } from "./townRoomActions";
import type { TownRoomActions } from "./townRoomActions";

/** Camera kept across Office visits within one page session. */
const savedCameras = new Map<string, { x: number; y: number; z: number }>();

const NO_COLORS: TerminalColors = {};
const NO_RELATIONS = { relations: [], places: new Map() };
const NO_PINS: DeskPins = {};
const NO_ROOM_PINS: RoomPins = {};
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
  receptionHeldKeys = NO_KEYS,
  receptionTakes = townReceptionTakesAll,
  onFindHeld,
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
  summary: givenSummary,
  onOpenSummary,
  sinceYouLeft,
  roomFocus = null,
  calm = false,
  terminalColors = NO_COLORS,
  relations = NO_RELATIONS,
  deskPins = NO_PINS,
  joinSeats = sharedTownJoinSeats(),
  roomPins = NO_ROOM_PINS,
  chrome = NO_CHROME,
  trace = NO_TRACE,
  centerActions,
  needsYouOrder,
  activityAt,
}: {
  /**
   * Needs you's items in its order, read when N is pressed: each item's key
   * and its agent's leaf ID (Town's agent key), if it has one.
   */
  needsYouOrder?: TownNeedsYouOrder;
  /** When an agent last worked (its leaf's activity), for the Idle time lens. */
  activityAt?: (agent: OfficeAgent) => number | undefined;
  /** The town center's radial menu; without it the center only shows. */
  centerActions?: readonly TownCenterAction[];
  /** Which terminals know each other (world/relations.ts). */
  relations?: {
    relations: readonly Relation[];
    places: ReadonlyMap<string, TerminalPlace>;
  };
  observability: OfficeObservability;
  /**
   * The Town summary (townSummary.ts): the board counts the whole town from
   * it, with the same needs-you and finished items as the call rail, and the
   * room and table cards show their part of it. Without one, Town summarises
   * the projection itself.
   */
  summary?: TownSummary;
  /** Open the Town summary window from the board sign or the phone chip. */
  onOpenSummary?: () => void;
  /** "Since you left" for the board sign and the phone chip, after a return. */
  sinceYouLeft?: { board: ReactNode; chip: ReactNode };
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
  /** Agents their reception's filter keeps at their desks. */
  receptionHeldKeys?: ReadonlySet<string>;
  /** The marks each building's reception takes, by host key. */
  receptionTakes?: TownReceptionTakes;
  /** Reception's find: the agents its filter keeps at their desks. */
  onFindHeld?: (
    keys: readonly string[],
    anchor: { x: number; y: number },
  ) => void;
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
  /** Desks seated by joining a team (townTeamActions.ts); others stay put. */
  joinSeats?: TownJoinSeats;
  /** Where the user put rooms (useRoomPins); other rooms stack. */
  roomPins?: RoomPins;
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
  const busFramed = useRef<(() => void) | null>(null);
  const [failure, setFailure] = useState(false);
  const [ready, setReady] = useState(false);
  const capture = useDrawReadiness("town", shellRef, () =>
    rendererRef.current?.invalidate("capture"),
  );
  const captureHolding = useRef(false);
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
  // A join request derives the scene again, to seat the desk.
  useSyncExternalStore(
    joinSeats.subscribe,
    joinSeats.getVersion,
    joinSeats.getVersion,
  );
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
    roomPins,
    relations,
    sources,
    shape,
    foldRevision,
    joinSeats,
  });
  useLayoutEffect(() => {
    captureHolding.current = semantics.holding;
  });
  const { model, placed, layout, teams, targets, deskBadges, blockedSince } =
    semantics;
  const townBin = useTownBin(model, layout);
  const awayKeys = townBin.away;
  const arrivals = useTownArrivals(model, layout, townBin.route);
  const arrivingKeys = arrivals.arriving;
  // A new agent goes to its desk for its welcome, as a summoned one does.
  const welcoming = arrivals.welcoming;
  const deskKeys = useMemo(
    () =>
      welcoming.size ? new Set([...summonedKeys, ...welcoming]) : summonedKeys,
    [summonedKeys, welcoming],
  );
  // A desk just pinned keeps the cell it has; save it so it stays there.
  const deskPinned = model.deskPins;
  const fallbackSummary = useMemo(
    () =>
      givenSummary
        ? null
        : townSummary(
            projection,
            townCalls(projection.roster, new Map(), [], () => undefined),
            observability,
          ),
    [givenSummary, projection, observability],
  );
  const summary = givenSummary ?? fallbackSummary!;
  useEffect(() => {
    for (const { pinKey, cell } of scene.pinPlacements(
      deskPinned,
      layout,
      placed,
    ))
      void placeDeskPin(pinKey, cell).finally(() => scene.pinPlaced(pinKey));
  }, [scene, layout, placed, deskPinned]);
  const [hover, setHover] = useState<string | null>(null);
  const ring = useTownCenterRing(
    rendererRef,
    hostRef,
    () => latest.current.layout.center,
    !!centerActions?.length,
  );
  // Lenses (TownLenses.tsx): Town opens in Attention, Town as usual.
  const lens = useTownLenses(model, {
    projection,
    sources,
    quests,
    activityAt,
    targets,
    centerActions,
    shell: shellRef,
    ringOpen: ring.open,
  });
  /** A table whose card a touch tap opened; touch has no hover to open it. */
  const [tappedDesk, setTappedDesk] = useState<string | null>(null);
  /** The board a lobby tap brought back at desk level (townInteraction). */
  const [openReception, setOpenReception] = useState<string | null>(null);
  const current = {
    chrome,
    calm,
    model,
    layout,
    teams,
    selectedKey,
    hover,
    tappedDesk,
    completionSeenKeys,
    summonedKeys: deskKeys,
    askingKeys,
    awayKeys,
    arrivingKeys,
    receptionHeldKeys,
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
  const latest = useRef(current);
  latest.current = current;

  const placedRoomActions = useTownRoomMoves(
    roomActions,
    model,
    layout,
    rendererRef,
  );

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
  const [layers] = useState(() => new TownBuildingLayers());
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
  /**
   * Passes a room card's or name's press to the town beneath it
   * (TownWorldLayer): a press on a name can carry the room.
   */
  const roomCardPress = useRef<
    | ((event: PointerEvent, roomKey: string, press: TownRoomPress) => boolean)
    | null
  >(null);
  // Arrows to what needs you off screen, and N for the next one.
  const edge = useTownEdgeNav({
    model,
    layout,
    askingKeys,
    calm,
    needsYouOrder,
    view,
    rendererRef,
    shellRef,
    hostRef,
  });
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
        setOpenReception(null);
      }
      const renderer = rendererRef.current;
      if (renderer) {
        signs.update((hostKey) => renderer.roofAlpha(hostKey));
        layers.update((hostKey) => renderer.buildingMotion(hostKey));
        if (level !== "overview")
          for (const pennant of pennants.current) markAway(pennant, renderer);
        busFramed.current?.();
      }
    }
    hud.framed();
    ring.place();
    edge.frameArrows(camera, level);
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
    awayKeys: latest.current.awayKeys,
    arrivingKeys: latest.current.arrivingKeys,
    heldKeys: latest.current.receptionHeldKeys,
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
      (pending) =>
        capture.current?.drawn(
          pending || captureHolding.current ? "materialize/reflow" : undefined,
        ),
      (reason) => capture.current?.invalidate(reason),
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
  }, [view, diff, capture]);

  // Before the browser paints the new layout's DOM: the renderer keeps
  // drawing the old frame until its next one, so each building's layer
  // starts where its building is still drawn (townBuildingLayers.ts).
  useLayoutEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.apply(diff.next(model, layout, sceneState()));
    view.follow(layout, viewport());
    layers.update((hostKey) => renderer.buildingMotion(hostKey));
    scheduleAnchors();
  }, [view, diff, layers, model, layout]);
  // Presses, scrolls and zooms on the town hold back a reflow (see above).
  useEffect(() => {
    const host = hostRef.current;
    return host ? holdTownReflowOnInput(scene, host) : undefined;
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
    deskKeys,
    askingKeys,
    awayKeys,
    arrivingKeys,
    receptionHeldKeys,
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
      cursor: (kind) => {
        host.style.cursor = kind ?? "";
      },
      select: (key) => latest.current.onSelect(key),
      tapCard: (deskKey) => {
        const { tappedDesk: open, model: m } = latest.current;
        const roomKey = deskKey ? m.desks.get(deskKey)?.roomKey : undefined;
        // Only a table drawn with its nameplate has a card; a second tap
        // on the same table does what a tap always did.
        const opens =
          deskKey !== null &&
          deskKey !== open &&
          !!roomKey &&
          hud.visible.tagRooms.has(roomKey);
        setTappedDesk(opens ? deskKey : null);
        return opens;
      },
      activateAgent: (key) => latest.current.onActivateAgent(key),
      activateRoom: (key) => latest.current.onActivateRoom(key),
      openReception: setOpenReception,
      openCenter: ring.openRing,
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
          case "room":
            return (
              actions.onPlaceRooms?.(command.roomKey, command.placement) ??
              Promise.resolve("returned")
            );
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
      // The bin chip and the bus stops lie over the canvas: a carry over
      // one is dropped in the bin.
      binAt: (at) => {
        if (!at || !latest.current.roomActions.onBinDrop) return aimAtBin(null);
        const rect = host.getBoundingClientRect();
        return aimAtBin({ x: rect.left + at.x, y: rect.top + at.y });
      },
      bin: (drag) =>
        drag.kind === "room"
          ? undefined
          : latest.current.roomActions.onBinDrop?.(drag.kind, drag.key),
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
    // A room card sits above the canvas: its presses join the town's gesture
    // with the card's room as the tap target. Capturing the pointer on the
    // host keeps the rest of the gesture (moves, lift, drop) on the canvas.
    roomCardPress.current = (event, roomKey, press) => {
      if (
        !rendererRef.current ||
        (event.pointerType === "mouse" && event.button !== 0)
      )
        return false;
      scene.pointerDown();
      try {
        host.setPointerCapture(event.pointerId);
      } catch {
        return false;
      }
      interaction.down({
        id: event.pointerId,
        at: local(event),
        primary: event.isPrimary,
        pointerType: event.pointerType,
        ...(press === "card" || press === "card-name" ? { card: roomKey } : {}),
        ...(press === "card" ? {} : { roomName: roomKey }),
        ...(press === "plaque-move" ? { handle: true } : {}),
      });
      return true;
    };
    // Escape puts back a carried desk, agent or room, before anything else
    // (a panel, the chooser) takes the key.
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && interaction.cancelCarry()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", escape, true);
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    host.addEventListener("pointerleave", leave);
    host.addEventListener("wheel", wheel, { passive: false });
    return () => {
      reaimCarry.current = null;
      roomCardPress.current = null;
      interaction.dispose();
      window.removeEventListener("keydown", escape, true);
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("pointerleave", leave);
      host.removeEventListener("wheel", wheel);
    };
  }, [view, scene, hud, ring.openRing]);

  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!rendererRef.current || event.target !== event.currentTarget) return;
    if (view.key(event.key)) event.preventDefault();
  };

  const stepZoom = (direction: 1 | -1) => {
    if (rendererRef.current)
      view.stepZoom(direction, latest.current.layout, viewport());
  };

  const focusTarget = (target: TownTarget) => {
    lens.focus(target.key);
    view.focusTarget(target);
  };

  const zoomToRoomKey = (roomKey: string) =>
    view.zoomToRoom(latest.current.layout, roomKey);
  // A request waits for renderer setup and its admitted layout, then runs once.
  useEffect(() => {
    if (ready) view.roomFocus(roomFocus, layout);
  }, [view, roomFocus, ready, layout]);

  return (
    <div className="town-shell" ref={shellRef} data-calm={calm}>
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
        data-lens={lens.view?.lens}
        aria-hidden={!ready}
      >
        {lens.view ? (
          <TownLensLayer
            view={lens.view}
            model={model}
            layout={layout}
            shownRooms={visible.tagRooms}
          />
        ) : null}
        <TownCenterSign
          center={layout.center}
          open={ring.open}
          onOpen={centerActions?.length ? ring.openRing : undefined}
          onFocus={ring.focus}
        />
        <TownTeamsLayer teams={teams} />
        <TownBusLayer
          bin={townBin.bin}
          route={townBin.route}
          riders={townBin.riders}
          returning={townBin.returning}
          lookOf={townBin.lookOf}
          framed={busFramed}
          renderer={rendererRef}
        />
        <TownArrivalLayer
          arrivals={arrivals.arrivals}
          model={model}
          layout={layout}
          route={townBin.route}
          lookOf={townBin.lookOf}
          renderer={rendererRef}
        />
        <TownHudContext.Provider value={hud}>
          <TownWorldLayer
            hud={hud}
            foldedActivity={foldedActivity}
            askingKeys={askingKeys}
            receptionHeldKeys={receptionHeldKeys}
            receptionTakes={receptionTakes}
            onFindHeld={onFindHeld}
            onActivateAsk={onActivateAsk}
            model={model}
            layout={layout}
            visible={visible}
            signs={signs}
            layers={layers}
            onHoverEntry={hoverEntry}
            selectedKey={selectedKey}
            blockedSince={blockedSince}
            roomActions={placedRoomActions}
            selectedRoomKey={selectedRoomKey}
            onSelect={onSelect}
            onActivate={onActivateAgent}
            summary={summary}
            openDeskKey={
              // A mouse over a table, or a touch tap on one, opens its card.
              tappedDesk ??
              (hover !== null && model.desks.has(hover) ? hover : null)
            }
            openReceptionKey={openReception}
            openRoomKey={
              // Zoomed out, a mouse anywhere over a room (a table or an
              // agent in it) opens the room's card.
              hover === null
                ? null
                : model.rooms.has(hover)
                  ? hover
                  : (model.desks.get(hover)?.roomKey ??
                    model.agents.get(hover)?.roomKey ??
                    null)
            }
            onActivateRoom={(key) => {
              onActivateRoom(key);
              zoomToRoomKey(key);
            }}
            onRoomCardPress={(event, roomKey, press) =>
              roomCardPress.current?.(event, roomKey, press) ?? false
            }
            onFocusTarget={focusTarget}
            targets={lens.targets}
            deskBadges={deskBadges}
            quests={quests}
            renderer={rendererRef}
            pennants={pennants.current}
          />
        </TownHudContext.Provider>
        <TownPulseRing pulse={edge.pulse} />
      </div>
      <TownEdgeArrows
        store={edge.arrowStore}
        buildingLabel={edge.buildingLabel}
        onGo={edge.goToArrow}
      />
      <TownNextLabel text={edge.nextText} />
      <TownLensBoard lens={lens} hover={hover} selected={selectedKey}>
        <TownBoard
          counts={summary.counts}
          observability={observability}
          onOpenSummary={onOpenSummary}
          sinceYouLeft={sinceYouLeft}
        />
      </TownLensBoard>
      <TownZoomControls
        onStep={stepZoom}
        onAll={() => view.fitAll(latest.current.layout)}
      />
      {ring.open && lens.ringActions ? (
        <TownCenterMenu
          actions={lens.ringActions}
          viewportWidth={hostRef.current?.clientWidth ?? 0}
          place={ring.place}
          onClose={ring.close}
        />
      ) : null}
    </div>
  );
}

const NO_CHROME = { left: 0, right: 0 };
