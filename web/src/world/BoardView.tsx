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
import {
  projectBoard,
  type BoardModel,
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
    }
  | { type: "host"; key: string; last: Point }
  | { type: "pinch"; d0: number; s0: number; m0: Point; cam0: Camera };
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

/** The pane a tab card selects or opens: the most urgent one. */
function primaryPane(tab: BoardTab) {
  return tab.panes.find((pane) => pane.status === tab.status) ?? tab.panes[0];
}

export default function BoardView({
  world,
  toolbarPortal = null,
  selectedId,
  onSelect,
  onOpenTerminal,
}: {
  world: WorldObject;
  toolbarPortal?: Element | null;
  selectedId: string | null;
  onSelect(id: string): unknown;
  onOpenTerminal(id: string): unknown;
}) {
  const model = useMemo(() => projectBoard(world), [world]);
  const [far, setFar] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
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
  const latest = useRef({ model, collapsed, onSelect, onOpenTerminal });
  latest.current = { model, collapsed, onSelect, onOpenTerminal };

  const kindOf = (key: string, m: BoardModel) =>
    m.workspaceByKey.has(key) ? "workspace" : "tab";
  const sizeOf = useCallback((key: string, kind: "workspace" | "tab"): Size => {
    const card = cards.current.get(key);
    return card?.size ?? DEFAULT_SIZE[kind];
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
    for (const key of [...cards.current.keys()])
      if (!at.has(key)) cards.current.delete(key);
    if (!fitted.current && at.size) {
      fitted.current = true;
      fit(true);
    }
    dirty.current = true;
  }, [model, sizeOf]);

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
  };

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
    const svg = svgRef.current!;
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
            layout.current.pinned.has(key) ||
            tweens.current.has(key) ||
            (holding && (drag.current as { key: string }).key === key);
          return card;
        });
        for (const key of [
          ...stepPhysics(list, physics.current, dt / 2),
          ...stepPhysics(list, physics.current, dt / 2),
        ])
          keepWhereItIs(key, m);
        if (cool(list, physics.current, dt, Boolean(holding)))
          for (const card of list) if (!card.fixed) keepWhereItIs(card.key, m);
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
      if (dirty.current) {
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

  /* ---------- Pointer input ---------- */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest("button, input, a, [contenteditable='true']") &&
      !target.closest(".board-card")
    )
      return;
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
    if (d.type === "pan") {
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
      return;
    }
    const card = cards.current.get(d.key);
    if (!d.lifted || !card) {
      selectCard(d.key, m);
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
  function selectCard(key: string, m: BoardModel) {
    const space = m.workspaceByKey.get(key);
    if (space) return void latest.current.onSelect(space.space.id);
    const tab = m.tabByKey.get(key);
    const pane = tab && primaryPane(tab);
    if (pane) void latest.current.onSelect(pane.leaf.id);
  }
  const openTab = (tab: BoardTab) => {
    const pane = primaryPane(tab);
    if (pane && tab.actionable) void onOpenTerminal(pane.leaf.id);
  };
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

  if (!model.hosts.length)
    return (
      <div className="world-empty" role="status">
        <img src="/herdr-world-logo.svg" alt="" width="68" height="68" />
        <h2>No connected spaces yet</h2>
        <p>Add or connect a local or SSH Herdr profile from Spaces.</p>
      </div>
    );

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
      >
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
                <div className="board-sum" aria-hidden="true">
                  {space.statuses.map((status, i) => (
                    <span key={i} className={`board-s-${status}`} />
                  ))}
                </div>
              </div>
            );
          })}
          {model.tabs.map((tab) => {
            if (collapsed.has(tab.workspaceKey)) return null;
            const pane = primaryPane(tab);
            const agent = pane?.isAgent
              ? (pane.leaf.agentLabel ?? pane.leaf.agentName ?? "agent")
              : "shell";
            return (
              <div
                key={tab.key}
                ref={ref(tab.key)}
                data-key={tab.key}
                role="button"
                tabIndex={0}
                aria-label={`${tab.label}, ${agent}, ${STATUS_LABEL[tab.status]}`}
                className={[
                  "board-card board-tab",
                  `board-s-${tab.status}`,
                  tab.stale ? "board-stale" : "",
                  selectedKeys.has(tab.key) ? "board-selected" : "",
                  matches && !matches.has(tab.key) ? "board-dim" : "",
                ].join(" ")}
                onDoubleClick={() => openTab(tab)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    selectCard(tab.key, model);
                  }
                }}
              >
                <div className="board-row">
                  <span className="board-dot" />
                  <span className="board-label">{tab.label}</span>
                  <span className="board-who">{agent}</span>
                </div>
                <div className="board-line">
                  {pane?.leaf.taskSummary ??
                    pane?.leaf.terminalTitle ??
                    STATUS_LABEL[tab.status]}
                </div>
                {tab.panes.length > 1 ? (
                  <span className="board-count">{tab.panes.length} panes</span>
                ) : null}
                <span className="board-badge" aria-hidden="true" />
              </div>
            );
          })}
        </div>
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
