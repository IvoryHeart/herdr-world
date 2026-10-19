import {
  ChevronDown,
  ChevronUp,
  Trash2,
  EllipsisVertical,
  Maximize2,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  lazy,
  startTransition,
  Suspense,
  useDeferredValue,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { worldLocalStorage } from "../browserStorage";
import {
  anchorFor,
  confirmed,
  nextWitness,
  targetOf,
} from "./board/boardAnchors";
import {
  NOTE_COLORS,
  CARD_COLORS,
  type CardColor,
  sharedBoardStore,
  useBoardDocument,
  type BoardDocumentStore,
  type BoardEnd,
  type BoardAnchor,
  type BoardNote,
  type BoardOp,
  type BoardString,
} from "./board/boardDocument";
import {
  boardStatusOrder,
  projectBoard,
  type BoardHost,
  type BoardModel,
  type BoardPane,
  type BoardTab,
  type BoardWorkspace,
} from "./board/boardModel";
import {
  initialGesture,
  stepGesture,
  type GestureEffect,
  type GestureEvent,
  type GestureTarget,
} from "./board/boardGesture";
import { createFrameLoop, type FrameLoop } from "./board/boardScheduler";
import { DEVTOOLS, NO_TRACE } from "./devtools/flag";
import { openTrace, rememberTrace } from "./devtools/trace";
import { TraceOverlay } from "./devtools/TraceOverlay";
import {
  KEPT_DRAFTS_KEY,
  createDraftStore,
  useKeptDrafts,
  type KeptDraft,
} from "./board/boardDrafts";
import {
  cool,
  stepPhysics,
  warm,
  type PhysicsCard,
  type PhysicsState,
} from "./board/boardPhysics";
import {
  DEFAULT_SIZE,
  clearSpots,
  cloneLayout,
  emptyLayout,
  placeNew,
  positions,
  rectAt,
  tidy,
  type BoardLayout,
  type Point,
  type Rect,
  type Size,
} from "./board/boardPlacement";
import type { WorldAgentStatus, WorldObject } from "./worldObject";
import type { WorldCanvasAnchor } from "./worldConnectorGeometry";
import { WorldSearchResults } from "./WorldSearchResults";
import { WorldViewToolbar } from "./WorldViewToolbar";
import "./board/board.css";

/**
 * Board: hosts as zones, workspaces as cards and tabs as cards around their
 * workspace, on an elastic board that only moves under the user's hand and
 * comes to rest within about a second. See openspec/changes/board-view.
 */

const STATUS_LABEL: Record<WorldAgentStatus, string> = {
  blocked: "Needs you",
  working: "Working",
  done: "Finished, not checked",
  idle: "Idle",
  unknown: "No signal",
};
const OVERVIEW_IN = 0.44;
const OVERVIEW_OUT = 0.5;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.4;
const PULSES_KEY = "herdr-world.board.pulses";
const TWEEN_SECONDS = 0.26;

/** A card (note, workspace or tab) and optionally one of its panes. */
type StringEnd = { cardKey: string; paneKey?: string };
const NOTE_PREFIX = "note:";
const isNoteKey = (key: string) => key.startsWith(NOTE_PREFIX);
const NOTE_SIZE: Size = { w: 180, h: 110 };
const SAVE_DELAY_MS = 600;

/**
 * A unique ID for a note or string. crypto.randomUUID exists only on secure
 * origins (HTTPS or localhost), and World is often opened over plain HTTP on
 * a LAN or tailnet address; getRandomValues works everywhere.
 */
function newId() {
  if (typeof crypto.randomUUID === "function" && window.isSecureContext)
    return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** An agent pane a note is strung to, with what the service needs to check. */
export type SendTarget = {
  label: string;
  connectionId: string;
  generation: number;
  paneId: string;
  terminalId: string;
  /** The string that links the note to this pane; the service rechecks it. */
  stringId: string;
};
export type SendOutcome = {
  status: string;
  message?: string;
  agent?: string;
  /** "replaced" or "unbound": another agent, or one Board never recorded. */
  reason?: string;
  /** With those reasons: confirm this agent to send to it instead. */
  recipient?: string;
};
export type TabMoveOutcome = {
  status: string;
  reason?: string;
  message?: string;
  tab_id?: string;
  panes?: { previous: string; current: string }[];
};
async function moveTabThroughService(
  tab: BoardTab,
  space: BoardWorkspace,
  allowClose: boolean,
) {
  const { bridge } = await import("../api");
  return (await bridge.connection(space.connectionId, space.generation).call(
    "town.move_desk",
    {
      tab_id: tab.nativeId,
      workspace_id: space.nativeId,
      allow_close_room: allowClose,
    },
    90_000,
  )) as TabMoveOutcome;
}
const MOVE_NO_ASK_KEY = "herdr-world.board.move-no-ask";
function readMoveNoAsk() {
  try {
    return worldLocalStorage.getItem(MOVE_NO_ASK_KEY) === "yes";
  } catch {
    return false;
  }
}
export type StartOutcome = {
  status: string;
  message?: string;
  pane_id?: string;
  terminal_id?: string;
};
/** World's shared New workspace dialog, loaded when first opened. */
const CreateWorkspaceDialog = lazy(() =>
  import("../components/CreateWorkspaceDialog").then((m) => ({
    default: m.CreateWorkspaceDialog,
  })),
);
/** A plain terminal tab through World's store, which refreshes the topology. */
/**
 * Creating and naming are separate outcomes: a tab that was created but not
 * named is reported as created, so the user finds it instead of retrying.
 */
export type CreateTabOutcome = { namingProblem?: string };
async function createTabThroughStore(
  space: BoardWorkspace,
  name?: string,
): Promise<CreateTabOutcome> {
  const { store } = await import("../store");
  const result = (await store.createQualifiedTab(
    { connectionId: space.connectionId, runtimeGeneration: space.generation },
    space.nativeId,
    { numberedLabel: !name },
  )) as { tab?: { tab_id?: unknown } } | undefined;
  if (!name) return {};
  const tabId = result?.tab?.tab_id;
  if (typeof tabId !== "string")
    return { namingProblem: "Herdr did not say which tab it created" };
  try {
    const { bridge } = await import("../api");
    await bridge
      .connection(space.connectionId, space.generation)
      .call("tab.rename", { tab_id: tabId, label: name });
    return {};
  } catch (error) {
    return {
      namingProblem: error instanceof Error ? error.message : String(error),
    };
  }
}
async function startAgentThroughService(
  space: BoardWorkspace,
  kind: string,
  name: string,
  text: string,
) {
  const { bridge } = await import("../api");
  return (await bridge
    .connection(space.connectionId, space.generation)
    .call(
      "board.start_agent",
      { workspace_id: space.nativeId, kind, name, text },
      120_000,
    )) as StartOutcome;
}
/** Agents Board offers to start; Herdr validates the kind. */
const START_KINDS = [
  { kind: "claude", label: "Claude" },
  { kind: "codex", label: "Codex" },
];
async function checkAnchorThroughService(host: BoardHost, anchor: BoardAnchor) {
  const { bridge } = await import("../api");
  return (await bridge
    .connection(host.connectionId, host.generation)
    .call(
      "board.check_anchor",
      { kind: anchor.kind, native_id: anchor.native_id },
      15_000,
    )) as { state: string };
}
/** The service sends the saved note's text, after rechecking note and string. */
async function sendNoteThroughService(
  target: SendTarget,
  note: BoardNote,
  confirmRecipient?: string,
) {
  const { bridge } = await import("../api");
  return (await bridge.connection(target.connectionId, target.generation).call(
    "board.send_note",
    {
      pane_id: target.paneId,
      terminal_id: target.terminalId,
      note_id: note.id,
      note_rev: note.rev,
      string_id: target.stringId,
      ...(confirmRecipient ? { confirm_recipient: confirmRecipient } : {}),
    },
    30_000,
  )) as SendOutcome;
}
type Camera = { x: number; y: number; s: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const isPhone = () => window.matchMedia("(max-width: 720px)").matches;

function readPulses() {
  try {
    return worldLocalStorage.getItem(PULSES_KEY) !== "off";
  } catch {
    return true;
  }
}

/** The pane a tab card selects or opens: its most urgent agent, else the first. */
function primaryPane(tab: BoardTab) {
  return (
    tab.panes.find((pane) => pane.isAgent && pane.status === tab.status) ??
    tab.panes[0]
  );
}

/** A tab card draws up to four pane rows; the rest are in the chooser. */
const MAX_ROWS = 4;
function rowsOf(tab: BoardTab, selectedId: string | null = null): BoardPane[] {
  if (tab.panes.length <= MAX_ROWS) return tab.panes;
  const shown = rowsByUrgency(tab);
  // A selected pane (from search, say) is always one of the rows shown.
  const selected = tab.panes.find((pane) => pane.leaf.id === selectedId);
  if (selected && !shown.includes(selected))
    return [...shown.slice(0, shown.length - 1), selected];
  return shown;
}
function rowsByUrgency(tab: BoardTab): BoardPane[] {
  // With more panes than rows, show the ones that need attention first.
  return tab.panes
    .slice()
    .sort((a, b) =>
      a.isAgent !== b.isAgent
        ? a.isAgent
          ? -1
          : 1
        : boardStatusOrder(a.status, b.status),
    )
    .slice(0, MAX_ROWS - 1);
}

function paneName(pane: BoardPane) {
  if (!pane.isAgent) return "shell";
  return pane.leaf.agentName ?? pane.leaf.agentLabel ?? "agent";
}

function paneLine(pane: BoardPane, status: WorldAgentStatus) {
  if (!pane.isAgent) return pane.leaf.terminalTitle ?? "shell";
  return (
    pane.leaf.taskSummary ?? pane.leaf.terminalTitle ?? STATUS_LABEL[status]
  );
}

function tabSummary(tab: BoardTab) {
  if (tab.shellOnly)
    return `terminal${tab.panes.length > 1 ? `, ${tab.panes.length} panes` : ""}`;
  const agents = tab.panes.filter((pane) => pane.isAgent).length;
  const shells = tab.panes.length - agents;
  return [
    `${agents} agent${agents === 1 ? "" : "s"}`,
    shells ? `${shells} shell${shells === 1 ? "" : "s"}` : "",
    STATUS_LABEL[tab.status],
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Whether a card's key or click came from a control inside it (Fold, New,
 * the more-panes button): that control acts, and the card does not.
 */
function fromNestedControl(event: {
  target: EventTarget;
  currentTarget: EventTarget;
}) {
  const control = (event.target as Element).closest?.(
    "button, a[href], input, select, textarea",
  );
  return (
    !!control &&
    control !== event.currentTarget &&
    (event.currentTarget as Element).contains(control)
  );
}

export default function BoardView({
  world,
  toolbarPortal = null,
  selectedId,
  onSelect,
  onOpenTerminal,
  store,
  sendNote = sendNoteThroughService,
  checkAnchor = checkAnchorThroughService,
  startAgent = startAgentThroughService,
  moveTab = moveTabThroughService,
  createTab = createTabThroughStore,
  conversationNodeIds = NO_IDS,
  onNodeAnchorsChange,
  onSelectedAnchorChange,
}: {
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  onSelect(id: string): unknown;
  onOpenTerminal(id: string): unknown;
  /** Board's saved state; World's own service store by default. */
  store?: BoardDocumentStore;
  /** Send a note to an agent's pane; World's service by default. */
  sendNote?: (
    target: SendTarget,
    note: BoardNote,
    /** The agent now in the pane, which the user confirmed sending to. */
    confirmRecipient?: string,
  ) => Promise<SendOutcome>;
  /** Move a tab to another workspace of its host; World's service by default. */
  moveTab?: (
    tab: BoardTab,
    space: BoardWorkspace,
    allowClose: boolean,
  ) => Promise<TabMoveOutcome>;
  /** Start an agent in a workspace with a note; World's service by default. */
  startAgent?: (
    space: BoardWorkspace,
    kind: string,
    name: string,
    text: string,
  ) => Promise<StartOutcome>;
  /** Nodes with an open Inspector window, so World can draw their lines. */
  conversationNodeIds?: readonly string[];
  /** Where those nodes (and the selection) are on screen, for the lines. */
  onNodeAnchorsChange?(anchors: Record<string, WorldCanvasAnchor> | null): void;
  onSelectedAnchorChange?(anchor: WorldCanvasAnchor | null): void;
  /** Open a plain terminal tab in a workspace; World's store by default. */
  createTab?: (
    space: BoardWorkspace,
    name?: string,
  ) => Promise<CreateTabOutcome | void>;
  /** Ask the service whether an anchor's target exists; World's by default. */
  checkAnchor?: (
    host: BoardHost,
    anchor: BoardAnchor,
  ) => Promise<{ state: string }>;
}) {
  // Topology updates render at low priority and in slices, so a large board
  // never holds up typing in a terminal.
  const shownWorld = useDeferredValue(world);
  const fullModel = useMemo(() => projectBoard(shownWorld), [shownWorld]);
  // A large board's first render is only the frame; its cards follow in a
  // transition, which yields to input while it builds.
  const [built, setBuilt] = useState(
    () => fullModel.workspaces.length + fullModel.tabs.length <= CULL_ABOVE,
  );
  useEffect(() => {
    if (!built) startTransition(() => setBuilt(true));
  }, [built]);
  const model = built ? fullModel : EMPTY_MODEL;
  const boardStore = useMemo(() => store ?? sharedBoardStore(), [store]);
  useEffect(() => {
    boardStore.start();
    return () => boardStore.stop();
  }, [boardStore]);
  const { document: saved } = useBoardDocument(boardStore);
  const [editing, setEditing] = useState<string | null>(null);
  /** The text being typed into a note, kept apart from the saved notes. */
  const draftRef = useRef<{ started: BoardNote; text: string } | null>(null);
  /**
   * A draft that could not be saved (the note changed or was deleted
   * elsewhere). It stays until the user saves or discards it.
   */
  const unsaved = useKeptDrafts(keptDraftStore);
  /** Keep a draft that could not be saved; one per note. */
  const keepDraft = (draft: Omit<KeptDraft, "key">) =>
    keptDraftStore.keep({ ...draft, key: newId() });
  const [noteSelected, setNoteSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [stringFrom, setStringFrom] = useState<StringEnd | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  /** The note an agent is being started for, while the chooser is open. */
  const [startFor, setStartFor] = useState<string | null>(null);
  /** The workspace whose "New" chooser is open. */
  const [addTo, setAddTo] = useState<string | null>(null);
  /** The host whose New workspace dialog is open. */
  const [newWorkspaceOn, setNewWorkspaceOn] = useState<BoardHost | null>(null);
  /** The workspace a dragged tab is over: dropping offers to move it there. */
  const glue = useRef<string | null>(null);
  const [moveAsk, setMoveAsk] = useState<{
    tabKey: string;
    workspaceKey: string;
    lastTab: boolean;
  } | null>(null);
  /** Anchors already asked about this session: `string id:end`. */
  const checkedAnchors = useRef(new Set<string>());
  // A large board opens in the overview (where fitting it lands anyway), so
  // the first render does not build every tab card only to hide them.
  const startsFar = () =>
    fullModel.workspaces.length + fullModel.tabs.length > CULL_ABOVE;
  const [far, setFar] = useState(startsFar);
  /** On a large board, the cards React renders (those near the screen). */
  const [renderKeys, setRenderKeys] = useState<Set<string> | null>(null);
  const renderKeysRef = useRef<Set<string> | null>(null);
  const selectedKeysRef = useRef<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /** The pane chooser: to pick a pane, or to finish a string to one. */
  const [chooser, setChooser] = useState<{
    tabKey: string;
    stringFrom?: StringEnd;
  } | null>(null);
  const [pulses, setPulses] = useState(readPulses);
  const [tracing, setTracing] = useState(false);
  const [toast, setToast] = useState<{
    text: string;
    undo?: () => void;
    /** The undo button's label; Undo by default. */
    action?: string;
    /** How long it stays; longer for a choice than for a notice. */
    ms?: number;
  } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const zoneEls = useRef(new Map<string, HTMLElement>());
  const paths = useRef(new Map<string, SVGPathElement>());
  const cam = useRef<Camera>({ x: 0, y: 0, s: 0.6 });
  const camGoal = useRef<Camera | null>(null);
  const panVelocity = useRef<Point | null>(null);
  const layout = useRef<BoardLayout>(emptyLayout());
  const cards = useRef(new Map<string, PhysicsCard>());
  const physics = useRef<PhysicsState>({ heat: 0 });
  // Moves the board makes itself (tidy, Undo, unfold) travel on a short
  // tween so every card arrives; physics is only for moves made by hand.
  const tweens = useRef(
    new Map<
      string,
      { fx: number; fy: number; tx: number; ty: number; t: number }
    >(),
  );
  /** The card under the pointer while dragged, and where it was grabbed. */
  const held = useRef<{ key: string; grab: Point } | null>(null);
  /** A string being drawn from a card or note. */
  const stringDrag = useRef<{
    from: StringEnd;
    at: Point;
    over: StringEnd | null;
  } | null>(null);
  const gesture = useRef(initialGesture());
  const pinchStart = useRef<{ cam: Camera; mid: Point } | null>(null);
  // The event trace exists only in development builds (devtools/flag.ts).
  const trace = useMemo(() => (DEVTOOLS ? openTrace("board") : NO_TRACE), []);
  useEffect(() => setTracing(trace.enabled), [trace]);
  const setTrace = (on: boolean) => {
    if (!DEVTOOLS) return;
    rememberTrace("board", trace, on);
    setTracing(on);
  };
  // Anything that changes what is on screen asks for a frame.
  const loopRef = useRef<FrameLoop | null>(null);
  const invalidate = (reason: string) => loopRef.current?.invalidate(reason);
  const warmUp = () => {
    warm(physics.current);
    invalidate("physics");
  };
  const fitted = useRef(false);
  const farRef = useRef(far);
  const yarnEls = useRef(new Map<string, SVGPathElement[]>());
  const cutRef = useRef<HTMLButtonElement>(null);
  /** The note or card bar, and the card it rides above. */
  const barRef = useRef<HTMLDivElement>(null);
  const barKey = useRef<string | null>(null);
  const tempYarn = useRef<SVGPathElement | null>(null);
  /** Where each anchored string end was last drawn, for when it leaves the board. */
  const lastSeen = useRef(new Map<string, Point>());
  /** The last anchors reported to World, to report only changes. */
  const reportedAnchors = useRef("");
  const anchorProps = useRef({
    conversationNodeIds,
    selectedId,
    onNodeAnchorsChange,
    onSelectedAnchorChange,
  });
  anchorProps.current = {
    conversationNodeIds,
    selectedId,
    onNodeAnchorsChange,
    onSelectedAnchorChange,
  };
  const loaded = useRef(false);
  const saveTimer = useRef(0);
  /** True while a layout save is waiting to go out. */
  const savePending = useRef(false);
  /** The saved layout this board last applied or sent, as a signature. */
  const layoutSeen = useRef("");
  const lastPointerType = useRef("mouse");
  const latest = useRef({
    model,
    collapsed,
    onSelect,
    onOpenTerminal,
    saved,
    picked,
    noteSelected,
  });
  latest.current = {
    model,
    collapsed,
    onSelect,
    onOpenTerminal,
    saved,
    picked,
    noteSelected,
  };

  const kindOf = (key: string, m: BoardModel) =>
    m.workspaceByKey.has(key) ? "workspace" : "tab";
  /**
   * On a large board, sizes come from a ResizeObserver after the browser's
   * own layout, never from reading the DOM mid-frame: each such read forced
   * a full layout of the page.
   */
  const large = useRef(false);
  const displayed = useRef(new Map<string, Size>());
  const resizes = useRef<ResizeObserver | null>(null);
  if (!resizes.current && typeof ResizeObserver !== "undefined")
    resizes.current = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset.key;
        const box = entry.borderBoxSize?.[0];
        if (!key || !box || !box.inlineSize) continue;
        const size = { w: box.inlineSize, h: box.blockSize };
        displayed.current.set(key, size);
        const card = cards.current.get(key);
        // Small boards measure synchronously (see the model effect).
        if (card && large.current && !farRef.current) card.size = size;
      }
      if (large.current) invalidate("resize");
    });
  useEffect(() => () => resizes.current?.disconnect(), []);
  /** A card's size as displayed now (overview sizes included). */
  /** The board's rectangle; cached on a large board, refreshed on resize. */
  const boardBox = useRef<DOMRect | null>(null);
  const boardRect = () => {
    const board = boardRef.current!;
    if (!large.current) return board.getBoundingClientRect();
    return (boardBox.current ??= board.getBoundingClientRect());
  };
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const reset = () => {
      boardBox.current = null;
      if (large.current) invalidate("board-moved");
    };
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(reset) : null;
    observer?.observe(board);
    window.addEventListener("resize", reset);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", reset);
    };
  }, []);
  const shownSize = (key: string): Size | undefined =>
    large.current
      ? displayed.current.get(key)
      : (() => {
          const el = cardEls.current.get(key);
          return el?.offsetWidth
            ? { w: el.offsetWidth, h: el.offsetHeight }
            : undefined;
        })();
  // Placement uses each card's rendered size (new cards are already in the
  // DOM when placement runs); the overview's enlarged cards are never measured.
  const sizeOf = useCallback((key: string, kind: "workspace" | "tab"): Size => {
    if (!farRef.current) {
      const size = shownSize(key);
      if (size) return size;
    }
    return cards.current.get(key)?.size ?? DEFAULT_SIZE[kind];
  }, []);

  /* ---------- Model changes: measure, place new cards, keep the rest ---------- */
  useLayoutEffect(() => {
    large.current = model.workspaces.length + model.tabs.length > CULL_ABOVE;
    // A large board shows nothing until paint picks the cards near the
    // screen, so its placement runs in a task of its own rather than in
    // React's commit, and input can be handled in between.
    if (!large.current) {
      placeModel();
      return;
    }
    const task = window.setTimeout(placeModel, 0);
    return () => window.clearTimeout(task);
    // placeModel reads refs and this render's model.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [model, sizeOf]);
  function placeModel() {
    if (!farRef.current && !large.current)
      for (const [key, el] of cardEls.current) {
        const card = cards.current.get(key);
        if (card && el.offsetWidth)
          card.size = { w: el.offsetWidth, h: el.offsetHeight };
      }
    layout.current = placeNew(model, layout.current, {
      phone: isPhone(),
      sizeOf,
      // Tabs on a large board wait for the overview to end (see below).
      skipTabs:
        farRef.current &&
        model.workspaces.length + model.tabs.length > CULL_ABOVE,
    });
    const at = positions(model, layout.current);
    for (const [key, point] of at) {
      if (cards.current.has(key)) continue;
      const kind = kindOf(key, model);
      const el = cardEls.current.get(key);
      cards.current.set(key, {
        key,
        x: point.x,
        y: point.y,
        vx: 0,
        vy: 0,
        size: el?.offsetWidth
          ? { w: el.offsetWidth, h: el.offsetHeight }
          : DEFAULT_SIZE[kind],
        home: point,
        fixed: false,
        gliding: false,
        stiffness: kind === "tab" ? 60 : 30,
      });
    }
    // Topology changes remove cards that left; notes are not topology.
    for (const key of [...cards.current.keys()])
      if (!at.has(key) && !isNoteKey(key)) cards.current.delete(key);
    if (!fitted.current && at.size) {
      fitted.current = true;
      fit(true);
    }
    invalidate("change");
  }

  // Folding and the overview change what is visible without moving a card:
  // repaint so lines to hidden tabs go at once.
  useEffect(() => {
    invalidate("change");
  }, [collapsed, far]);
  // Leaving the overview on a large board: place the tabs it put off and
  // show them where they belong.
  useEffect(() => {
    if (far) return;
    const m = latest.current.model;
    const pending = m.tabs.filter(
      (tab) =>
        !layout.current.offsets.has(tab.key) &&
        !layout.current.pinned.has(tab.key),
    );
    if (!pending.length) return;
    layout.current = placeNew(m, layout.current, { phone: isPhone(), sizeOf });
    const at = positions(m, layout.current);
    for (const tab of pending) {
      const card = cards.current.get(tab.key),
        point = at.get(tab.key);
      if (!card || !point) continue;
      card.x = point.x;
      card.y = point.y;
      card.home = point;
    }
    invalidate("tabs-placed");
    scheduleSave();
    // Placement reads refs; only leaving the overview starts it.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [far]);

  /* ---------- Saved state: notes as free cards, layout loaded once ---------- */
  useLayoutEffect(() => {
    const notes = saved?.notes ?? [];
    const heldKey = held.current?.key ?? null;
    const present = new Set<string>();
    for (const note of notes) {
      const key = NOTE_PREFIX + note.id;
      present.add(key);
      const el = cardEls.current.get(key);
      const size = el?.offsetWidth
        ? { w: el.offsetWidth, h: el.offsetHeight }
        : NOTE_SIZE;
      const card = cards.current.get(key);
      if (!card)
        cards.current.set(key, {
          key,
          x: note.x,
          y: note.y,
          vx: 0,
          vy: 0,
          size,
          home: null,
          fixed: true,
          gliding: false,
          stiffness: 0,
        });
      else {
        card.size = size;
        // A note on its way (tidy) finishes its tween before taking the saved spot.
        if (heldKey !== key && !tweens.current.has(key)) {
          card.x = note.x;
          card.y = note.y;
        }
      }
    }
    for (const key of [...cards.current.keys()])
      if (isNoteKey(key) && !present.has(key)) cards.current.delete(key);
    const incoming = saved ? layoutSignature(saved.layout) : "";
    if (
      saved &&
      loaded.current &&
      incoming !== layoutSeen.current &&
      !held.current &&
      !savePending.current
    ) {
      // Another client changed the arrangement: glide to it. While this board
      // is mid-drag or has a save waiting, its own save follows and wins
      // (whole-layout last writer wins).
      layoutSeen.current = incoming;
      layout.current = placeNew(
        model,
        {
          anchors: new Map(Object.entries(saved.layout.anchors)),
          offsets: new Map(Object.entries(saved.layout.offsets)),
          pinned: new Map(Object.entries(saved.layout.pinned)),
        },
        { phone: isPhone(), sizeOf },
      );
      travelToLayout(model);
      const folded = new Set(saved.layout.folded);
      if (
        folded.size !== latest.current.collapsed.size ||
        [...folded].some((key) => !latest.current.collapsed.has(key))
      )
        setCollapsed(folded);
    }
    if (saved && !loaded.current) {
      // The first saved layout replaces the default one; new cards still get
      // free space.
      loaded.current = true;
      layoutSeen.current = incoming;
      layout.current = placeNew(
        model,
        {
          anchors: new Map(Object.entries(saved.layout.anchors)),
          offsets: new Map(Object.entries(saved.layout.offsets)),
          pinned: new Map(Object.entries(saved.layout.pinned)),
        },
        { phone: isPhone(), sizeOf },
      );
      for (const [key, point] of positions(model, layout.current)) {
        const card = cards.current.get(key);
        if (card) {
          card.x = point.x;
          card.y = point.y;
        }
      }
      setCollapsed(new Set(saved.layout.folded));
      fit(true);
    }
    invalidate("change");
    // The layout is read through refs; only saved state starts this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  /** Save the layout shortly after it changes; never before it has loaded. */
  const scheduleSave = () => {
    if (!loaded.current) return;
    window.clearTimeout(saveTimer.current);
    savePending.current = true;
    saveTimer.current = window.setTimeout(() => {
      const l = layout.current;
      const sent = {
        anchors: Object.fromEntries(l.anchors),
        offsets: Object.fromEntries(l.offsets),
        pinned: Object.fromEntries(l.pinned),
        folded: [...latest.current.collapsed],
      };
      // Its own save comes back unchanged and must not move anything.
      layoutSeen.current = layoutSignature(sent);
      void boardStore
        .patch([{ op: "layout.set", replace: true, ...sent }])
        .finally(() => {
          savePending.current = false;
        });
    }, SAVE_DELAY_MS);
  };
  useEffect(() => {
    scheduleSave();
    // scheduleSave reads refs only.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  /* ---------- Homes: anchor plus offset, read every frame ---------- */
  const baseOf = (key: string, m: BoardModel): Point | null => {
    const space = m.workspaceByKey.get(key);
    if (space)
      return layout.current.anchors.get(space.hostKey) ?? { x: 0, y: 0 };
    const tab = m.tabByKey.get(key);
    const owner = tab && cards.current.get(tab.workspaceKey);
    return owner ? { x: owner.x, y: owner.y } : null;
  };
  const homeOf = (key: string, m: BoardModel): Point | null => {
    const pinned = layout.current.pinned.get(key);
    if (pinned) return pinned;
    const base = baseOf(key, m);
    const offset = layout.current.offsets.get(key);
    return base && offset
      ? { x: base.x + offset.x, y: base.y + offset.y }
      : null;
  };
  const keepWhereItIs = (key: string, m: BoardModel) => {
    const card = cards.current.get(key);
    if (!card) return;
    if (layout.current.pinned.has(key)) {
      layout.current.pinned.set(key, { x: card.x, y: card.y });
      return;
    }
    const base = baseOf(key, m);
    if (base)
      layout.current.offsets.set(key, {
        x: card.x - base.x,
        y: card.y - base.y,
      });
    scheduleSave();
  };
  // The frame loop runs once; it reaches the current keepWhereItIs here.
  const keepRef = useRef(keepWhereItIs);
  keepRef.current = keepWhereItIs;

  /* ---------- Camera ---------- */
  const toWorld = (sx: number, sy: number): Point => {
    const rect = boardRef.current!.getBoundingClientRect();
    return {
      x: (sx - rect.left - cam.current.x) / cam.current.s,
      y: (sy - rect.top - cam.current.y) / cam.current.s,
    };
  };
  const zoomAt = (sx: number, sy: number, s: number) => {
    const rect = boardRef.current!.getBoundingClientRect();
    const at = toWorld(sx, sy);
    const next = clamp(s, MIN_ZOOM, MAX_ZOOM);
    cam.current = {
      s: next,
      x: sx - rect.left - at.x * next,
      y: sy - rect.top - at.y * next,
    };
    camGoal.current = null;
    invalidate("change");
  };
  const visibleCards = () => {
    const m = latest.current.model;
    const out: [string, PhysicsCard][] = [];
    for (const [key, card] of cards.current) {
      const tab = m.tabByKey.get(key);
      if (
        tab &&
        (farRef.current || latest.current.collapsed.has(tab.workspaceKey))
      )
        continue;
      out.push([key, card]);
    }
    return out;
  };
  function fit(instant: boolean) {
    const el = boardRef.current;
    if (!el) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const [key, card] of visibleCards()) {
      const shown = farRef.current ? shownSize(key) : undefined;
      const w = shown?.w ?? card.size.w;
      const h = shown?.h ?? card.size.h;
      x0 = Math.min(x0, card.x - w / 2);
      y0 = Math.min(y0, card.y - h / 2);
      x1 = Math.max(x1, card.x + w / 2);
      y1 = Math.max(y1, card.y + h / 2);
    }
    if (x0 === Infinity) return;
    const pad = farRef.current ? 110 : 70;
    x0 -= pad;
    y0 -= pad + 40;
    x1 += pad;
    y1 += pad;
    const vw = el.clientWidth - 24,
      vh = el.clientHeight - 80;
    const s = clamp(Math.min(vw / (x1 - x0), vh / (y1 - y0)), MIN_ZOOM, 1.1);
    const goal = {
      s,
      x: 12 + vw / 2 - ((x0 + x1) / 2) * s,
      y: 56 + vh / 2 - ((y0 + y1) / 2) * s,
    };
    if (
      instant ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      cam.current = goal;
    else camGoal.current = goal;
    invalidate("change");
  }

  /* ---------- Frame loop ---------- */
  /** One frame: tweens, physics, camera, then paint. True while moving. */
  const frame = (dt: number, reasons: ReadonlySet<string>) => {
    const m = latest.current.model;
    const holdingKey = held.current?.key ?? null;
    if (trace.enabled && [...reasons].some((reason) => reason !== "animate"))
      trace.record("frame", [...reasons]);
    for (const [key, tw] of tweens.current) {
      const card = cards.current.get(key);
      tw.t += dt;
      const k = 1 - Math.pow(1 - Math.min(1, tw.t / TWEEN_SECONDS), 3);
      if (card) {
        card.x = tw.fx + (tw.tx - tw.fx) * k;
        card.y = tw.fy + (tw.ty - tw.fy) * k;
      }
      if (tw.t >= TWEEN_SECONDS) tweens.current.delete(key);
    }
    let gliding = false;
    if (physics.current.heat > 0 || holdingKey) {
      const list = visibleCards().map(([key, card]) => {
        card.home = homeOf(key, m);
        card.fixed =
          isNoteKey(key) ||
          layout.current.pinned.has(key) ||
          tweens.current.has(key) ||
          holdingKey === key;
        return card;
      });
      for (const key of [
        ...stepPhysics(list, physics.current, dt / 2),
        ...stepPhysics(list, physics.current, dt / 2),
      ])
        keepWhereItIs(key, m);
      if (cool(list, physics.current, dt, Boolean(holdingKey)))
        for (const card of list) if (!card.fixed) keepWhereItIs(card.key, m);
      gliding = list.some((card) => card.gliding);
    }
    const goal = camGoal.current;
    if (goal) {
      const k = 1 - Math.pow(0.0015, dt);
      const c = cam.current;
      cam.current = {
        x: c.x + (goal.x - c.x) * k,
        y: c.y + (goal.y - c.y) * k,
        s: c.s + (goal.s - c.s) * k,
      };
      if (
        Math.abs(goal.x - c.x) + Math.abs(goal.y - c.y) < 0.5 &&
        Math.abs(goal.s - c.s) < 0.001
      ) {
        cam.current = goal;
        camGoal.current = null;
      }
    }
    const pv = panVelocity.current;
    if (pv) {
      cam.current = {
        ...cam.current,
        x: cam.current.x + pv.x * dt,
        y: cam.current.y + pv.y * dt,
      };
      const fr = Math.pow(0.9, dt * 60);
      pv.x *= fr;
      pv.y *= fr;
      if (Math.hypot(pv.x, pv.y) < 12) panVelocity.current = null;
    }
    const svg = svgRef.current;
    if (svg) paint(svg, m);
    return (
      tweens.current.size > 0 ||
      physics.current.heat > 0 ||
      Boolean(holdingKey) ||
      gliding ||
      camGoal.current !== null ||
      panVelocity.current !== null
    );
  };
  const frameRef = useRef(frame);
  frameRef.current = frame;
  // One loop per mount: a cleanup stops it for good, and React may mount a
  // component twice (development, remounts), so each mount makes its own.
  useEffect(() => {
    const element = boardRef.current;
    if (!element) return;
    const loop = createFrameLoop({
      element,
      frame: (dt, reasons) => frameRef.current(dt, reasons),
      onError: (error, reasons) => {
        console.error("Board frame failed", error);
        trace.record("error", {
          where: "frame",
          reasons: [...reasons],
          message: String(error),
        });
      },
    });
    loopRef.current = loop;
    loop.invalidate("mount");
    return () => {
      loop.stop();
      if (loopRef.current === loop) loopRef.current = null;
    };
  }, [trace]);

  /**
   * Tell World where the selected node and every node with an open Inspector
   * window are on screen, so it draws the line from each window to its card:
   * a pane's row, else its tab, else its workspace (folded or zoomed out).
   */
  function reportAnchors(m: BoardModel) {
    const props = anchorProps.current;
    if (!props.onNodeAnchorsChange) return;
    const board = boardRef.current;
    if (!board) return;
    const clip = boardRect();
    const wanted = new Set([
      ...(props.selectedId ? [props.selectedId] : []),
      ...props.conversationNodeIds,
    ]);
    const anchors: Record<string, WorldCanvasAnchor> = {};
    // A large board answers from geometry only: offsetParent forces a layout.
    const shown = (el: HTMLElement | null | undefined) =>
      !large.current && el && el.offsetParent !== null ? el : null;
    // A card not in layout (culled off screen on a large board) is placed
    // from its position and the camera, so its line still points at it.
    const c = cam.current;
    const fromCard = (key: string): DOMRect | null => {
      const card = cards.current.get(key);
      if (!card) return null;
      const w = card.size.w * c.s,
        h = card.size.h * c.s;
      return new DOMRect(
        clip.left + c.x + card.x * c.s - w / 2,
        clip.top + c.y + card.y * c.s - h / 2,
        w,
        h,
      );
    };
    for (const id of wanted) {
      let el: HTMLElement | null = null;
      let fallback: string | null = null;
      const space = m.workspaces.find((s) => s.space.id === id);
      if (space) {
        el = shown(cardEls.current.get(space.key));
        fallback = space.key;
      } else
        for (const tab of m.tabs) {
          const pane = tab.panes.find((p) => p.leaf.id === id);
          if (!pane) continue;
          // Zoomed out or folded, tabs are hidden (by opacity, so the DOM
          // still lays them out): the line goes to the workspace.
          const hidden =
            farRef.current || latest.current.collapsed.has(tab.workspaceKey);
          const card = hidden ? null : shown(cardEls.current.get(tab.key));
          el =
            shown(
              card?.querySelector<HTMLElement>(
                `[data-pane="${CSS.escape(pane.key)}"]`,
              ),
            ) ??
            card ??
            shown(cardEls.current.get(tab.workspaceKey));
          fallback = hidden ? tab.workspaceKey : tab.key;
          break;
        }
      // A large board never reads the DOM here (it forces a layout).
      const rect =
        el && !large.current
          ? el.getBoundingClientRect()
          : fallback
            ? fromCard(fallback)
            : null;
      if (rect) anchors[id] = edgeAnchor(rect, clip);
    }
    const signature = JSON.stringify(anchors, (_k, v) =>
      typeof v === "number" ? Math.round(v) : v,
    );
    if (signature === reportedAnchors.current) return;
    reportedAnchors.current = signature;
    props.onNodeAnchorsChange(anchors);
    props.onSelectedAnchorChange?.(
      props.selectedId ? (anchors[props.selectedId] ?? null) : null,
    );
  }
  useEffect(() => {
    reportedAnchors.current = "";
    invalidate("anchors");
    // invalidate only asks the frame loop for a frame.
  }, [selectedId, conversationNodeIds]);
  useEffect(
    () => () => {
      anchorProps.current.onNodeAnchorsChange?.(null);
      anchorProps.current.onSelectedAnchorChange?.(null);
    },
    [],
  );

  function paint(svg: SVGSVGElement, m: BoardModel) {
    const c = cam.current;
    const worldEl = worldRef.current,
      board = boardRef.current;
    if (!worldEl || !board) return;
    worldEl.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.s})`;
    const grid = 28 * c.s;
    board.style.backgroundSize = `${grid}px ${grid}px`;
    board.style.backgroundPosition = `${c.x}px ${c.y}px`;
    const nowFar = farRef.current ? c.s < OVERVIEW_OUT : c.s < OVERVIEW_IN;
    if (nowFar !== farRef.current) {
      farRef.current = nowFar;
      setFar(nowFar);
    }
    // Only cards on screen (with a margin) are laid out and painted, and
    // tabs not at all in the overview: a large World has far more cards than
    // a screen shows, and drawing them all stalled the browser.
    const culling = m.workspaces.length + m.tabs.length > CULL_ABOVE;
    const box = culling ? boardRect() : null;
    const viewW = box ? box.width : board.clientWidth,
      viewH = box ? box.height : board.clientHeight,
      margin = 240;
    const shownNow: [HTMLElement, PhysicsCard][] = [];
    // A large board renders (in React) only the cards near the screen; tell
    // React when that set changes.
    if (culling) {
      const reach = 700;
      const wanted = new Set<string>();
      for (const [key, card] of cards.current) {
        if (isNoteKey(key)) continue;
        if (farRef.current && m.tabByKey.has(key)) continue;
        const sx = c.x + card.x * c.s,
          sy = c.y + card.y * c.s;
        const hw = (card.size.w * c.s) / 2 + reach,
          hh = (card.size.h * c.s) / 2 + reach;
        if (
          sx + hw >= 0 &&
          sx - hw <= viewW &&
          sy + hh >= 0 &&
          sy - hh <= viewH
        )
          wanted.add(key);
      }
      if (held.current) wanted.add(held.current.key);
      for (const key of selectedKeysRef.current) wanted.add(key);
      const current = renderKeysRef.current;
      if (
        !current ||
        current.size !== wanted.size ||
        [...wanted].some((key) => !current.has(key))
      ) {
        renderKeysRef.current = wanted;
        startTransition(() => setRenderKeys(wanted));
      }
    } else if (renderKeysRef.current) {
      renderKeysRef.current = null;
      startTransition(() => setRenderKeys(null));
    }
    for (const [key, el] of cardEls.current) {
      const card = cards.current.get(key);
      if (!card) continue;
      const sx = c.x + card.x * c.s,
        sy = c.y + card.y * c.s;
      const hw = (card.size.w * c.s) / 2 + margin,
        hh = (card.size.h * c.s) / 2 + margin;
      const offscreen =
        sx + hw < 0 || sx - hw > viewW || sy + hh < 0 || sy - hh > viewH;
      const overviewTab = farRef.current && m.tabByKey.has(key);
      const inHand = held.current?.key === key;
      // Cards start hidden (CSS) until placed here, so the first frame never
      // lays out every card of a large World.
      const show = !((offscreen || overviewTab) && !inHand);
      if (culling && setAttr(el, "data-shown", show ? "true" : "false") && show)
        shownNow.push([el, card]);
      setStyle(
        el,
        "transform",
        `translate(${card.x}px, ${card.y}px) translate(-50%, -50%)`,
      );
    }
    // Cards that just appeared measure now, in one pass (one layout), so
    // placement and lines use their real sizes.
    if (!large.current)
      for (const [el, card] of shownNow)
        if (el.offsetWidth)
          card.size = { w: el.offsetWidth, h: el.offsetHeight };
    const used = new Set<string>();
    if (!farRef.current)
      for (const tab of m.tabs) {
        if (latest.current.collapsed.has(tab.workspaceKey)) continue;
        const a = cards.current.get(tab.workspaceKey),
          b = cards.current.get(tab.key);
        if (!a || !b) continue;
        let path = paths.current.get(tab.key);
        if (path && path.ownerSVGElement !== svg) path = undefined;
        if (!path) {
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("class", "board-tree");
          svg.appendChild(path);
          paths.current.set(tab.key, path);
        }
        const my = (a.y + b.y) / 2;
        setAttr(
          path,
          "d",
          `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`,
        );
        used.add(tab.key);
      }
    for (const [key, path] of paths.current)
      if (!used.has(key)) {
        path.remove();
        paths.current.delete(key);
      }
    paintStrings(svg, m);
    // Measure every zone first, then write: reading a card's size after
    // writing the previous zone forced a full layout per host.
    const zones: [HTMLElement, number, number, number, number][] = [];
    for (const host of m.hosts) {
      const zone = zoneEls.current.get(host.key);
      if (!zone) continue;
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const space of host.workspaceKeys) {
        const keys = [
          space,
          ...(farRef.current || latest.current.collapsed.has(space)
            ? []
            : (m.workspaceByKey.get(space)?.tabKeys ?? [])),
        ];
        for (const key of keys) {
          const card = cards.current.get(key);
          if (!card) continue;
          const shown = farRef.current ? shownSize(key) : undefined;
          const w = shown?.w ?? card.size.w;
          const h = shown?.h ?? card.size.h;
          x0 = Math.min(x0, card.x - w / 2);
          y0 = Math.min(y0, card.y - h / 2);
          x1 = Math.max(x1, card.x + w / 2);
          y1 = Math.max(y1, card.y + h / 2);
        }
      }
      zones.push([zone, x0, y0, x1, y1]);
    }
    const pad = farRef.current ? 70 : 46;
    for (const [zone, x0, y0, x1, y1] of zones) {
      zone.hidden = x0 === Infinity;
      if (zone.hidden) continue;
      setStyle(
        zone,
        "transform",
        `translate(${x0 - pad}px, ${y0 - pad - 10}px)`,
      );
      setStyle(zone, "width", `${x1 - x0 + pad * 2}px`);
      setStyle(zone, "height", `${y1 - y0 + pad * 2 + 10}px`);
    }
  }

  /** Where a string end is drawn: a note, a card, or a pane row in it. */
  function pointOf(
    end: BoardEnd,
    m: BoardModel,
  ): { at: Point; firm: boolean } | null {
    if ("note" in end) {
      const card = cards.current.get(NOTE_PREFIX + end.note);
      return card ? { at: { x: card.x, y: card.y }, firm: true } : null;
    }
    const anchorKey = `${end.anchor.connection_id}|${end.anchor.kind}|${end.anchor.native_id}`;
    const target = targetOf(m, end.anchor);
    if (!target) {
      // Off the board (filtered, not yet admitted, or gone): still drawn,
      // dashed, to where it was last seen or to its host's zone.
      const last = lastSeen.current.get(anchorKey);
      if (last) return { at: last, firm: false };
      const hostAnchor = m.hostByKey.has(end.anchor.connection_id)
        ? layout.current.anchors.get(end.anchor.connection_id)
        : undefined;
      return hostAnchor ? { at: hostAnchor, firm: false } : null;
    }
    // Cached topology from a failed host is never a firm target.
    const firm =
      confirmed(end.anchor, target) &&
      !m.hostByKey.get(end.anchor.connection_id)?.stale;
    let key = target.cardKey;
    const tab = m.tabByKey.get(key);
    // A tab hidden by the overview or a fold is drawn as its workspace.
    if (
      tab &&
      (farRef.current || latest.current.collapsed.has(tab.workspaceKey))
    )
      key = tab.workspaceKey;
    const card = cards.current.get(key);
    if (!card) return null;
    lastSeen.current.set(anchorKey, { x: card.x, y: card.y });
    if (key === target.cardKey && target.paneKey) {
      const el = cardEls.current.get(key);
      const row = el?.querySelector<HTMLElement>(
        `[data-pane="${CSS.escape(target.paneKey)}"]`,
      );
      if (el && row)
        return {
          at: {
            x: card.x,
            y:
              card.y -
              el.offsetHeight / 2 +
              row.offsetTop +
              row.offsetHeight / 2,
          },
          firm,
        };
    }
    return { at: { x: card.x, y: card.y }, firm };
  }
  const sag = (a: Point, b: Point) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const mid = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2 + Math.min(90, d * 0.18),
    };
    return {
      d: `M${a.x},${a.y} Q${mid.x},${mid.y} ${b.x},${b.y}`,
      mid: { x: (a.x + 2 * mid.x + b.x) / 4, y: (a.y + 2 * mid.y + b.y) / 4 },
    };
  };
  function paintStrings(svg: SVGSVGElement, m: BoardModel) {
    const strings = latest.current.saved?.strings ?? [];
    const seen = new Set<string>();
    let cutAt: Point | null = null;
    for (const string of strings) {
      if (string.detached) continue;
      const a = pointOf(string.from, m),
        b = pointOf(string.to, m);
      if (!a || !b) continue;
      seen.add(string.id);
      let pair = yarnEls.current.get(string.id);
      if (pair && pair[0]!.ownerSVGElement !== svg) pair = undefined;
      if (!pair) {
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        const hit = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        hit.setAttribute("class", "board-yarn-hit");
        hit.dataset.string = string.id;
        svg.append(line, hit);
        pair = [line, hit];
        yarnEls.current.set(string.id, pair);
      }
      const curve = sag(a.at, b.at);
      const loose = !a.firm || !b.firm;
      pair[0]!.setAttribute(
        "class",
        `board-yarn${loose ? " board-yarn-loose" : ""}${latest.current.picked === string.id ? " board-yarn-picked" : ""}`,
      );
      setAttr(pair[0]!, "d", curve.d);
      setAttr(pair[1]!, "d", curve.d);
      if (latest.current.picked === string.id) cutAt = curve.mid;
    }
    for (const [id, pair] of yarnEls.current)
      if (!seen.has(id)) {
        for (const el of pair) el.remove();
        yarnEls.current.delete(id);
      }
    const d = stringDrag.current;
    if (d) {
      const from = pointOf(endFor(d.from, m) ?? { note: "" }, m) ?? {
        at: d.at,
        firm: true,
      };
      if (tempYarn.current && tempYarn.current.ownerSVGElement !== svg)
        tempYarn.current = null;
      if (!tempYarn.current) {
        tempYarn.current = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        tempYarn.current.setAttribute("class", "board-yarn board-yarn-temp");
        svg.appendChild(tempYarn.current);
      }
      tempYarn.current.setAttribute("d", sag(from.at, d.at).d);
    } else if (tempYarn.current) {
      tempYarn.current.remove();
      tempYarn.current = null;
    }
    reportAnchors(m);
    const bar = barRef.current;
    const barCard = barKey.current ? cards.current.get(barKey.current) : null;
    if (bar && barCard && bar.firstElementChild) {
      const s = cam.current.s;
      const h = (cardEls.current.get(barCard.key)?.offsetHeight ?? 80) * s;
      const width = bar.offsetWidth,
        height = bar.offsetHeight;
      const board = boardRef.current;
      const boardW = board?.clientWidth ?? 0;
      const x = cam.current.x + barCard.x * s;
      const top = cam.current.y + barCard.y * s - h / 2;
      // Above the card, or below it when there is no room above.
      const y = top - height - 12 >= 8 ? top - height - 12 : top + h + 12;
      bar.style.left = `${Math.max(8, Math.min(boardW - width - 8, x - width / 2))}px`;
      bar.style.top = `${y}px`;
      bar.style.visibility = "visible";
    } else if (bar) bar.style.visibility = "hidden";
    const cut = cutRef.current;
    if (cut) {
      cut.hidden = !cutAt;
      if (cutAt) {
        cut.style.left = `${cam.current.x + cutAt.x * cam.current.s}px`;
        cut.style.top = `${cam.current.y + cutAt.y * cam.current.s}px`;
      }
    }
  }
  useEffect(() => {
    invalidate("change");
  }, [saved, picked]);

  /** The saved end for a card (or a pane in it), or null for an unknown card. */
  function endFor(end: StringEnd, m: BoardModel): BoardEnd | null {
    if (isNoteKey(end.cardKey))
      return { note: end.cardKey.slice(NOTE_PREFIX.length) };
    const anchor = anchorFor(m, end.cardKey, end.paneKey);
    if (!anchor) return null;
    // Tell the service which agent the user saw in the pane, so the string
    // is bound to that agent and not to whoever holds the pane by the time
    // the service looks.
    const leaf =
      anchor.kind === "pane"
        ? m.tabByKey
            .get(end.cardKey)
            ?.panes.find((pane) => pane.leaf.nativeId === anchor.native_id)
            ?.leaf
        : undefined;
    const raw = leaf?.pane as
      | { agent?: unknown; agent_session?: unknown }
      | undefined;
    if (leaf?.kind === "agent" && typeof raw?.agent === "string")
      anchor.observed = {
        agent: raw.agent,
        ...(raw.agent_session ? { session: raw.agent_session } : {}),
      };
    return { anchor };
  }
  /** The card and pane under a screen point, for a string's far end. */
  function endAt(x: number, y: number): StringEnd | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cardEl = el?.closest<HTMLElement>(".board-card");
    if (!cardEl?.dataset.key) return null;
    return {
      cardKey: cardEl.dataset.key,
      paneKey: el?.closest<HTMLElement>("[data-pane]")?.dataset.pane,
    };
  }

  /* ---------- Pointer input ---------- */
  /** What a pointer landed on; null for controls and text being edited. */
  function classify(target: HTMLElement): GestureTarget | null {
    if (target.closest("[contenteditable='true']")) return null;
    if (
      target.closest("button, input, a, label") &&
      !target.closest(".board-card")
    )
      return null;
    const hit = target.closest<SVGPathElement>(".board-yarn-hit");
    if (hit?.dataset.string) return { kind: "string", id: hit.dataset.string };
    const card = target.closest<HTMLElement>(".board-card");
    if (card?.dataset.key) {
      if (target.closest(".board-handle"))
        return { kind: "handle", key: card.dataset.key };
      return {
        kind: "card",
        key: card.dataset.key,
        paneKey: target.closest<HTMLElement>("[data-pane]")?.dataset.pane,
      };
    }
    const host = target.closest<HTMLElement>(".board-zone-label");
    if (host?.dataset.host) return { kind: "host", key: host.dataset.host };
    return { kind: "empty" };
  }
  /** Frequent effects are left out of the trace to keep it readable. */
  const QUIET = new Set([
    "panBy",
    "moveCard",
    "moveString",
    "pinch",
    "moveHost",
    "stopCamera",
  ]);
  function feed(event: GestureEvent) {
    const before = gesture.current.mode.name;
    const result = stepGesture(gesture.current, event);
    gesture.current = result.state;
    if (trace.enabled) {
      if (event.type !== "move") trace.record("input", event);
      if (result.state.mode.name !== before)
        trace.record("gesture", `${before} → ${result.state.mode.name}`);
      for (const effect of result.effects)
        if (!QUIET.has(effect.type)) trace.record("effect", effect);
    }
    for (const effect of result.effects) apply(effect);
  }
  const atOf = (event: ReactPointerEvent) => ({
    x: event.clientX,
    y: event.clientY,
  });
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = classify(event.target as HTMLElement);
    if (!target) return;
    lastPointerType.current = event.pointerType;
    if (target.kind !== "string")
      try {
        boardRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointers cannot be captured.
      }
    feed({
      type: "down",
      id: event.pointerId,
      at: atOf(event),
      time: performance.now(),
      target,
      primary: event.isPrimary,
      pointerType: event.pointerType,
    });
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.pointers.has(event.pointerId)) return;
    feed({
      type: "move",
      id: event.pointerId,
      at: atOf(event),
      time: performance.now(),
    });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.pointers.has(event.pointerId)) return;
    feed({
      type: "up",
      id: event.pointerId,
      at: atOf(event),
      time: performance.now(),
    });
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture.current.pointers.has(event.pointerId)) return;
    feed({ type: "cancel", id: event.pointerId });
  };

  /** Carry out what the gesture machine decided. */
  function apply(effect: GestureEffect) {
    switch (effect.type) {
      case "stopCamera":
        camGoal.current = null;
        panVelocity.current = null;
        return;
      case "panBy":
        cam.current = {
          ...cam.current,
          x: cam.current.x + effect.dx,
          y: cam.current.y + effect.dy,
        };
        boardRef.current?.classList.add("board-panning");
        invalidate("pan");
        return;
      case "fling":
        boardRef.current?.classList.remove("board-panning");
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          panVelocity.current = { x: effect.vx, y: effect.vy };
          invalidate("fling");
        }
        return;
      case "pinchStart":
        pinchStart.current = { cam: { ...cam.current }, mid: effect.mid };
        return;
      case "pinch": {
        const start = pinchStart.current,
          el = boardRef.current;
        if (!start || !el) return;
        const rect = el.getBoundingClientRect();
        const s = clamp(start.cam.s * effect.scale, MIN_ZOOM, MAX_ZOOM);
        const wx = (start.mid.x - rect.left - start.cam.x) / start.cam.s;
        const wy = (start.mid.y - rect.top - start.cam.y) / start.cam.s;
        cam.current = {
          s,
          x: effect.mid.x - rect.left - wx * s,
          y: effect.mid.y - rect.top - wy * s,
        };
        invalidate("pinch");
        return;
      }
      case "liftCard": {
        const card = cards.current.get(effect.key);
        if (!card) return;
        const grab = toWorld(effect.grab.x, effect.grab.y);
        held.current = {
          key: effect.key,
          grab: { x: grab.x - card.x, y: grab.y - card.y },
        };
        tweens.current.delete(effect.key);
        card.gliding = false;
        cardEls.current.get(effect.key)?.classList.add("board-lifted");
        moveHeld(effect.at);
        return;
      }
      case "moveCard":
        moveHeld(effect.at);
        return;
      case "dropCard":
        dropHeld(effect.vx / cam.current.s, effect.vy / cam.current.s);
        return;
      case "settleCard":
        dropHeld(0, 0);
        return;
      case "tap":
        boardRef.current?.classList.remove("board-panning");
        tap(effect.target);
        return;
      case "doubleTap":
        void createNote(toWorld(effect.at.x, effect.at.y));
        return;
      case "startString":
        stringDrag.current = {
          from: { cardKey: effect.key },
          at: toWorld(effect.at.x, effect.at.y),
          over: null,
        };
        invalidate("string");
        return;
      case "moveString": {
        const d = stringDrag.current;
        if (!d) return;
        d.at = toWorld(effect.at.x, effect.at.y);
        const over = endAt(effect.at.x, effect.at.y);
        const next = over && over.cardKey !== d.from.cardKey ? over : null;
        if (next?.cardKey !== d.over?.cardKey) {
          if (d.over)
            cardEls.current
              .get(d.over.cardKey)
              ?.classList.remove("board-link-target");
          if (next)
            cardEls.current
              .get(next.cardKey)
              ?.classList.add("board-link-target");
        }
        d.over = next;
        invalidate("string");
        return;
      }
      case "dropString": {
        const d = stringDrag.current;
        stringDrag.current = null;
        invalidate("string");
        if (!d) return;
        if (d.over) {
          cardEls.current
            .get(d.over.cardKey)
            ?.classList.remove("board-link-target");
          finishString(d.from, d.over);
        } else if (effect.travelled > 40)
          // Dropped on empty board: a new note, strung to where it started.
          void createNote(d.at, d.from);
        return;
      }
      case "cancelString": {
        const d = stringDrag.current;
        if (d?.over)
          cardEls.current
            .get(d.over.cardKey)
            ?.classList.remove("board-link-target");
        stringDrag.current = null;
        invalidate("string");
        return;
      }
      case "moveHost": {
        const anchor = layout.current.anchors.get(effect.key) ?? {
          x: 0,
          y: 0,
        };
        layout.current.anchors.set(effect.key, {
          x: anchor.x + effect.dx / cam.current.s,
          y: anchor.y + effect.dy / cam.current.s,
        });
        warmUp();
        return;
      }
      case "dropHost":
        warmUp();
        scheduleSave();
        return;
      case "pickString":
        setPicked(effect.id);
        return;
    }
  }

  /** Move the held card under the pointer; a tab over another workspace glues. */
  function moveHeld(screen: Point) {
    const h = held.current;
    const card = h && cards.current.get(h.key);
    if (!h || !card) return;
    const at = toWorld(screen.x, screen.y);
    card.x = at.x - h.grab.x;
    card.y = at.y - h.grab.y;
    card.vx = card.vy = 0;
    warmUp();
    const tab = latest.current.model.tabByKey.get(h.key);
    if (!tab) return;
    const under = document
      .elementsFromPoint(screen.x, screen.y)
      .map((el) =>
        (el as HTMLElement).closest?.<HTMLElement>(".board-workspace"),
      )
      .find((el) => el && el.dataset.key);
    const key = under?.dataset.key ?? null;
    const space = key
      ? latest.current.model.workspaceByKey.get(key)
      : undefined;
    const next =
      space &&
      space.key !== tab.workspaceKey &&
      space.hostKey === tab.hostKey &&
      space.actionable &&
      tab.actionable
        ? space.key
        : null;
    if (next !== glue.current) {
      if (glue.current)
        cardEls.current.get(glue.current)?.classList.remove("board-glue");
      cardEls.current
        .get(h.key)
        ?.classList.toggle("board-gluing", Boolean(next));
      if (next) cardEls.current.get(next)?.classList.add("board-glue");
      glue.current = next;
    }
  }

  /** Let go of the held card: a note is saved, a tab may move, others glide or stay. */
  function dropHeld(vx: number, vy: number) {
    const h = held.current;
    held.current = null;
    if (!h) return;
    const m = latest.current.model;
    const card = cards.current.get(h.key);
    cardEls.current.get(h.key)?.classList.remove("board-lifted");
    if (!card) return;
    if (isNoteKey(h.key)) {
      const note = latest.current.saved?.notes.find(
        (n) => NOTE_PREFIX + n.id === h.key,
      );
      if (note) void saveNote(note, { x: card.x, y: card.y });
      invalidate("note");
      return;
    }
    if (glue.current) {
      const workspaceKey = glue.current;
      cardEls.current.get(workspaceKey)?.classList.remove("board-glue");
      cardEls.current.get(h.key)?.classList.remove("board-gluing");
      glue.current = null;
      // The tab goes back to its place until the move is confirmed and done.
      travelToLayout(m);
      offerMove(h.key, workspaceKey);
      return;
    }
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (Math.hypot(vx, vy) < 80 || reduce) keepWhereItIs(h.key, m);
    else {
      card.vx = clamp(vx, -2200, 2200);
      card.vy = clamp(vy, -2200, 2200);
      card.gliding = true;
    }
    warmUp();
  }

  /** A tap: finish a pending string, select a note, zoom into an overview workspace, or select. */
  function tap(target: GestureTarget) {
    const m = latest.current.model;
    if (target.kind === "empty") {
      setPicked(null);
      setNoteSelected(null);
      setStringFrom(null);
      return;
    }
    if (target.kind !== "card") return;
    setPicked(null);
    if (stringFrom) {
      finishString(stringFrom, {
        cardKey: target.key,
        paneKey: target.paneKey,
      });
      setStringFrom(null);
      return;
    }
    if (isNoteKey(target.key)) {
      setNoteSelected(target.key.slice(NOTE_PREFIX.length));
      // Keys go to the note, not to a terminal that had focus.
      cardEls.current.get(target.key)?.focus({ preventScroll: true });
      return;
    }
    setNoteSelected(null);
    // In the overview a workspace tap zooms in on it, so its tabs open
    // where the user is looking; up close a tap selects as usual.
    if (farRef.current && m.workspaceByKey.has(target.key)) {
      focusWorkspace(target.key);
      return;
    }
    selectCard(target.key, m, target.paneKey);
  }

  const onWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    camGoal.current = null;
    panVelocity.current = null;
    if (event.shiftKey) {
      cam.current = {
        ...cam.current,
        x: cam.current.x - (event.deltaX || event.deltaY),
        y: cam.current.y - (event.deltaX ? event.deltaY : 0),
      };
      invalidate("change");
      return;
    }
    const k = event.deltaMode === 1 ? 0.06 : event.ctrlKey ? 0.012 : 0.0018;
    zoomAt(
      event.clientX,
      event.clientY,
      cam.current.s * Math.exp(-clamp(event.deltaY, -120, 120) * k),
    );
  }, []);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  /* ---------- Actions ---------- */
  function selectCard(key: string, m: BoardModel, paneKey?: string) {
    const space = m.workspaceByKey.get(key);
    if (space) return void latest.current.onSelect(space.space.id);
    const tab = m.tabByKey.get(key);
    const pane =
      tab &&
      (tab.panes.find((candidate) => candidate.key === paneKey) ??
        primaryPane(tab));
    if (pane) void latest.current.onSelect(pane.leaf.id);
  }
  const openTab = (tab: BoardTab, paneKey?: string) => {
    const pane =
      tab.panes.find((candidate) => candidate.key === paneKey) ??
      primaryPane(tab);
    if (pane && tab.actionable) void onOpenTerminal(pane.leaf.id);
  };
  /** Center a workspace and zoom in until its tabs show; unfold it if folded. */
  function focusWorkspace(key: string) {
    const el = boardRef.current;
    const card = cards.current.get(key);
    const space = latest.current.model.workspaceByKey.get(key);
    if (!el || !card || !space) return;
    if (latest.current.collapsed.has(key)) toggleFold(space);
    const s = Math.max(0.85, OVERVIEW_OUT + 0.1);
    const goal = {
      s,
      x: el.clientWidth / 2 - card.x * s,
      y: el.clientHeight / 2 - card.y * s,
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      cam.current = goal;
    else camGoal.current = goal;
    invalidate("change");
  }
  /** Send every card to its place in the layout on a short tween. */
  const travelToLayout = (m: BoardModel) => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const [key, to] of positions(m, layout.current)) {
      const card = cards.current.get(key);
      if (!card) continue;
      if (Math.hypot(card.x - to.x, card.y - to.y) < 1) {
        // Already there, but maybe on its way elsewhere (Undo during a
        // Tidy): stop that journey, or the card would end up where the
        // layout no longer says.
        tweens.current.delete(key);
        continue;
      }
      card.vx = card.vy = 0;
      card.gliding = false;
      if (reduce) {
        card.x = to.x;
        card.y = to.y;
      } else
        tweens.current.set(key, {
          fx: card.x,
          fy: card.y,
          tx: to.x,
          ty: to.y,
          t: 0,
        });
    }
    physics.current.heat = 0;
    invalidate("change");
    scheduleSave();
  };
  const toggleFold = (space: BoardWorkspace) => {
    const next = new Set(collapsed);
    if (next.has(space.key)) {
      next.delete(space.key);
      // Unfolded tabs take free space around their workspace and spring out.
      layout.current = tidy(model, layout.current, {
        workspaceKey: space.key,
        phone: isPhone(),
        sizeOf,
      });
      const owner = cards.current.get(space.key);
      for (const key of space.tabKeys) {
        const card = cards.current.get(key);
        if (card && owner && !layout.current.pinned.has(key)) {
          card.x = owner.x;
          card.y = owner.y;
        }
      }
      travelToLayout(model);
    } else next.add(space.key);
    setCollapsed(next);
  };
  const selectedWorkspace = (): string | undefined => {
    if (!selectedId) return undefined;
    for (const space of model.workspaces)
      if (space.space.id === selectedId) return space.key;
    for (const tab of model.tabs)
      if (tab.panes.some((pane) => pane.leaf.id === selectedId))
        return tab.workspaceKey;
    return undefined;
  };
  /**
   * After the board rearranges itself: a note strung to a card moves by as much
   * as that card did, so it stays beside what it is about, and any note that
   * would now sit on a card moves to the nearest free spot. Returns where the
   * notes were, for Undo.
   */
  const arrangeNotes = (from: BoardLayout, to: BoardLayout) => {
    const m = latest.current.model;
    const doc = latest.current.saved;
    const was = new Map<string, Point>();
    if (!doc?.notes.length) return was;
    const before = positions(m, from),
      after = positions(m, to);
    const collapsed = latest.current.collapsed;
    const obstacles: Rect[] = [];
    for (const [key, point] of after) {
      const tab = m.tabByKey.get(key);
      // Tabs hidden by the overview still count: zooming in shows them.
      if (tab && collapsed.has(tab.workspaceKey)) continue;
      obstacles.push(
        rectAt(
          sizeOf(key, m.workspaceByKey.has(key) ? "workspace" : "tab"),
          point,
        ),
      );
    }
    const wanted = doc.notes.map((note) => {
      let cardKey: string | null = null;
      for (const string of doc.strings) {
        if (string.detached || cardKey) continue;
        const ends = [string.from, string.to];
        if (!ends.some((end) => "note" in end && end.note === note.id))
          continue;
        for (const end of ends)
          if ("anchor" in end && !cardKey)
            cardKey = targetOf(m, end.anchor)?.cardKey ?? null;
      }
      const a = cardKey ? before.get(cardKey) : undefined,
        b = cardKey ? after.get(cardKey) : undefined;
      const el = cardEls.current.get(NOTE_PREFIX + note.id);
      // Where the note is on screen: a drop may not have saved yet.
      const live = cards.current.get(NOTE_PREFIX + note.id);
      const here = live ? { x: live.x, y: live.y } : { x: note.x, y: note.y };
      const size =
        el?.offsetWidth && !farRef.current
          ? { w: el.offsetWidth, h: el.offsetHeight }
          : { w: 180, h: 120 };
      return {
        key: note.id,
        size,
        here,
        at: a && b ? { x: here.x + b.x - a.x, y: here.y + b.y - a.y } : here,
      };
    });
    const spots = clearSpots(wanted, obstacles);
    const moves = new Map<string, Point>();
    for (const { key, here } of wanted) {
      const spot = spots.get(key)!;
      if (Math.hypot(spot.x - here.x, spot.y - here.y) < 1) continue;
      was.set(key, here);
      moves.set(key, spot);
    }
    placeNotes(moves);
    return was;
  };
  /** Glide notes to new places and save them in one batch. */
  const placeNotes = (moves: Map<string, Point>) => {
    const doc = latest.current.saved;
    if (!doc || !moves.size) return;
    const ops: BoardOp[] = [];
    for (const note of doc.notes) {
      const to = moves.get(note.id);
      if (!to) continue;
      const card = cards.current.get(NOTE_PREFIX + note.id);
      if (card)
        tweens.current.set(card.key, {
          fx: card.x,
          fy: card.y,
          tx: to.x,
          ty: to.y,
          t: 0,
        });
      ops.push({
        op: "note.put",
        note: {
          id: note.id,
          text: note.text,
          color: note.color,
          x: to.x,
          y: to.y,
        },
        rev: note.rev,
      });
    }
    invalidate("notes-follow");
    void report(boardStore.patch(ops));
  };
  const tidyFit = useRef(0);
  const runTidy = () => {
    const before = cloneLayout(layout.current);
    const workspaceKey = selectedWorkspace();
    layout.current = tidy(model, layout.current, {
      workspaceKey,
      phone: isPhone(),
      sizeOf,
    });
    travelToLayout(model);
    const notesWere = arrangeNotes(before, layout.current);
    window.clearTimeout(tidyFit.current);
    if (!workspaceKey)
      tidyFit.current = window.setTimeout(() => fit(false), 400);
    const label = workspaceKey
      ? model.workspaceByKey.get(workspaceKey)?.label
      : null;
    setToast({
      text: label ? `Tidied “${label}”` : "Tidied the board",
      undo: () => {
        // A quick Undo cancels Tidy's camera fit too.
        window.clearTimeout(tidyFit.current);
        layout.current = before;
        travelToLayout(latest.current.model);
        placeNotes(notesWere);
        setToast({ text: "Restored" });
      },
    });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.ms ?? (toast.undo ? 5000 : 2400),
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  /* ---------- Notes and strings ---------- */
  const report = async (pending: Promise<string | null>) => {
    const problem = await pending;
    if (problem) {
      trace.record("save", { problem });
      setToast({ text: problem });
    }
  };
  async function createNote(at: Point, stringTo?: StringEnd) {
    const id = newId();
    const notes = latest.current.saved?.notes ?? [];
    const color = NOTE_COLORS[notes.length % NOTE_COLORS.length]!;
    const ops: BoardOp[] = [
      { op: "note.put", note: { id, text: "", color, x: at.x, y: at.y } },
    ];
    const end = stringTo && endFor(stringTo, latest.current.model);
    if (end)
      ops.push({
        op: "string.put",
        string: { id: newId(), from: { note: id }, to: end },
      });
    const problem = await boardStore.patch(ops);
    if (problem) setToast({ text: problem });
    else {
      setNoteSelected(id);
      setEditing(id);
    }
  }
  const saveNote = (
    note: BoardNote,
    change: Partial<Omit<BoardNote, "id" | "rev">>,
  ) =>
    report(
      boardStore.patch([
        {
          op: "note.put",
          note: {
            id: note.id,
            text: note.text,
            color: note.color,
            x: note.x,
            y: note.y,
            ...change,
          },
          rev: note.rev,
        },
      ]),
    );
  /**
   * Save an edit against the revision editing started from. If the note
   * changed elsewhere meanwhile, the store refuses it; the draft is kept and
   * can still be saved over the newer text on purpose.
   */
  const saveDraft = async (started: BoardNote, text: string) => {
    const problem = await boardStore.patch([
      {
        op: "note.put",
        note: {
          id: started.id,
          text,
          color: started.color,
          x: started.x,
          y: started.y,
        },
        rev: started.rev,
      },
    ]);
    if (!problem) return;
    trace.record("save", { problem });
    const exists = latest.current.saved?.notes.some((n) => n.id === started.id);
    keepDraft({ started, text, reason: exists ? "changed" : "deleted" });
  };
  // The note being edited was deleted elsewhere: keep what was typed.
  useEffect(() => {
    const draft = draftRef.current;
    if (!editing || !draft || draft.started.id !== editing) return;
    if (saved?.notes.some((n) => n.id === editing)) return;
    setEditing(null);
    draftRef.current = null;
    if (draft.text.trim() && draft.text !== draft.started.text)
      keepDraft({
        started: draft.started,
        text: draft.text,
        reason: "deleted",
      });
  }, [saved, editing]);
  /**
   * Save a kept draft over its note or as a new note. The draft stays until
   * the store confirms the write; a failure or another conflict stays on it.
   */
  const recoverDraft = (draft: KeptDraft, mode: "over" | "new") => {
    const current = latest.current.saved?.notes.find(
      (n) => n.id === draft.started.id,
    );
    if (mode === "over" && !current) {
      keptDraftStore.update(draft.key, {
        reason: "deleted",
        error: "the note no longer exists",
      });
      return;
    }
    // The outcome is recorded in the draft store, even if Board has been
    // left by the time the write finishes.
    void keptDraftStore.save(draft.key, () =>
      boardStore.patch([
        mode === "over"
          ? {
              op: "note.put",
              note: {
                id: current!.id,
                text: draft.text,
                color: current!.color,
                x: current!.x,
                y: current!.y,
              },
              rev: current!.rev,
            }
          : {
              op: "note.put",
              note: {
                id: newId(),
                text: draft.text,
                color: draft.started.color,
                x: draft.started.x + 40,
                y: draft.started.y + 40,
              },
            },
      ]),
    );
  };
  const deleteNote = (note: BoardNote) => {
    setNoteSelected(null);
    void report(
      boardStore.patch([{ op: "note.delete", id: note.id, rev: note.rev }]),
    );
  };
  /** Finish a string; a tab with several panes asks which pane first. */
  function finishString(from: StringEnd, to: StringEnd) {
    const m = latest.current.model;
    if (from.cardKey === to.cardKey) return;
    const tab = m.tabByKey.get(to.cardKey);
    if (tab && tab.panes.length > 1 && !to.paneKey) {
      setChooser({ tabKey: tab.key, stringFrom: from });
      return;
    }
    const single = tab?.panes.length === 1 ? tab.panes[0]!.key : undefined;
    const a = endFor(from, m),
      b = endFor({ ...to, paneKey: to.paneKey ?? single }, m);
    if (!a || !b) return;
    const same = (x: BoardEnd, y: BoardEnd) =>
      "note" in x
        ? "note" in y && x.note === y.note
        : "anchor" in y &&
          x.anchor.connection_id === y.anchor.connection_id &&
          x.anchor.kind === y.anchor.kind &&
          x.anchor.native_id === y.anchor.native_id;
    const existing = latest.current.saved?.strings.find(
      (string) =>
        !string.detached &&
        ((same(string.from, a) && same(string.to, b)) ||
          (same(string.from, b) && same(string.to, a))),
    );
    if (existing) {
      setToast({ text: "Those two are already strung together" });
      return;
    }
    void report(
      boardStore.patch([
        {
          op: "string.put",
          string: { id: newId(), from: a, to: b },
        },
      ]),
    );
  }
  /**
   * Strings whose target is on the board but holds none of the terminals it
   * was made with (Herdr restarted, or a new session reuses the IDs), grouped
   * by host; and strings whose target is missing from a current host, to ask
   * the service about.
   */
  const anchorStates = useMemo(() => {
    const unconfirmed = new Map<
      string,
      { string: BoardString; end: "from" | "to"; terminals: string[] }[]
    >();
    const missing: {
      string: BoardString;
      end: "from" | "to";
      host: BoardHost;
      anchor: BoardAnchor;
    }[] = [];
    for (const string of saved?.strings ?? []) {
      if (string.detached) continue;
      for (const side of ["from", "to"] as const) {
        const end = string[side];
        if (!("anchor" in end)) continue;
        const host = model.hostByKey.get(end.anchor.connection_id);
        if (!host || host.stale) continue;
        const target = targetOf(model, end.anchor);
        if (target && !confirmed(end.anchor, target)) {
          const list = unconfirmed.get(host.key) ?? [];
          list.push({
            string,
            end: side,
            terminals: target.terminals.slice(0, 16),
          });
          unconfirmed.set(host.key, list);
        } else if (!target)
          missing.push({ string, end: side, host, anchor: end.anchor });
      }
    }
    return { unconfirmed, missing };
  }, [saved, model]);
  // Ask once per anchor whether a missing target is really gone; only
  // Herdr's own "not found" detaches the string.
  useEffect(() => {
    for (const item of anchorStates.missing) {
      // Keyed by the anchor too: after a move the new target is checked anew.
      const key = `${item.string.id}:${item.end}:${item.anchor.kind}:${item.anchor.native_id}`;
      if (checkedAnchors.current.has(key)) continue;
      checkedAnchors.current.add(key);
      void checkAnchor(item.host, item.anchor)
        .then((result) => {
          // A reply about an older runtime says nothing about this one.
          const host = latest.current.model.hostByKey.get(item.host.key);
          if (!host || host.generation !== item.host.generation) {
            checkedAnchors.current.delete(key);
            return;
          }
          if (result.state === "absent")
            void report(
              boardStore.patch([
                {
                  op: "string.detach",
                  id: item.string.id,
                  if_anchor: {
                    end: item.end,
                    connection_id: item.anchor.connection_id,
                    kind: item.anchor.kind,
                    native_id: item.anchor.native_id,
                  },
                },
              ]),
            );
          // Unknown or present: ask again after the next topology change.
          else checkedAnchors.current.delete(key);
        })
        .catch(() => checkedAnchors.current.delete(key));
    }
    // report and boardStore are stable for this purpose.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorStates, checkAnchor]);
  // Confirmed anchors on live hosts keep their witness in step with their
  // target's terminals, so continuity survives panes opening and closing.
  /** Witness writes in flight, so a refresh does not send one twice. */
  const rewitnessing = useRef(new Set<string>());
  useEffect(() => {
    const ops: BoardOp[] = [];
    for (const string of saved?.strings ?? []) {
      if (string.detached) continue;
      for (const end of ["from", "to"] as const) {
        const side = string[end];
        if (!("anchor" in side)) continue;
        const host = model.hostByKey.get(side.anchor.connection_id);
        if (!host || host.stale) continue;
        const witness = nextWitness(side.anchor, targetOf(model, side.anchor));
        const key = `${string.id}:${end}:${witness?.join(",")}`;
        if (!witness || rewitnessing.current.has(key)) continue;
        rewitnessing.current.add(key);
        ops.push({ op: "anchor.witness", string_id: string.id, end, witness });
      }
    }
    if (!ops.length) return;
    const keys = ops.map((op) =>
      op.op === "anchor.witness"
        ? `${op.string_id}:${op.end}:${op.witness.join(",")}`
        : "",
    );
    void report(boardStore.patch(ops)).finally(() => {
      for (const key of keys) rewitnessing.current.delete(key);
    });
    // report and boardStore are stable for this purpose.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, model]);
  const keepAnchors = (hostKey: string) => {
    const list = anchorStates.unconfirmed.get(hostKey) ?? [];
    void report(
      boardStore.patch(
        list.map(({ string, end, terminals }) => ({
          op: "anchor.witness" as const,
          string_id: string.id,
          end,
          witness: terminals,
        })),
      ),
    );
  };
  const detachAnchors = (hostKey: string) => {
    const ids = new Set(
      (anchorStates.unconfirmed.get(hostKey) ?? []).map(
        ({ string }) => string.id,
      ),
    );
    void report(
      boardStore.patch(
        [...ids].map((id) => ({ op: "string.detach" as const, id })),
      ),
    );
  };
  const detached = (saved?.strings ?? []).filter((string) => string.detached);

  /** The agents a note can be sent to: confirmed strings to agent panes. */
  const sendTargets = (noteId: string): SendTarget[] => {
    const out: SendTarget[] = [];
    for (const string of saved?.strings ?? []) {
      if (string.detached) continue;
      const ends = [string.from, string.to];
      if (!ends.some((end) => "note" in end && end.note === noteId)) continue;
      for (const end of ends) {
        if (!("anchor" in end) || end.anchor.kind !== "pane") continue;
        const target = targetOf(model, end.anchor);
        if (!target || !confirmed(end.anchor, target)) continue;
        const pane = model.tabByKey
          .get(target.cardKey)
          ?.panes.find((p) => p.key === target.paneKey);
        if (!pane?.isAgent) continue;
        // Only a current, actionable pane: cached topology from a failed
        // host can still show matching terminals.
        const owner = model.tabByKey.get(target.cardKey);
        if (
          !owner ||
          owner.stale ||
          !owner.actionable ||
          model.hostByKey.get(owner.hostKey)?.stale
        )
          continue;
        const terminal = end.anchor.witness.find((t) =>
          target.terminals.includes(t),
        )!;
        const tab = model.tabByKey.get(target.cardKey)!;
        // Two strings to the same pane are one place to send to.
        if (
          out.some(
            (o) =>
              o.connectionId === pane.leaf.connectionId &&
              o.paneId === pane.leaf.nativeId,
          )
        )
          continue;
        out.push({
          // Two agents of the same kind would read the same; name the tab.
          label: `${paneName(pane)} in ${tab.label}`,
          connectionId: pane.leaf.connectionId,
          generation: pane.leaf.generation,
          paneId: pane.leaf.nativeId,
          terminalId: terminal,
          stringId: string.id,
        });
      }
    }
    return out;
  };
  const send = async (
    note: BoardNote,
    target: SendTarget,
    confirmRecipient?: string,
  ) => {
    try {
      const outcome = await sendNote(target, note, confirmRecipient);
      // Another agent is in the pane (or Board never recorded which one the
      // note was for): send only if the user picks that agent.
      if (
        outcome.status === "refused" &&
        (outcome.reason === "replaced" || outcome.reason === "unbound") &&
        outcome.recipient
      ) {
        const recipient = outcome.recipient;
        setToast({
          text: outcome.message ?? "Another agent is in that pane.",
          action: `Send to ${outcome.agent ?? "it"}`,
          ms: 12_000,
          undo: () => {
            setToast(null);
            void send(note, target, recipient);
          },
        });
        return;
      }
      setToast({
        text:
          outcome.status === "sent"
            ? `Sent the note to ${target.label}`
            : (outcome.message ?? "The note was not sent."),
      });
    } catch (error) {
      setToast({ text: `The note may not have been sent: ${String(error)}` });
    }
  };
  /** Ask before moving a tab, unless the user said not to ask again. */
  function offerMove(tabKey: string, workspaceKey: string) {
    const m = latest.current.model;
    const tab = m.tabByKey.get(tabKey);
    const lastTab =
      (m.workspaceByKey.get(tab?.workspaceKey ?? "")?.tabKeys.length ?? 0) <= 1;
    // Closing a workspace is never silent, whatever "don't ask" says.
    if (readMoveNoAsk() && !lastTab) void runMove(tabKey, workspaceKey, false);
    else setMoveAsk({ tabKey, workspaceKey, lastTab });
  }
  async function runMove(
    tabKey: string,
    workspaceKey: string,
    allowClose: boolean,
  ) {
    setMoveAsk(null);
    const m = latest.current.model;
    const tab = m.tabByKey.get(tabKey),
      space = m.workspaceByKey.get(workspaceKey);
    if (!tab || !space) return;
    setToast({ text: `Moving ${tab.label} to ${space.label}…` });
    try {
      const outcome = await moveTab(tab, space, allowClose);
      if (outcome.status === "moved" && outcome.tab_id) {
        // The service rewrites saved strings for every move (here or in
        // another view) and broadcasts the board; refresh to draw them now.
        void boardStore.refresh();
        setToast({ text: `Moved ${tab.label} to ${space.label}` });
      } else if (outcome.reason === "room_would_close")
        setMoveAsk({ tabKey, workspaceKey, lastTab: true });
      else setToast({ text: outcome.message ?? `${tab.label} was not moved.` });
    } catch (error) {
      setToast({ text: `${tab.label} may not have moved: ${String(error)}` });
    }
  }
  /** A new terminal or agent in a workspace, with no note. */
  const addToWorkspace = async (
    space: BoardWorkspace,
    kind: string | null,
    name: string,
  ) => {
    setAddTo(null);
    if (!kind) {
      try {
        const outcome = await createTab(space, name || undefined);
        setToast({
          text: outcome?.namingProblem
            ? `Opened a terminal in ${space.label}, but it could not be named: ${outcome.namingProblem}`
            : `Opened a terminal in ${space.label}`,
        });
      } catch (error) {
        setToast({ text: `The terminal was not opened: ${String(error)}` });
      }
      return;
    }
    setToast({ text: `Starting ${kind} in ${space.label}…` });
    try {
      const outcome = await startAgent(space, kind, name || kind, "");
      setToast({
        text:
          outcome.status === "started"
            ? `Started ${kind} in ${space.label}`
            : (outcome.message ?? "The agent was not started."),
      });
    } catch (error) {
      setToast({ text: `The agent may not have started: ${String(error)}` });
    }
  };
  const startFromNote = async (
    note: BoardNote,
    space: BoardWorkspace,
    kind: string,
    chosenName: string,
  ) => {
    setStartFor(null);
    const name = chosenName || noteTabName(note);
    setToast({ text: `Starting ${kind} in ${space.label}…` });
    try {
      const outcome = await startAgent(space, kind, name, note.text);
      // String the note to the new pane whenever one was created, so the
      // agent can be found (and sent the note later if it was not ready).
      if (outcome.pane_id && outcome.terminal_id)
        await boardStore.patch([
          {
            op: "string.put",
            string: {
              id: newId(),
              from: { note: note.id },
              to: {
                anchor: {
                  connection_id: space.connectionId,
                  kind: "pane",
                  native_id: outcome.pane_id,
                  witness: [outcome.terminal_id],
                },
              },
            },
          },
        ]);
      setToast({
        text:
          outcome.status === "sent"
            ? `Started ${kind} in ${space.label} with the note`
            : (outcome.message ?? "The agent was not started."),
      });
    } catch (error) {
      setToast({ text: `The agent may not have started: ${String(error)}` });
    }
  };
  const cutString = (id: string) => {
    setPicked(null);
    // Hide at once; the next frame would, but not if the string is gone.
    if (cutRef.current) cutRef.current.hidden = true;
    void report(boardStore.patch([{ op: "string.delete", id }]));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement | null)?.closest?.(
          "input, textarea, [contenteditable='true']",
        )
      )
        return;
      if (event.key === "Delete" || event.key === "Backspace") {
        const {
          picked: string,
          noteSelected: noteId,
          saved: doc,
        } = latest.current;
        const note = noteId && doc?.notes.find((n) => n.id === noteId);
        if (string) {
          event.preventDefault();
          cutString(string);
        } else if (note) {
          event.preventDefault();
          deleteNote(note);
        }
      }
      if (event.key === "Escape") {
        setPicked(null);
        setStringFrom(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // cutString reads refs and the store only.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePulses = () => {
    const next = !pulses;
    setPulses(next);
    try {
      worldLocalStorage.setItem(PULSES_KEY, next ? "on" : "off");
    } catch {
      // Storage unavailable: the choice lasts for this page.
    }
  };

  /* ---------- Search ---------- */
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hit = new Set<string>();
    for (const tab of model.tabs) {
      const text = [
        tab.label,
        ...tab.panes.map(
          (pane) => `${pane.leaf.label} ${pane.leaf.agentLabel ?? ""}`,
        ),
      ]
        .join(" ")
        .toLowerCase();
      if (text.includes(q)) {
        hit.add(tab.key);
        hit.add(tab.workspaceKey);
      }
    }
    for (const space of model.workspaces)
      if (space.label.toLowerCase().includes(q)) hit.add(space.key);
    return hit;
  }, [model, query]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!selectedId) return keys;
    for (const space of model.workspaces)
      if (space.space.id === selectedId) keys.add(space.key);
    for (const tab of model.tabs)
      if (tab.panes.some((pane) => pane.leaf.id === selectedId))
        keys.add(tab.key);
    return keys;
  }, [model, selectedId]);
  selectedKeysRef.current = selectedKeys;

  /** Colours the user chose; a tab without its own takes its workspace's. */
  const cardColors = saved?.layout.colors ?? {};
  const tabColor = (tab: BoardTab) =>
    cardColors[tab.key] ?? cardColors[tab.workspaceKey];
  /** The workspace or tab whose colour the bar changes. */
  const colorKey =
    [...selectedKeys].find((key) => model.tabByKey.has(key)) ??
    [...selectedKeys].find((key) => model.workspaceByKey.has(key)) ??
    null;
  barKey.current = noteSelected ? NOTE_PREFIX + noteSelected : colorKey;
  useEffect(() => {
    invalidate("bar");
  }, [noteSelected, colorKey]);
  const setCardColor = (key: string, color: CardColor | null) =>
    void report(boardStore.patch([{ op: "card.color", key, color }]));

  const toolbar = (
    <WorldViewToolbar
      viewLabel="Board"
      query={query}
      onQueryChange={setQuery}
      resultLabel={
        matches
          ? matches.size
            ? `${matches.size} matches`
            : "No matches"
          : undefined
      }
      onSubmit={() => {
        const first = model.tabs.find((tab) => matches?.has(tab.key));
        if (first) selectCard(first.key, model);
      }}
    />
  );

  const ref = (key: string) => (el: HTMLElement | null) => {
    const previous = cardEls.current.get(key);
    if (previous && previous !== el) resizes.current?.unobserve(previous);
    if (el) {
      cardEls.current.set(key, el);
      resizes.current?.observe(el);
    } else cardEls.current.delete(key);
  };

  const culling = model.workspaces.length + model.tabs.length > CULL_ABOVE;
  return (
    <>
      {toolbarPortal ? createPortal(toolbar, toolbarPortal) : toolbar}
      {/* Search covers everything observed, including what the board leaves
          out, as in the other views. */}
      <WorldSearchResults world={world} query={query} onSelect={onSelect} />
      <div
        ref={boardRef}
        className={`board${far ? " board-far" : ""}${pulses ? "" : " board-no-pulse"}${culling ? " board-culling" : ""}`}
        aria-label="Board of hosts, workspaces and tabs"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onScroll={(event) => {
          // The board pans with its camera and never scrolls; focusing a note
          // (a phone keyboard) can scroll it anyway, hiding the note bar.
          const el = event.currentTarget;
          if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
        }}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={(event) => {
          // Phones fire dblclick after a double-tap too; touch has its own.
          if (lastPointerType.current !== "mouse") return;
          // The board holds pointer capture during a press, so the browser
          // aims dblclick at the board itself; ask what is really under it.
          // A pointer double-click is retargeted to the board itself (it holds
          // pointer capture), so ask what is under it; a keyboard, assistive
          // or synthetic one names its element.
          const own = event.target as HTMLElement;
          const under =
            own === event.currentTarget
              ? document.elementFromPoint(event.clientX, event.clientY)
              : null;
          const target = (under ?? own) as HTMLElement;
          const card = target.closest<HTMLElement>(".board-card");
          const key = card?.dataset.key;
          if (key && isNoteKey(key)) {
            setEditing(key.slice(NOTE_PREFIX.length));
            return;
          }
          const tab = key ? latest.current.model.tabByKey.get(key) : undefined;
          if (tab) {
            openTab(
              tab,
              target.closest<HTMLElement>("[data-pane]")?.dataset.pane,
            );
            return;
          }
          if (
            card ||
            target.closest(
              ".board-controls, .board-zone-label, .board-notebar, .board-chooser, .board-cut, .board-toast, .board-trace, .board-banner, .board-tray",
            )
          )
            return;
          void createNote(toWorld(event.clientX, event.clientY));
        }}
      >
        {/* The board stays mounted when the topology is empty for a moment
            (for example while a terminal opens), so its listeners, frame
            loop and string layer keep working when hosts come back. */}
        {!model.hosts.length ? (
          <div className="world-empty board-empty" role="status">
            <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
            <h2>No connected spaces yet</h2>
            <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
          </div>
        ) : null}
        <div ref={worldRef} className="board-world">
          {model.hosts.map((host) => (
            <div
              key={host.key}
              className={`board-zone${host.stale ? " board-stale" : ""}`}
              ref={(el) => {
                if (el) zoneEls.current.set(host.key, el);
                else zoneEls.current.delete(host.key);
              }}
            >
              <div
                className="board-zone-label"
                data-host={host.key}
                data-world-node-anchor={host.id}
                title="Drag to move the whole host"
              >
                {host.label}
                {host.stale ? (
                  <small>offline</small>
                ) : (
                  <button
                    type="button"
                    className="board-zone-add"
                    aria-label={`New workspace on ${host.label}`}
                    onClick={() => setNewWorkspaceOn(host)}
                  >
                    +
                  </button>
                )}
              </div>
            </div>
          ))}
          <svg ref={svgRef} className="board-wires" aria-hidden="true" />
          {/* Cards in their own container, new when a large board is built,
              so React appends them as one subtree instead of placing each
              among existing siblings (quadratic in cards). */}
          <div className="board-cards" key={built ? "built" : "frame"}>
            {(culling
              ? renderKeys
                ? model.workspaces.filter((space) => renderKeys.has(space.key))
                : // Until paint says what is on screen, nothing.
                  []
              : model.workspaces
            ).map((space) => {
              const folded = collapsed.has(space.key);
              const attention = space.statuses[0] === "blocked";
              return (
                <div
                  key={space.key}
                  ref={ref(space.key)}
                  data-key={space.key}
                  data-world-node-anchor={space.space.id}
                  role="button"
                  aria-pressed={selectedKeys.has(space.key)}
                  tabIndex={0}
                  aria-label={`Workspace ${space.label}, ${space.tabKeys.length} tabs`}
                  // Keyboard and assistive activation arrive as a click with no
                  // pointer (detail 0); pointer taps are handled as gestures.
                  onClick={(event) => {
                    if (event.detail === 0 && !fromNestedControl(event))
                      selectCard(space.key, model);
                  }}
                  style={tintStyle(cardColors[space.key])}
                  className={[
                    "board-card board-workspace",
                    cardColors[space.key] ? "board-tinted" : "",
                    folded ? "board-folded" : "",
                    attention ? "board-attn" : "",
                    space.stale ? "board-stale" : "",
                    selectedKeys.has(space.key) ? "board-selected" : "",
                    matches && !matches.has(space.key) ? "board-dim" : "",
                  ].join(" ")}
                  onKeyDown={(event) => {
                    if (fromNestedControl(event)) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectCard(space.key, model);
                    }
                  }}
                >
                  <div className="board-row">
                    <span className="board-label">{space.label}</span>
                    <button
                      type="button"
                      className="board-fold"
                      aria-label={`${folded ? "Open" : "Fold"} ${space.label}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      title={folded ? "Show the tabs" : "Fold the tabs away"}
                      onClick={() => toggleFold(space)}
                    >
                      {folded ? (
                        <>
                          {space.tabKeys.length}
                          <ChevronDown size={14} aria-hidden="true" />
                        </>
                      ) : (
                        <ChevronUp size={14} aria-hidden="true" />
                      )}
                    </button>
                    {space.actionable ? (
                      <button
                        type="button"
                        className="board-fold board-add"
                        aria-label={`New in ${space.label}`}
                        title="New terminal or agent"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => setAddTo(space.key)}
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  <span
                    className="board-handle"
                    title="Drag to string this to a note or card"
                  />
                  <div className="board-counts">{workspaceCounts(space)}</div>
                  <div className="board-sum" aria-hidden="true">
                    {space.squares.map((square, i) => (
                      <span
                        key={i}
                        className={
                          square.isAgent
                            ? `board-s-${square.status}`
                            : "board-sq-shell"
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
            {/* A large board in the overview draws no tabs at all (they are
              hidden there), so React does not rebuild thousands of tab cards
              on every topology update. */}
            {(culling
              ? far || !renderKeys
                ? []
                : model.tabs.filter((tab) => renderKeys.has(tab.key))
              : model.tabs
            ).map((tab) => {
              if (collapsed.has(tab.workspaceKey)) return null;
              const pane = primaryPane(tab);
              const multi = tab.panes.length > 1;
              const rows = rowsOf(tab, selectedId);
              const hidden = tab.panes.length - rows.length;
              return (
                <div
                  key={tab.key}
                  ref={ref(tab.key)}
                  data-key={tab.key}
                  data-world-node-anchor={
                    tab.panes.length === 1 ? tab.panes[0]!.leaf.id : undefined
                  }
                  role="button"
                  aria-pressed={selectedKeys.has(tab.key)}
                  tabIndex={0}
                  aria-label={`${tab.label}, ${tabSummary(tab)}`}
                  onClick={(event) => {
                    if (event.detail !== 0 || fromNestedControl(event)) return;
                    const row = (
                      event.target as HTMLElement
                    ).closest<HTMLElement>("[data-pane]");
                    selectCard(tab.key, model, row?.dataset.pane);
                  }}
                  style={tintStyle(tabColor(tab))}
                  className={[
                    "board-card board-tab",
                    `board-s-${tab.status}`,
                    tabColor(tab) ? "board-tinted" : "",
                    tab.shellOnly ? "board-terminal" : "",
                    multi ? "board-multi" : "",
                    tab.stale ? "board-stale" : "",
                    selectedKeys.has(tab.key) ? "board-selected" : "",
                    matches && !matches.has(tab.key) ? "board-dim" : "",
                  ].join(" ")}
                  onKeyDown={(event) => {
                    if (fromNestedControl(event)) return;
                    if (event.key === "Enter") {
                      event.preventDefault();
                      selectCard(tab.key, model);
                    }
                  }}
                >
                  <div className="board-row">
                    {tab.shellOnly ? (
                      <span className="board-prompt" aria-hidden="true">
                        &gt;_
                      </span>
                    ) : (
                      <span className="board-dot" />
                    )}
                    <span className="board-label">{tab.label}</span>
                    <span className="board-who">
                      {multi
                        ? `${tab.panes.length} panes`
                        : pane
                          ? paneName(pane)
                          : ""}
                    </span>
                  </div>
                  {multi ? (
                    <div className="board-panes">
                      {rows.map((row) => (
                        <div
                          key={row.key}
                          data-pane={row.key}
                          data-world-node-anchor={row.leaf.id}
                          role="button"
                          aria-pressed={selectedId === row.leaf.id}
                          className={`board-pane${row.isAgent ? ` board-s-${row.status}` : " board-pane-shell"}${selectedId === row.leaf.id ? " board-pane-selected" : ""}`}
                          aria-label={`${paneName(row)}, ${row.isAgent ? STATUS_LABEL[row.status] : "shell"}`}
                        >
                          {row.isAgent ? (
                            <span className="board-dot" />
                          ) : (
                            <span className="board-prompt" aria-hidden="true">
                              &gt;_
                            </span>
                          )}
                          <span className="board-pane-name">
                            {paneName(row)}
                          </span>
                          <span className="board-pane-state">
                            {row.isAgent ? STATUS_LABEL[row.status] : "shell"}
                          </span>
                        </div>
                      ))}
                      {hidden > 0 ? (
                        <button
                          type="button"
                          className="board-more"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setChooser({ tabKey: tab.key })}
                        >
                          +{hidden} more
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="board-line">
                      {tab.shellOnly ? "$ " : ""}
                      {pane
                        ? paneLine(pane, tab.status)
                        : STATUS_LABEL[tab.status]}
                    </div>
                  )}
                  <span className="board-badge" aria-hidden="true" />
                  <span
                    className="board-handle"
                    title="Drag to string this to a note or card"
                  />
                </div>
              );
            })}
          </div>
          {(saved?.notes ?? []).map((note) => (
            <div
              key={note.id}
              ref={ref(NOTE_PREFIX + note.id)}
              data-key={NOTE_PREFIX + note.id}
              role="button"
              tabIndex={0}
              aria-label={`Note: ${note.text || "empty"}`}
              className={[
                "board-card board-note",
                `board-note-${note.color}`,
                noteSelected === note.id ? "board-selected" : "",
              ].join(" ")}
              onKeyDown={(event) => {
                if (editing === note.id) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  setNoteSelected(note.id);
                  setEditing(note.id);
                } else if (
                  event.key === "Delete" ||
                  event.key === "Backspace"
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  deleteNote(note);
                }
              }}
            >
              <span className="board-tape" aria-hidden="true" />
              {editing === note.id ? (
                <NoteEditor
                  note={note}
                  onDraft={(started, text) => {
                    draftRef.current = { started, text };
                  }}
                  onDone={(started, text) => {
                    draftRef.current = null;
                    setEditing(null);
                    if (text !== started.text) void saveDraft(started, text);
                  }}
                />
              ) : (
                <div className="board-note-text">
                  {note.text || "Empty note"}
                </div>
              )}
              <span
                className="board-handle"
                title="Drag to string this note to a card"
              />
            </div>
          ))}
        </div>
        <button
          ref={cutRef}
          type="button"
          className="board-cut"
          aria-label="Delete string"
          hidden
          onClick={() => {
            if (picked) cutString(picked);
          }}
        >
          <Trash2 size={14} aria-hidden="true" />
          Delete
        </button>
        {unsaved.length ? (
          <div className="board-banner board-unsaved" role="alert">
            {unsaved.map((draft) => (
              <div key={draft.key} className="board-unsaved-row">
                <span>
                  {draft.reason === "deleted"
                    ? "This note was deleted on another device before your edit was saved:"
                    : "This note changed on another device, so your edit was not saved:"}{" "}
                  <q>{draft.text}</q>
                  {keptDraftStore.isStored(draft.key) ? null : (
                    <small className="board-unsaved-error">
                      {" "}
                      This browser could not store it, so it is lost if you
                      reload or close this tab: save it now or copy the text.
                    </small>
                  )}
                  {draft.error ? (
                    <small className="board-unsaved-error">
                      {" "}
                      Not saved yet: {draft.error}
                    </small>
                  ) : null}
                </span>
                {saved?.notes.some((n) => n.id === draft.started.id) ? (
                  <button
                    type="button"
                    disabled={keptDraftStore.isSaving(draft.key)}
                    onClick={() => recoverDraft(draft, "over")}
                  >
                    Keep mine
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={keptDraftStore.isSaving(draft.key)}
                  onClick={() => recoverDraft(draft, "new")}
                >
                  Save as a new note
                </button>
                <button
                  type="button"
                  disabled={keptDraftStore.isSaving(draft.key)}
                  onClick={() => keptDraftStore.remove(draft.key)}
                >
                  Discard
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {[...anchorStates.unconfirmed].map(([hostKey, list]) => (
          <div key={hostKey} className="board-banner" role="alert">
            <span>
              Herdr on {model.hostByKey.get(hostKey)?.label ?? hostKey} has
              restarted, so {list.length} string{list.length === 1 ? "" : "s"}{" "}
              can't be confirmed. Nothing is sent to{" "}
              {list.length === 1 ? "it" : "them"} until you choose.
            </span>
            <button type="button" onClick={() => keepAnchors(hostKey)}>
              Keep
            </button>
            <button type="button" onClick={() => detachAnchors(hostKey)}>
              Detach
            </button>
          </div>
        ))}
        {moveAsk &&
        model.tabByKey.get(moveAsk.tabKey) &&
        model.workspaceByKey.get(moveAsk.workspaceKey) ? (
          <MoveDialog
            tab={model.tabByKey.get(moveAsk.tabKey)!}
            space={model.workspaceByKey.get(moveAsk.workspaceKey)!}
            from={model.workspaceByKey.get(
              model.tabByKey.get(moveAsk.tabKey)!.workspaceKey,
            )}
            lastTab={moveAsk.lastTab}
            onCancel={() => setMoveAsk(null)}
            onMove={(noAsk) => {
              if (noAsk)
                try {
                  worldLocalStorage.setItem(MOVE_NO_ASK_KEY, "yes");
                } catch {
                  // Storage unavailable: ask again next time.
                }
              void runMove(
                moveAsk.tabKey,
                moveAsk.workspaceKey,
                moveAsk.lastTab,
              );
            }}
          />
        ) : null}
        {addTo && model.workspaceByKey.get(addTo) ? (
          <NewTabDialog
            workspaces={model.workspaces.filter((space) => space.actionable)}
            hostLabel={(space) =>
              model.hostByKey.get(space.hostKey)?.label ?? ""
            }
            initialWorkspace={addTo}
            onCancel={() => setAddTo(null)}
            onCreate={(space, kind, name) =>
              void addToWorkspace(space, kind, name)
            }
          />
        ) : null}
        {newWorkspaceOn ? (
          <Suspense fallback={null}>
            <CreateWorkspaceDialog
              open
              initialDestination={{
                connectionId: newWorkspaceOn.key,
                runtimeGeneration: newWorkspaceOn.generation,
              }}
              onClose={() => setNewWorkspaceOn(null)}
            />
          </Suspense>
        ) : null}
        {startFor && saved?.notes.find((n) => n.id === startFor) ? (
          <NewTabDialog
            note={saved.notes.find((n) => n.id === startFor)!}
            workspaces={model.workspaces.filter((space) => space.actionable)}
            hostLabel={(space) =>
              model.hostByKey.get(space.hostKey)?.label ?? ""
            }
            initialWorkspace={selectedWorkspace() ?? null}
            onCancel={() => setStartFor(null)}
            onCreate={(space, kind, name) =>
              void startFromNote(
                saved.notes.find((n) => n.id === startFor)!,
                space,
                kind!,
                name,
              )
            }
          />
        ) : null}
        {trayOpen && detached.length ? (
          <div
            className="board-chooser board-tray"
            role="dialog"
            aria-label="Needs a home"
          >
            <div className="board-chooser-head">
              <strong>Needs a home</strong>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setTrayOpen(false)}
              >
                ×
              </button>
            </div>
            <p className="board-tray-hint">
              These strings' targets have closed. Re-attach a note to another
              card, or discard the string; the notes stay on the board.
            </p>
            {detached.map((string) => {
              const noteEnd = [string.from, string.to].find(
                (end) => "note" in end,
              ) as { note: string } | undefined;
              const anchorEnd = [string.from, string.to].find(
                (end) => "anchor" in end,
              ) as { anchor: BoardAnchor } | undefined;
              const note =
                noteEnd && saved?.notes.find((n) => n.id === noteEnd.note);
              return (
                <div key={string.id} className="board-tray-row">
                  <span className="board-tray-text">
                    {note
                      ? `“${(note.text || "Empty note").slice(0, 48)}”`
                      : "A string"}
                    {anchorEnd
                      ? ` was strung to a closed ${anchorEnd.anchor.kind}`
                      : ""}
                  </span>
                  {note ? (
                    <button
                      type="button"
                      onClick={() => {
                        void report(
                          boardStore.patch([
                            { op: "string.delete", id: string.id },
                          ]),
                        );
                        setStringFrom({ cardKey: NOTE_PREFIX + note.id });
                        setTrayOpen(false);
                        setToast({
                          text: "Tap the card or pane to string the note to",
                        });
                      }}
                    >
                      Re-attach
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      void report(
                        boardStore.patch([
                          { op: "string.delete", id: string.id },
                        ]),
                      )
                    }
                  >
                    Discard
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {/* The bars ride above their card, clear of the Inspector. */}
        <div ref={barRef} className="board-bar-anchor">
          {!noteSelected && colorKey ? (
            <CardBar
              label={
                model.tabByKey.get(colorKey)?.label ??
                model.workspaceByKey.get(colorKey)?.label ??
                ""
              }
              color={cardColors[colorKey] ?? null}
              onColor={(color) => setCardColor(colorKey, color)}
            />
          ) : null}
          {noteSelected && saved?.notes.find((n) => n.id === noteSelected) ? (
            <NoteBar
              note={saved.notes.find((n) => n.id === noteSelected)!}
              targets={sendTargets(noteSelected)}
              onSend={(target) =>
                void send(
                  saved.notes.find((n) => n.id === noteSelected)!,
                  target,
                )
              }
              onColor={(color) => {
                const note = saved.notes.find((n) => n.id === noteSelected)!;
                void saveNote(note, { color });
              }}
              onEdit={() => setEditing(noteSelected)}
              onString={() => {
                setStringFrom({ cardKey: NOTE_PREFIX + noteSelected });
                setToast({
                  text: "Tap the card or pane to string the note to",
                });
              }}
              onDelete={() =>
                deleteNote(saved.notes.find((n) => n.id === noteSelected)!)
              }
              onStart={() => setStartFor(noteSelected)}
            />
          ) : null}
        </div>
        {chooser && model.tabByKey.get(chooser.tabKey) ? (
          <div
            className="board-chooser"
            role="dialog"
            aria-label={`Panes in ${model.tabByKey.get(chooser.tabKey)!.label}`}
          >
            <div className="board-chooser-head">
              <strong>
                {chooser.stringFrom ? "String to which pane in " : ""}
                {model.tabByKey.get(chooser.tabKey)!.label}
              </strong>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setChooser(null)}
              >
                ×
              </button>
            </div>
            {model.tabByKey.get(chooser.tabKey)!.panes.map((row) => (
              <button
                key={row.key}
                type="button"
                className={`board-pane${row.isAgent ? ` board-s-${row.status}` : " board-pane-shell"}`}
                onClick={() => {
                  if (chooser.stringFrom)
                    finishString(chooser.stringFrom, {
                      cardKey: chooser.tabKey,
                      paneKey: row.key,
                    });
                  else void onSelect(row.leaf.id);
                  setChooser(null);
                }}
                onDoubleClick={() => {
                  if (
                    !chooser.stringFrom &&
                    model.tabByKey.get(chooser.tabKey)!.actionable
                  )
                    void onOpenTerminal(row.leaf.id);
                }}
              >
                {row.isAgent ? (
                  <span className="board-dot" />
                ) : (
                  <span className="board-prompt" aria-hidden="true">
                    &gt;_
                  </span>
                )}
                <span className="board-pane-name">{paneName(row)}</span>
                <span className="board-pane-state">
                  {row.isAgent ? STATUS_LABEL[row.status] : "shell"}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div
          className="board-controls"
          role="group"
          aria-label="Board controls"
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              const r = boardRef.current!.getBoundingClientRect();
              zoomAt(
                r.left + r.width / 2,
                r.top + r.height / 2,
                cam.current.s / 1.25,
              );
            }}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Fit everything"
            onClick={() => fit(false)}
          >
            <Maximize2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              const r = boardRef.current!.getBoundingClientRect();
              zoomAt(
                r.left + r.width / 2,
                r.top + r.height / 2,
                cam.current.s * 1.25,
              );
            }}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={
              selectedWorkspace()
                ? "Tidy this workspace's tabs"
                : "Tidy the board"
            }
            onClick={runTidy}
          >
            <Sparkles size={15} aria-hidden="true" />
          </button>
          {detached.length ? (
            <button
              type="button"
              className="board-tray-button"
              aria-label={`Needs a home: ${detached.length} string${detached.length === 1 ? "" : "s"}`}
              onClick={() => setTrayOpen(!trayOpen)}
            >
              {detached.length}
            </button>
          ) : null}
          <div className="board-menu-wrap">
            <button
              type="button"
              aria-label="Board settings"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <EllipsisVertical size={16} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="board-menu" role="menu">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={pulses}
                  onClick={togglePulses}
                >
                  Status pulses <span className="board-switch" />
                </button>
                {DEVTOOLS ? (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={tracing}
                    onClick={() => setTrace(!tracing)}
                  >
                    Event trace <span className="board-switch" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        {DEVTOOLS && tracing ? (
          <TraceOverlay
            view="board"
            trace={trace}
            status={() => ({
              mode: gesture.current.mode.name,
              pointers: gesture.current.pointers.size,
            })}
            onClose={() => setTrace(false)}
          />
        ) : null}
        {toast ? (
          <div className="board-toast" role="status">
            <span>{toast.text}</span>
            {toast.undo ? (
              <button type="button" onClick={() => toast.undo?.()}>
                {toast.action ?? "Undo"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * A note being edited. The draft and the revision it started from are kept
 * from the moment editing begins, so a refresh from another client neither
 * replaces the unfinished text nor lets the save overwrite that client's edit.
 */
function NoteEditor({
  note,
  onDraft,
  onDone,
}: {
  note: BoardNote;
  onDraft(started: BoardNote, text: string): void;
  onDone(started: BoardNote, text: string): void;
}) {
  const [started] = useState(note);
  return (
    <div
      className="board-note-text"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Note text"
      ref={(el) => {
        if (el && document.activeElement !== el) {
          // Never scroll World's page for the keyboard: on a phone the page
          // stayed scrolled and hid the note bar.
          el.focus({ preventScroll: true });
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          getSelection()?.removeAllRanges();
          getSelection()?.addRange(range);
        }
      }}
      onInput={(event) =>
        onDraft(started, event.currentTarget.textContent ?? "")
      }
      onBlur={(event) =>
        onDone(started, event.currentTarget.textContent?.trim() ?? "")
      }
      onKeyDown={(event) => {
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.metaKey || event.ctrlKey))
        ) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    >
      {started.text}
    </div>
  );
}

/** This page's kept drafts, shared with the browser's other World tabs. */
const keptDraftStore = createDraftStore(
  (() => {
    try {
      return worldLocalStorage;
    } catch {
      return null;
    }
  })(),
);
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.includes(KEPT_DRAFTS_KEY))
      keptDraftStore.refresh();
  });

/** A note's first words, as the name of the tab it starts. */
const noteTabName = (note: BoardNote) =>
  note.text.trim().split(/\s+/).slice(0, 3).join(" ").slice(0, 40) || "note";

/**
 * One dialog for a new tab: from a workspace's + (workspace chosen) or from a
 * note (the agent is sent the note). The user picks the workspace and what to
 * start, may name the tab, and confirms; nothing starts until Create.
 */
function NewTabDialog({
  note,
  workspaces,
  hostLabel,
  initialWorkspace,
  onCancel,
  onCreate,
}: {
  note?: BoardNote;
  workspaces: BoardWorkspace[];
  hostLabel(space: BoardWorkspace): string;
  initialWorkspace: string | null;
  onCancel(): void;
  onCreate(space: BoardWorkspace, kind: string | null, name: string): void;
}) {
  const [workspace, setWorkspace] = useState(
    initialWorkspace && workspaces.some((s) => s.key === initialWorkspace)
      ? initialWorkspace
      : "",
  );
  // null is a plain terminal; a note always starts an agent.
  const [kind, setKind] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");
  const kinds: { kind: string | null; label: string }[] = [
    ...(note ? [] : [{ kind: null, label: "Terminal" }]),
    ...START_KINDS,
  ];
  const space = workspaces.find((s) => s.key === workspace);
  const title = note
    ? "Start an agent with this note"
    : `New tab${space ? ` in ${space.label}` : ""}`;
  return (
    <div
      className="board-chooser board-newtab"
      role="dialog"
      aria-label={title}
    >
      <div className="board-chooser-head">
        <strong>{title}</strong>
        <button type="button" aria-label="Close" onClick={onCancel}>
          ×
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (space && kind !== undefined) onCreate(space, kind, name.trim());
        }}
      >
        <label className="board-field">
          <span>Workspace</span>
          <select
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          >
            <option value="" disabled>
              Choose a workspace
            </option>
            {workspaces.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} · {hostLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="board-field">
          <legend>Start</legend>
          <div className="board-kinds" role="radiogroup">
            {kinds.map((choice) => (
              <button
                key={choice.label}
                type="button"
                role="radio"
                aria-checked={kind === choice.kind}
                onClick={() => setKind(choice.kind)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="board-field">
          <span>Tab name (optional)</span>
          <input
            value={name}
            maxLength={64}
            placeholder={note ? noteTabName(note) : "Herdr names it"}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {note ? (
          <p className="board-tray-hint">
            The note is sent once the agent is ready.
          </p>
        ) : null}
        <div className="board-dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="board-primary"
            disabled={!space || kind === undefined}
          >
            {note ? "Start and send" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** A workspace's agents by status, and its shells: "3 agents · 1 working · 2 idle". */
const COUNT_ORDER: [WorldAgentStatus, string][] = [
  ["blocked", "waiting"],
  ["working", "working"],
  ["done", "done"],
  ["idle", "idle"],
  ["unknown", "unknown"],
];
function workspaceCounts(space: BoardWorkspace) {
  const agents = space.squares.filter((square) => square.isAgent);
  const shells = space.squares.length - agents.length;
  const parts = [`${agents.length} agent${agents.length === 1 ? "" : "s"}`];
  for (const [status, word] of COUNT_ORDER) {
    const n = agents.filter((square) => square.status === status).length;
    if (n) parts.push(`${n} ${word}`);
  }
  if (shells) parts.push(`${shells} shell${shells === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
const NO_IDS: readonly string[] = [];
const EMPTY_MODEL = projectBoard({
  hosts: [],
  spaces: [],
  leaves: [],
  nodes: [],
  nodeById: new Map(),
} as unknown as WorldObject);
/**
 * Above this many workspace and tab cards, Board lays out only the cards on
 * screen (and no tabs in the overview). Below it every card stays in layout,
 * as a typical board needs for measuring and placing.
 */
const CULL_ABOVE = 300;
/**
 * The values paint last wrote, per element. A frame rewrites only what
 * changed: rewriting every card's transform and every line's path on each
 * frame made the browser restyle and repaint the whole board (hundreds of
 * cards at a large World's scale) for every topology update.
 */
const written = new WeakMap<Element, Map<string, string>>();
function changed(el: Element, name: string, value: string) {
  let values = written.get(el);
  if (!values) written.set(el, (values = new Map()));
  if (values.get(name) === value) return false;
  values.set(name, value);
  return true;
}
function setStyle(
  el: HTMLElement,
  name: "transform" | "width" | "height",
  value: string,
) {
  if (changed(el, `style:${name}`, value)) el.style[name] = value;
}
function setAttr(el: Element, name: string, value: string) {
  if (!changed(el, name, value)) return false;
  el.setAttribute(name, value);
  return true;
}
/** A saved layout, comparable regardless of key order or float noise. */
function layoutSignature(layout: {
  anchors: Record<string, Point>;
  offsets: Record<string, Point>;
  pinned: Record<string, Point>;
  folded: string[];
}) {
  const points = (map: Record<string, Point>) =>
    Object.entries(map)
      .map(([key, p]) => `${key}:${Math.round(p.x)},${Math.round(p.y)}`)
      .sort()
      .join(";");
  return [
    points(layout.anchors),
    points(layout.offsets),
    points(layout.pinned),
    [...layout.folded].sort().join(";"),
  ].join("|");
}
/** A card's right edge as a line anchor, pinned to the board's edge when off screen. */
function edgeAnchor(rect: DOMRect, clip: DOMRect): WorldCanvasAnchor {
  const visible =
    rect.right > clip.left &&
    rect.left < clip.right &&
    rect.bottom > clip.top &&
    rect.top < clip.bottom;
  const cx = (rect.left + rect.right) / 2,
    cy = (rect.top + rect.bottom) / 2;
  return {
    x: Math.max(clip.left + 4, Math.min(clip.right - 4, rect.right)),
    y: Math.max(clip.top + 4, Math.min(clip.bottom - 4, cy)),
    visible,
    edge: visible
      ? null
      : cy < clip.top
        ? "top"
        : cy > clip.bottom
          ? "bottom"
          : cx < clip.left
            ? "left"
            : "right",
  };
}
const tintStyle = (color: CardColor | undefined) =>
  color ? ({ "--tint": `var(--card-${color})` } as CSSProperties) : undefined;

/** The selected workspace or tab's colour: the user's choice, never a status. */
function CardBar({
  label,
  color,
  onColor,
}: {
  label: string;
  color: CardColor | null;
  onColor(color: CardColor | null): void;
}) {
  return (
    <div
      className="board-notebar"
      role="toolbar"
      aria-label={`Colour of ${label}`}
    >
      {CARD_COLORS.map((choice) => (
        <button
          key={choice}
          type="button"
          className="board-swatch board-card-swatch"
          style={tintStyle(choice)}
          aria-label={`Colour ${choice}`}
          aria-pressed={color === choice}
          onClick={() => onColor(choice)}
        />
      ))}
      <button
        type="button"
        aria-pressed={color === null}
        onClick={() => onColor(null)}
      >
        No colour
      </button>
    </div>
  );
}

/** Actions for the selected note: colour, edit, string and delete. */
function NoteBar({
  note,
  targets,
  onSend,
  onColor,
  onEdit,
  onString,
  onDelete,
  onStart,
}: {
  note: BoardNote;
  targets: SendTarget[];
  onSend(target: SendTarget): void;
  onColor(color: BoardNote["color"]): void;
  onEdit(): void;
  onString(): void;
  onDelete(): void;
  onStart(): void;
}) {
  return (
    <div className="board-notebar" role="toolbar" aria-label="Note">
      {NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`board-swatch board-note-${color}`}
          aria-label={`Colour ${color}`}
          aria-pressed={note.color === color}
          onClick={() => onColor(color)}
        />
      ))}
      {targets.map((target) => (
        <button
          key={`${target.connectionId}:${target.paneId}`}
          type="button"
          className="board-primary"
          disabled={!note.text.trim()}
          onClick={() => onSend(target)}
        >
          Send to {target.label}
        </button>
      ))}
      <button type="button" onClick={onEdit}>
        Edit
      </button>
      <button type="button" onClick={onString}>
        String to…
      </button>
      <button type="button" disabled={!note.text.trim()} onClick={onStart}>
        Start an agent…
      </button>
      <button type="button" className="board-danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

/** "Move the terminal to <workspace>?", with "Don't ask again". */
function MoveDialog({
  tab,
  space,
  from,
  lastTab,
  onCancel,
  onMove,
}: {
  tab: BoardTab;
  space: BoardWorkspace;
  from: BoardWorkspace | undefined;
  lastTab: boolean;
  onCancel(): void;
  onMove(noAsk: boolean): void;
}) {
  const [noAsk, setNoAsk] = useState(false);
  const what = tab.shellOnly
    ? "terminal"
    : tab.panes.some((pane) => pane.isAgent)
      ? "tab and its agents"
      : "tab";
  return (
    <div
      className="board-chooser board-move"
      role="dialog"
      aria-label={`Move ${tab.label}`}
    >
      <div className="board-chooser-head">
        <strong>
          Move the {what} “{tab.label}” to {space.label}?
        </strong>
      </div>
      {lastTab ? (
        <p className="board-tray-hint board-warn">
          It is the last tab in {from?.label ?? "its workspace"}; moving it
          closes that workspace.
        </p>
      ) : (
        <p className="board-tray-hint">
          Its panes keep running; their notes and strings move with them.
        </p>
      )}
      {!lastTab ? (
        <label className="board-noask">
          <input
            type="checkbox"
            checked={noAsk}
            onChange={(event) => setNoAsk(event.target.checked)}
          />
          Don't ask again
        </label>
      ) : null}
      <div className="board-move-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="board-primary-button"
          onClick={() => onMove(noAsk)}
        >
          {lastTab ? "Move and close the workspace" : "Move"}
        </button>
      </div>
    </div>
  );
}
