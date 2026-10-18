import {
  EllipsisVertical,
  Maximize2,
  Minus,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { worldLocalStorage } from "../browserStorage";
import { anchorFor, confirmed, targetOf } from "./board/boardAnchors";
import {
  NOTE_COLORS,
  sharedBoardStore,
  useBoardDocument,
  type BoardDocumentStore,
  type BoardEnd,
  type BoardNote,
  type BoardOp,
} from "./board/boardDocument";
import {
  boardStatusOrder,
  projectBoard,
  type BoardModel,
  type BoardPane,
  type BoardTab,
  type BoardWorkspace,
} from "./board/boardModel";
import {
  cool,
  stepPhysics,
  warm,
  type PhysicsCard,
  type PhysicsState,
} from "./board/boardPhysics";
import {
  DEFAULT_SIZE,
  cloneLayout,
  emptyLayout,
  placeNew,
  positions,
  tidy,
  type BoardLayout,
  type Point,
  type Size,
} from "./board/boardPlacement";
import type { WorldAgentStatus, WorldObject } from "./worldObject";
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

type Drag =
  | {
      type: "pan";
      lx: number;
      ly: number;
      sx: number;
      sy: number;
      hist: Sample[];
    }
  | {
      type: "card";
      key: string;
      offX: number;
      offY: number;
      sx: number;
      sy: number;
      lifted: boolean;
      hist: Sample[];
      /** The pane row pressed, for a tap that selects that pane. */
      paneKey?: string;
    }
  | { type: "host"; key: string; last: Point }
  | {
      type: "string";
      from: StringEnd;
      sx: number;
      sy: number;
      at: Point;
      over: StringEnd | null;
    }
  | { type: "pinch"; d0: number; s0: number; m0: Point; cam0: Camera };
/** A card (note, workspace or tab) and optionally one of its panes. */
type StringEnd = { cardKey: string; paneKey?: string };
const NOTE_PREFIX = "note:";
const isNoteKey = (key: string) => key.startsWith(NOTE_PREFIX);
const NOTE_SIZE: Size = { w: 180, h: 110 };
const SAVE_DELAY_MS = 600;
const DOUBLE_TAP_MS = 450;

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
};
export type SendOutcome = { status: string; message?: string; agent?: string };
async function sendNoteThroughService(target: SendTarget, text: string) {
  const { bridge } = await import("../api");
  return (await bridge
    .connection(target.connectionId, target.generation)
    .call(
      "board.send_note",
      { pane_id: target.paneId, terminal_id: target.terminalId, text },
      30_000,
    )) as SendOutcome;
}
type Sample = { x: number; y: number; t: number };
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

function velocity(hist: Sample[]) {
  if (hist.length < 2) return { x: 0, y: 0 };
  const last = hist[hist.length - 1]!;
  const first = hist.find((h) => last.t - h.t < 110) ?? hist[0]!;
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0 || performance.now() - last.t > 90) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
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
function rowsOf(tab: BoardTab): BoardPane[] {
  if (tab.panes.length <= MAX_ROWS) return tab.panes;
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

export default function BoardView({
  world,
  toolbarPortal = null,
  selectedId,
  onSelect,
  onOpenTerminal,
  store,
  sendNote = sendNoteThroughService,
}: {
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  onSelect(id: string): unknown;
  onOpenTerminal(id: string): unknown;
  /** Board's saved state; World's own service store by default. */
  store?: BoardDocumentStore;
  /** Send a note to an agent's pane; World's service by default. */
  sendNote?: (target: SendTarget, text: string) => Promise<SendOutcome>;
}) {
  const model = useMemo(() => projectBoard(world), [world]);
  const boardStore = useMemo(() => store ?? sharedBoardStore(), [store]);
  useEffect(() => {
    boardStore.start();
    return () => boardStore.stop();
  }, [boardStore]);
  const { document: saved } = useBoardDocument(boardStore);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteSelected, setNoteSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [stringFrom, setStringFrom] = useState<StringEnd | null>(null);
  const [far, setFar] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  /** The pane chooser: to pick a pane, or to finish a string to one. */
  const [chooser, setChooser] = useState<{
    tabKey: string;
    stringFrom?: StringEnd;
  } | null>(null);
  const [pulses, setPulses] = useState(readPulses);
  const [toast, setToast] = useState<{
    text: string;
    undo?: () => void;
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
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const dirty = useRef(true);
  const fitted = useRef(false);
  const farRef = useRef(false);
  const yarnEls = useRef(new Map<string, SVGPathElement[]>());
  const cutRef = useRef<HTMLButtonElement>(null);
  const tempYarn = useRef<SVGPathElement | null>(null);
  const loaded = useRef(false);
  const saveTimer = useRef(0);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
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
  // Placement uses each card's rendered size (new cards are already in the
  // DOM when placement runs); the overview's enlarged cards are never measured.
  const sizeOf = useCallback((key: string, kind: "workspace" | "tab"): Size => {
    const el = cardEls.current.get(key);
    if (el?.offsetWidth && !farRef.current)
      return { w: el.offsetWidth, h: el.offsetHeight };
    return cards.current.get(key)?.size ?? DEFAULT_SIZE[kind];
  }, []);

  /* ---------- Model changes: measure, place new cards, keep the rest ---------- */
  useLayoutEffect(() => {
    if (!farRef.current)
      for (const [key, el] of cardEls.current) {
        const card = cards.current.get(key);
        if (card && el.offsetWidth)
          card.size = { w: el.offsetWidth, h: el.offsetHeight };
      }
    layout.current = placeNew(model, layout.current, {
      phone: isPhone(),
      sizeOf,
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
    dirty.current = true;
  }, [model, sizeOf]);

  // Folding and the overview change what is visible without moving a card:
  // repaint so lines to hidden tabs go at once.
  useEffect(() => {
    dirty.current = true;
  }, [collapsed, far]);

  /* ---------- Saved state: notes as free cards, layout loaded once ---------- */
  useLayoutEffect(() => {
    const notes = saved?.notes ?? [];
    const held = drag.current?.type === "card" ? drag.current.key : null;
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
        if (held !== key) {
          card.x = note.x;
          card.y = note.y;
        }
      }
    }
    for (const key of [...cards.current.keys()])
      if (isNoteKey(key) && !present.has(key)) cards.current.delete(key);
    if (saved && !loaded.current) {
      // The first saved layout replaces the default one; new cards still get
      // free space.
      loaded.current = true;
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
    dirty.current = true;
    // The layout is read through refs; only saved state starts this.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  /** Save the layout shortly after it changes; never before it has loaded. */
  const scheduleSave = () => {
    if (!loaded.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const l = layout.current;
      void boardStore.patch([
        {
          op: "layout.set",
          replace: true,
          anchors: Object.fromEntries(l.anchors),
          offsets: Object.fromEntries(l.offsets),
          pinned: Object.fromEntries(l.pinned),
          folded: [...latest.current.collapsed],
        },
      ]);
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
    dirty.current = true;
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
      const node = cardEls.current.get(key);
      const w = farRef.current && node ? node.offsetWidth : card.size.w;
      const h = farRef.current && node ? node.offsetHeight : card.size.h;
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
    dirty.current = true;
  }

  /* ---------- Frame loop ---------- */
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.033, Math.max(0.001, (t - last) / 1000));
      last = t;
      const m = latest.current.model;
      const holding = drag.current?.type === "card" && drag.current.lifted;
      for (const [key, tw] of tweens.current) {
        const card = cards.current.get(key);
        tw.t += dt;
        const k = 1 - Math.pow(1 - Math.min(1, tw.t / TWEEN_SECONDS), 3);
        if (card) {
          card.x = tw.fx + (tw.tx - tw.fx) * k;
          card.y = tw.fy + (tw.ty - tw.fy) * k;
        }
        if (tw.t >= TWEEN_SECONDS) tweens.current.delete(key);
        dirty.current = true;
      }
      if (physics.current.heat > 0 || holding) {
        const list = visibleCards().map(([key, card]) => {
          card.home = homeOf(key, m);
          card.fixed =
            isNoteKey(key) ||
            layout.current.pinned.has(key) ||
            tweens.current.has(key) ||
            (holding && (drag.current as { key: string }).key === key);
          return card;
        });
        for (const key of [
          ...stepPhysics(list, physics.current, dt / 2),
          ...stepPhysics(list, physics.current, dt / 2),
        ])
          keepRef.current(key, m);
        if (cool(list, physics.current, dt, Boolean(holding)))
          for (const card of list)
            if (!card.fixed) keepRef.current(card.key, m);
        dirty.current = true;
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
        dirty.current = true;
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
        dirty.current = true;
      }
      const svg = svgRef.current;
      if (dirty.current && svg) {
        dirty.current = false;
        paint(svg, m);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

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
    for (const [key, el] of cardEls.current) {
      const card = cards.current.get(key);
      if (card)
        el.style.transform = `translate(${card.x}px, ${card.y}px) translate(-50%, -50%)`;
    }
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
        path.setAttribute(
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
          const el = cardEls.current.get(key);
          const w = farRef.current && el ? el.offsetWidth : card.size.w;
          const h = farRef.current && el ? el.offsetHeight : card.size.h;
          x0 = Math.min(x0, card.x - w / 2);
          y0 = Math.min(y0, card.y - h / 2);
          x1 = Math.max(x1, card.x + w / 2);
          y1 = Math.max(y1, card.y + h / 2);
        }
      }
      zone.hidden = x0 === Infinity;
      if (zone.hidden) continue;
      const pad = farRef.current ? 70 : 46;
      zone.style.transform = `translate(${x0 - pad}px, ${y0 - pad - 10}px)`;
      zone.style.width = `${x1 - x0 + pad * 2}px`;
      zone.style.height = `${y1 - y0 + pad * 2 + 10}px`;
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
    const target = targetOf(m, end.anchor);
    if (!target) return null;
    const firm = confirmed(end.anchor, target);
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
      pair[0]!.setAttribute("d", curve.d);
      pair[1]!.setAttribute("d", curve.d);
      if (latest.current.picked === string.id) cutAt = curve.mid;
    }
    for (const [id, pair] of yarnEls.current)
      if (!seen.has(id)) {
        for (const el of pair) el.remove();
        yarnEls.current.delete(id);
      }
    const d = drag.current;
    if (d?.type === "string") {
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
    dirty.current = true;
  }, [saved, picked]);

  /** The saved end for a card (or a pane in it), or null for an unknown card. */
  function endFor(end: StringEnd, m: BoardModel): BoardEnd | null {
    if (isNoteKey(end.cardKey))
      return { note: end.cardKey.slice(NOTE_PREFIX.length) };
    const anchor = anchorFor(m, end.cardKey, end.paneKey);
    return anchor ? { anchor } : null;
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
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[contenteditable='true']")) return;
    if (target.closest("button, input, a") && !target.closest(".board-card"))
      return;
    const hit = target.closest<SVGPathElement>(".board-yarn-hit");
    if (hit?.dataset.string) {
      setPicked(hit.dataset.string);
      return;
    }
    lastPointerType.current = event.pointerType;
    // The first finger of a new gesture: forget fingers whose lift was never
    // seen, which would otherwise turn later touches into a stuck pinch.
    if (event.isPrimary) {
      pointers.current.clear();
      drag.current = null;
    }
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    try {
      boardRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    camGoal.current = null;
    panVelocity.current = null;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      drag.current = {
        type: "pinch",
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        s0: cam.current.s,
        m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cam0: { ...cam.current },
      };
      return;
    }
    if (pointers.current.size > 2) return;
    const cardEl = target.closest<HTMLElement>(".board-card");
    const zoneLabel = target.closest<HTMLElement>(".board-zone-label");
    const at = toWorld(event.clientX, event.clientY);
    if (cardEl?.dataset.key && target.closest(".board-handle")) {
      drag.current = {
        type: "string",
        from: { cardKey: cardEl.dataset.key },
        sx: event.clientX,
        sy: event.clientY,
        at,
        over: null,
      };
      dirty.current = true;
      return;
    }
    if (cardEl?.dataset.key) {
      const card = cards.current.get(cardEl.dataset.key);
      if (!card) return;
      drag.current = {
        type: "card",
        key: card.key,
        offX: at.x - card.x,
        offY: at.y - card.y,
        sx: event.clientX,
        sy: event.clientY,
        lifted: false,
        hist: [],
        paneKey: target.closest<HTMLElement>("[data-pane]")?.dataset.pane,
      };
      return;
    }
    if (zoneLabel?.dataset.host) {
      drag.current = { type: "host", key: zoneLabel.dataset.host, last: at };
      return;
    }
    drag.current = {
      type: "pan",
      lx: event.clientX,
      ly: event.clientY,
      sx: event.clientX,
      sy: event.clientY,
      hist: [],
    };
    boardRef.current?.classList.add("board-panning");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const now = performance.now();
    if (d.type === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const rect = boardRef.current!.getBoundingClientRect();
      const s = clamp(
        (d.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / d.d0,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const wx = (d.m0.x - rect.left - d.cam0.x) / d.cam0.s,
        wy = (d.m0.y - rect.top - d.cam0.y) / d.cam0.s;
      const mx = (a.x + b.x) / 2 - rect.left,
        my = (a.y + b.y) / 2 - rect.top;
      cam.current = { s, x: mx - wx * s, y: my - wy * s };
      dirty.current = true;
      return;
    }
    if (d.type === "pan") {
      cam.current = {
        ...cam.current,
        x: cam.current.x + event.clientX - d.lx,
        y: cam.current.y + event.clientY - d.ly,
      };
      d.lx = event.clientX;
      d.ly = event.clientY;
      d.hist.push({ x: event.clientX, y: event.clientY, t: now });
      if (d.hist.length > 8) d.hist.shift();
      dirty.current = true;
      return;
    }
    const at = toWorld(event.clientX, event.clientY);
    if (d.type === "string") {
      d.at = at;
      const over = endAt(event.clientX, event.clientY);
      const next = over && over.cardKey !== d.from.cardKey ? over : null;
      if (next?.cardKey !== d.over?.cardKey) {
        if (d.over)
          cardEls.current
            .get(d.over.cardKey)
            ?.classList.remove("board-link-target");
        if (next)
          cardEls.current.get(next.cardKey)?.classList.add("board-link-target");
      }
      d.over = next;
      dirty.current = true;
      return;
    }
    if (d.type === "host") {
      const anchor = layout.current.anchors.get(d.key) ?? { x: 0, y: 0 };
      layout.current.anchors.set(d.key, {
        x: anchor.x + at.x - d.last.x,
        y: anchor.y + at.y - d.last.y,
      });
      d.last = at;
      warm(physics.current);
      return;
    }
    if (!d.lifted) {
      if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) < 6) return;
      d.lifted = true;
      cardEls.current.get(d.key)?.classList.add("board-lifted");
    }
    const card = cards.current.get(d.key);
    if (!card) return;
    card.x = at.x - d.offX;
    card.y = at.y - d.offY;
    card.vx = card.vy = 0;
    card.gliding = false;
    d.hist.push({ x: card.x, y: card.y, t: now });
    if (d.hist.length > 8) d.hist.shift();
    warm(physics.current);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    boardRef.current?.classList.remove("board-panning");
    const d = drag.current;
    if (!d) return;
    if (d.type === "pinch") {
      const rest = [...pointers.current.values()][0];
      drag.current = rest
        ? {
            type: "pan",
            lx: rest.x,
            ly: rest.y,
            sx: Number.NaN,
            sy: Number.NaN,
            hist: [],
          }
        : null;
      return;
    }
    drag.current = null;
    const m = latest.current.model;
    if (d.type === "string") {
      if (d.over)
        cardEls.current
          .get(d.over.cardKey)
          ?.classList.remove("board-link-target");
      dirty.current = true;
      if (d.over) finishString(d.from, d.over);
      else if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) > 40)
        // Dropped on empty board: a new note, strung to where it started.
        void createNote(d.at, d.from);
      return;
    }
    if (d.type === "pan") {
      if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) < 6) {
        // A tap on empty board clears picks. On touch, a second tap soon
        // after, close by, pins a new note; a mouse uses the browser's own
        // double-click, which follows the system setting.
        const now = performance.now();
        const tap = lastTap.current;
        if (
          event.pointerType !== "mouse" &&
          tap &&
          now - tap.t < DOUBLE_TAP_MS &&
          Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 32
        ) {
          lastTap.current = null;
          void createNote(toWorld(event.clientX, event.clientY));
        } else lastTap.current = { t: now, x: event.clientX, y: event.clientY };
        setPicked(null);
        setNoteSelected(null);
        setStringFrom(null);
      }
      if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) >= 6) {
        const v = velocity(d.hist);
        if (
          Math.hypot(v.x, v.y) > 150 &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          panVelocity.current = v;
      }
      return;
    }
    if (d.type === "host") {
      warm(physics.current);
      scheduleSave();
      return;
    }
    const card = cards.current.get(d.key);
    if (!d.lifted || !card) {
      setPicked(null);
      if (stringFrom) {
        finishString(stringFrom, { cardKey: d.key, paneKey: d.paneKey });
        setStringFrom(null);
        return;
      }
      if (isNoteKey(d.key)) {
        setNoteSelected(d.key.slice(NOTE_PREFIX.length));
        return;
      }
      setNoteSelected(null);
      // In the overview a workspace tap zooms in on it, so its tabs open
      // where the user is looking; up close a tap selects as usual.
      if (farRef.current && m.workspaceByKey.has(d.key)) {
        focusWorkspace(d.key);
        return;
      }
      selectCard(d.key, m, d.paneKey);
      return;
    }
    if (isNoteKey(d.key)) {
      cardEls.current.get(d.key)?.classList.remove("board-lifted");
      const note = latest.current.saved?.notes.find(
        (n) => NOTE_PREFIX + n.id === d.key,
      );
      if (note) void saveNote(note, { x: card.x, y: card.y });
      return;
    }
    cardEls.current.get(d.key)?.classList.remove("board-lifted");
    const v = velocity(d.hist);
    if (
      Math.hypot(v.x, v.y) < 80 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      keepWhereItIs(d.key, m);
    else {
      card.vx = clamp(v.x, -2200, 2200);
      card.vy = clamp(v.y, -2200, 2200);
      card.gliding = true;
    }
    warm(physics.current);
  };

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
      dirty.current = true;
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
    dirty.current = true;
  }
  /** Send every card to its place in the layout on a short tween. */
  const travelToLayout = (m: BoardModel) => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    for (const [key, to] of positions(m, layout.current)) {
      const card = cards.current.get(key);
      if (!card || Math.hypot(card.x - to.x, card.y - to.y) < 1) continue;
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
    dirty.current = true;
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
  const runTidy = () => {
    const before = cloneLayout(layout.current);
    const workspaceKey = selectedWorkspace();
    layout.current = tidy(model, layout.current, {
      workspaceKey,
      phone: isPhone(),
      sizeOf,
    });
    travelToLayout(model);
    if (!workspaceKey) window.setTimeout(() => fit(false), 400);
    const label = workspaceKey
      ? model.workspaceByKey.get(workspaceKey)?.label
      : null;
    setToast({
      text: label ? `Tidied “${label}”` : "Tidied the board",
      undo: () => {
        layout.current = before;
        travelToLayout(latest.current.model);
        setToast({ text: "Restored" });
      },
    });
  };
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(
      () => setToast(null),
      toast.undo ? 5000 : 2400,
    );
    return () => window.clearTimeout(timer);
  }, [toast]);
  /* ---------- Notes and strings ---------- */
  const report = async (pending: Promise<string | null>) => {
    const problem = await pending;
    if (problem) setToast({ text: problem });
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
    void report(
      boardStore.patch([
        {
          op: "string.put",
          string: { id: newId(), from: a, to: b },
        },
      ]),
    );
  }
  /** The agents a note can be sent to: confirmed strings to agent panes. */
  const sendTargets = (noteId: string): SendTarget[] => {
    const out: SendTarget[] = [];
    for (const string of saved?.strings ?? []) {
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
        const terminal = end.anchor.witness.find((t) =>
          target.terminals.includes(t),
        )!;
        const tab = model.tabByKey.get(target.cardKey)!;
        out.push({
          // Two agents of the same kind would read the same; name the tab.
          label: `${paneName(pane)} in ${tab.label}`,
          connectionId: pane.leaf.connectionId,
          generation: pane.leaf.generation,
          paneId: pane.leaf.nativeId,
          terminalId: terminal,
        });
      }
    }
    return out;
  };
  const send = async (note: BoardNote, target: SendTarget) => {
    try {
      const outcome = await sendNote(target, note.text);
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
  const cutString = (id: string) => {
    setPicked(null);
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
    if (el) cardEls.current.set(key, el);
    else cardEls.current.delete(key);
  };

  return (
    <>
      {toolbarPortal ? createPortal(toolbar, toolbarPortal) : toolbar}
      <div
        ref={boardRef}
        className={`board${far ? " board-far" : ""}${pulses ? "" : " board-no-pulse"}`}
        aria-label="Board of hosts, workspaces and tabs"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={(event) => {
          // A finger whose lift went elsewhere is no longer on the board.
          if (pointers.current.has(event.pointerId)) onPointerUp(event);
        }}
        onDoubleClick={(event) => {
          // Phones fire dblclick after a double-tap too; touch has its own.
          if (lastPointerType.current !== "mouse") return;
          const target = event.target as HTMLElement;
          if (
            target.closest(
              ".board-card, .board-controls, .board-zone-label, .board-notebar, .board-chooser, .board-cut, .board-toast",
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
                title="Drag to move the whole host"
              >
                {host.label}
                {host.stale ? <small>offline</small> : null}
              </div>
            </div>
          ))}
          <svg ref={svgRef} className="board-wires" aria-hidden="true" />
          {model.workspaces.map((space) => {
            const folded = collapsed.has(space.key);
            const attention = space.statuses[0] === "blocked";
            return (
              <div
                key={space.key}
                ref={ref(space.key)}
                data-key={space.key}
                role="button"
                tabIndex={0}
                aria-label={`Workspace ${space.label}, ${space.tabKeys.length} tabs`}
                className={[
                  "board-card board-workspace",
                  folded ? "board-folded" : "",
                  attention ? "board-attn" : "",
                  space.stale ? "board-stale" : "",
                  selectedKeys.has(space.key) ? "board-selected" : "",
                  matches && !matches.has(space.key) ? "board-dim" : "",
                ].join(" ")}
                onKeyDown={(event) => {
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
                    onClick={() => toggleFold(space)}
                  >
                    {folded ? space.tabKeys.length : "−"}
                  </button>
                </div>
                <span
                  className="board-handle"
                  title="Drag to string this to a note or card"
                />
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
          {model.tabs.map((tab) => {
            if (collapsed.has(tab.workspaceKey)) return null;
            const pane = primaryPane(tab);
            const multi = tab.panes.length > 1;
            const rows = rowsOf(tab);
            const hidden = tab.panes.length - rows.length;
            return (
              <div
                key={tab.key}
                ref={ref(tab.key)}
                data-key={tab.key}
                role="button"
                tabIndex={0}
                aria-label={`${tab.label}, ${tabSummary(tab)}`}
                className={[
                  "board-card board-tab",
                  `board-s-${tab.status}`,
                  tab.shellOnly ? "board-terminal" : "",
                  multi ? "board-multi" : "",
                  tab.stale ? "board-stale" : "",
                  selectedKeys.has(tab.key) ? "board-selected" : "",
                  matches && !matches.has(tab.key) ? "board-dim" : "",
                ].join(" ")}
                onDoubleClick={(event) =>
                  openTab(
                    tab,
                    (event.target as HTMLElement).closest<HTMLElement>(
                      "[data-pane]",
                    )?.dataset.pane,
                  )
                }
                onKeyDown={(event) => {
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
                        <span className="board-pane-name">{paneName(row)}</span>
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
              onDoubleClick={() => setEditing(note.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && editing !== note.id) {
                  event.preventDefault();
                  setNoteSelected(note.id);
                  setEditing(note.id);
                }
              }}
            >
              <span className="board-tape" aria-hidden="true" />
              {editing === note.id ? (
                <div
                  className="board-note-text"
                  contentEditable
                  suppressContentEditableWarning
                  role="textbox"
                  aria-label="Note text"
                  ref={(el) => {
                    if (el && document.activeElement !== el) {
                      el.focus();
                      const range = document.createRange();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      getSelection()?.removeAllRanges();
                      getSelection()?.addRange(range);
                    }
                  }}
                  onBlur={(event) => {
                    setEditing(null);
                    const text = event.currentTarget.textContent?.trim() ?? "";
                    if (text !== note.text) void saveNote(note, { text });
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Escape" ||
                      (event.key === "Enter" &&
                        (event.metaKey || event.ctrlKey))
                    ) {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                >
                  {note.text}
                </div>
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
          hidden
          onClick={() => {
            if (picked) cutString(picked);
          }}
        >
          Cut string
        </button>
        {noteSelected && saved?.notes.find((n) => n.id === noteSelected) ? (
          <NoteBar
            note={saved.notes.find((n) => n.id === noteSelected)!}
            targets={sendTargets(noteSelected)}
            onSend={(target) =>
              void send(saved.notes.find((n) => n.id === noteSelected)!, target)
            }
            onColor={(color) => {
              const note = saved.notes.find((n) => n.id === noteSelected)!;
              void saveNote(note, { color });
            }}
            onEdit={() => setEditing(noteSelected)}
            onString={() => {
              setStringFrom({ cardKey: NOTE_PREFIX + noteSelected });
              setToast({ text: "Tap the card or pane to string the note to" });
            }}
            onDelete={() =>
              deleteNote(saved.notes.find((n) => n.id === noteSelected)!)
            }
          />
        ) : null}
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
              </div>
            ) : null}
          </div>
        </div>
        {toast ? (
          <div className="board-toast" role="status">
            <span>{toast.text}</span>
            {toast.undo ? (
              <button type="button" onClick={() => toast.undo?.()}>
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
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
}: {
  note: BoardNote;
  targets: SendTarget[];
  onSend(target: SendTarget): void;
  onColor(color: BoardNote["color"]): void;
  onEdit(): void;
  onString(): void;
  onDelete(): void;
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
      <button type="button" className="board-danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
