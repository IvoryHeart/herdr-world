import {
  Circle,
  Diamond,
  MousePointer2,
  MoveUpRight,
  PaintBucket,
  Pencil,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  BoardShape,
  BoardShapeColor,
  BoardShapeEnd,
  BoardShapeKind,
} from "../../../../shared/boardShapes";
import { BOARD_SHAPE_COLORS } from "../../../../shared/boardShapes";
import type { BoardDocumentStore, BoardOp } from "./boardDocument";
import {
  arrowBox,
  arrowEnds,
  arrowPath,
  boundsOf,
  boxBetween,
  type Box,
  changesFor,
  dragCorner,
  moved,
  type Point,
  type Resolve,
  resized,
  revertOps,
  type ShapeChange,
  type ShapeDraft,
  type ShapeOp,
  shapeAt,
  strip,
  strokeFrom,
  strokePath,
  TEXT_SIZE,
  textBox,
} from "./boardSketchGeometry";
import "./boardSketch.css";

/**
 * Board drawings (#1015): shapes, arrows, text and pen strokes drawn on
 * Board's own camera, beneath its cards and strings. Drawing is desktop
 * first; a phone shows drawings and keeps Board's double-tap notes.
 */

export type SketchTool =
  | "select"
  | "pen"
  | "rect"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "text"
  | "note";
export type SketchHost = {
  toWorld(sx: number, sy: number): Point;
  scale(): number;
  /** A note's or card's box in Board units, while it is on the board. */
  targetBox(attach: { note: string } | { card: string }): Box | null;
  /** The note or card under a screen point. */
  cardAt(sx: number, sy: number): { note: string } | { card: string } | null;
  note(at: Point): void;
  notify(text: string): void;
  /** A drawing was selected: Board lets go of its own selection. */
  selected(): void;
};

const COLORS: Record<BoardShapeColor, string> = {
  ink: "var(--board-ink)",
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#d49a00",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#3e63dd",
  purple: "#8e4ec6",
};
const TOOLS: readonly [SketchTool, string, typeof Pencil][] = [
  ["select", "Select", MousePointer2],
  ["pen", "Pen", Pencil],
  ["rect", "Rectangle", Square],
  ["ellipse", "Ellipse", Circle],
  ["diamond", "Diamond", Diamond],
  ["arrow", "Arrow", MoveUpRight],
  ["text", "Text", Type],
  ["note", "Note", StickyNote],
];
const BOXES: readonly BoardShapeKind[] = ["rect", "ellipse", "diamond"];
/** A click with a box tool draws one this size. */
const CLICK_BOX = { w: 160, h: 100 };
const LABEL_SIZE = 18;

const phoneQuery = () => window.matchMedia("(max-width: 720px)");
const subscribePhone = (listener: () => void) => {
  const query = phoneQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const usePhone = () =>
  useSyncExternalStore(subscribePhone, () => phoneQuery().matches);

const newShapeId = () =>
  `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const outlineOf = (kind: BoardShapeKind) =>
  kind === "ellipse" ? "ellipse" : kind === "diamond" ? "diamond" : "rect";

/** What the pointer is doing, from press to release. */
type Drag =
  | { kind: "move"; base: ShapeDraft; from: Point; moved: boolean }
  | {
      kind: "corner";
      base: ShapeDraft;
      corner: "nw" | "ne" | "sw" | "se";
    }
  | { kind: "end"; base: ShapeDraft; end: "from" | "to" }
  | { kind: "box"; shape: BoardShapeKind; from: Point }
  | { kind: "arrow"; from: BoardShapeEnd }
  | { kind: "pen"; points: Point[] };

export function useBoardSketch({
  store,
  shapes: saved,
  host,
}: {
  store: BoardDocumentStore;
  shapes: readonly BoardShape[];
  host: SketchHost;
}): {
  layer: ReactNode;
  tools: ReactNode;
  repaint(): void;
} {
  const phone = usePhone();
  const [tool, setTool] = useState<SketchTool>("select");
  const [color, setColor] = useState<BoardShapeColor>("ink");
  const [fill, setFill] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [live, setLiveState] = useState<ShapeDraft | null>(null);
  /** The live drag, read on release before React renders its last move. */
  const liveRef = useRef<ShapeDraft | null>(null);
  const setLive = (shape: ShapeDraft | null) => {
    liveRef.current = shape;
    setLiveState(shape);
  };
  const [editing, setEditing] = useState<{
    shape: ShapeDraft;
    created: boolean;
  } | null>(null);
  /** Changes on their way to the service, shown at once. */
  const [overrides, setOverrides] = useState(
    () => new Map<string, ShapeDraft | null>(),
  );
  const drag = useRef<Drag | null>(null);
  /** The latest commit to each drawing, and the revision it leaves. */
  const pending = useRef(new Map<string, { token: number; rev: number }>());
  const tokens = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);

  // The drawings: saved, with changes in flight over them; a live drag is
  // shown in place of (or above) them.
  const base: ShapeDraft[] = [];
  const seen = new Set(saved.map((shape) => shape.id));
  for (const shape of saved) {
    const next = overrides.has(shape.id)
      ? overrides.get(shape.id)
      : strip(shape);
    if (next) base.push(next);
  }
  for (const [id, shape] of overrides)
    if (shape && !seen.has(id)) base.push(shape);
  const shown = base.map((shape) => (shape.id === live?.id ? live : shape));
  if (live && !base.some((shape) => shape.id === live.id)) shown.push(live);
  const byId = new Map(shown.map((shape) => [shape.id, shape]));

  const resolve: Resolve = (attach) => {
    if ("shape" in attach) {
      const shape = latest.current.byId.get(attach.shape);
      return shape && shape.kind !== "arrow" && shape.kind !== "pen"
        ? { box: shape, outline: outlineOf(shape.kind) }
        : null;
    }
    const box = host.targetBox(attach);
    return box ? { box, outline: "rect" } : null;
  };
  const latest = useRef({ byId, base, saved, host, selected });
  latest.current = { byId, base, saved, host, selected };

  /** Drawings as they will be once changes in flight land, with revisions. */
  const current = (): BoardShape[] => {
    const revs = new Map(latest.current.saved.map((s) => [s.id, s.rev]));
    return latest.current.base.map((shape) => ({
      ...shape,
      rev: pending.current.get(shape.id)?.rev ?? revs.get(shape.id) ?? 0,
    }));
  };

  /**
   * Save operations, shown at once; returns the changes they make and
   * whether the service took them. Later actions (a quick second edit, or
   * Ctrl+Z) already see them.
   */
  const commit = (ops: ShapeOp[]) => {
    const changes = changesFor(ops, current());
    const token = ++tokens.current;
    const next = [...latest.current.base];
    for (const change of changes) {
      pending.current.set(change.id, { token, rev: change.rev });
      const at = next.findIndex((shape) => shape.id === change.id);
      if (change.after && at < 0) next.push(change.after);
      else if (change.after) next[at] = change.after;
      else if (at >= 0) next.splice(at, 1);
    }
    latest.current.base = next;
    setOverrides((was) => {
      const map = new Map(was);
      for (const change of changes) map.set(change.id, change.after);
      return map;
    });
    const saved = store.patch(ops as BoardOp[]).then((problem) => {
      const mine = changes.filter(
        (change) => pending.current.get(change.id)?.token === token,
      );
      for (const change of mine) pending.current.delete(change.id);
      setOverrides((was) => {
        const map = new Map(was);
        for (const change of mine) map.delete(change.id);
        return map;
      });
      if (problem) latest.current.host.notify(problem);
      return !problem;
    });
    return { changes, saved };
  };
  /** Undo and redo: changes the user made here, newest last. */
  const history = useRef({
    undo: [] as ShapeChange[][],
    redo: [] as ShapeChange[][],
  });
  const [, setHistoryShown] = useState(0);
  const record = (
    stack: "undo" | "redo",
    entry: ShapeChange[],
    saved: Promise<boolean>,
  ) => {
    history.current[stack] = [...history.current[stack].slice(-99), entry];
    setHistoryShown((n) => n + 1);
    // A change the service refused cannot be undone.
    void saved.then((ok) => {
      if (ok) return;
      history.current[stack] = history.current[stack].filter(
        (other) => other !== entry,
      );
      setHistoryShown((n) => n + 1);
    });
  };
  /** Save a user's change and remember it for undo. */
  const change = (ops: ShapeOp[]) => {
    if (!ops.length) return;
    const { changes, saved } = commit(ops);
    history.current.redo = [];
    record("undo", changes, saved);
  };
  const revert = (from: "undo" | "redo") => {
    const entry = history.current[from][history.current[from].length - 1];
    if (!entry) return;
    history.current[from] = history.current[from].slice(0, -1);
    setHistoryShown((n) => n + 1);
    const ops = revertOps(entry, current());
    if (!ops) {
      latest.current.host.notify(
        `That drawing changed since, so it was not ${from === "undo" ? "undone" : "redone"}`,
      );
      return;
    }
    setSelected(null);
    const { changes, saved } = commit(ops);
    record(from === "undo" ? "redo" : "undo", changes, saved);
  };
  const put = (shape: ShapeDraft): ShapeOp => {
    const rev = current().find((s) => s.id === shape.id)?.rev;
    return rev ? { op: "shape.put", shape, rev } : { op: "shape.put", shape };
  };
  const remove = (id: string) => {
    const all = current();
    const shape = all.find((s) => s.id === id);
    if (!shape) return;
    const ops: ShapeOp[] = [{ op: "shape.delete", id, rev: shape.rev }];
    // Arrows attached to it stay where they point now.
    for (const arrow of all) {
      if (arrow.kind !== "arrow" || !arrow.from || !arrow.to) continue;
      const on = (end: BoardShapeEnd) =>
        Boolean(end.attach && "shape" in end.attach && end.attach.shape === id);
      if (!on(arrow.from) && !on(arrow.to)) continue;
      const { a, b } = arrowEnds(arrow.from, arrow.to, resolve);
      const from = on(arrow.from) ? point(a) : arrow.from;
      const to = on(arrow.to) ? point(b) : arrow.to;
      ops.push(put({ ...strip(arrow), ...arrowBox(from, to), from, to }));
    }
    setSelected(null);
    change(ops);
  };
  const point = (at: Point): BoardShapeEnd => ({
    x: Math.round(at.x * 10) / 10,
    y: Math.round(at.y * 10) / 10,
  });

  /** An arrow end at a screen point: on a card, a note or a drawing. */
  const endAt = (sx: number, sy: number, except?: string): BoardShapeEnd => {
    const at = point(host.toWorld(sx, sy));
    const card = host.cardAt(sx, sy);
    if (card) return { ...at, attach: card };
    const shape = shapeAt([...latest.current.byId.values()], at, except);
    return shape ? { ...at, attach: { shape: shape.id } } : at;
  };
  const arrowFrom = (
    base: ShapeDraft,
    from: BoardShapeEnd,
    to: BoardShapeEnd,
  ): ShapeDraft => {
    // Saved ends are where the arrow meets its targets now.
    const { a, b } = arrowEnds(from, to, resolve);
    const ends = {
      from: { ...from, ...point(a) },
      to: { ...to, ...point(b) },
    };
    return { ...base, ...arrowBox(ends.from, ends.to), ...ends };
  };

  /* ---------- Pointer ---------- */
  const begin = (event: ReactPointerEvent<Element>, next: Drag) => {
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    drag.current = next;
  };
  const onMove = (event: ReactPointerEvent<Element>) => {
    const d = drag.current;
    if (!d) return;
    event.stopPropagation();
    const at = host.toWorld(event.clientX, event.clientY);
    if (d.kind === "move") {
      const dx = at.x - d.from.x,
        dy = at.y - d.from.y;
      if (!d.moved && Math.hypot(dx, dy) * host.scale() < 3) return;
      d.moved = true;
      setLive(moved(d.base, dx, dy));
    } else if (d.kind === "corner") {
      setLive(resized(d.base, dragCorner(d.base, d.corner, at)));
    } else if (d.kind === "end") {
      const end = endAt(event.clientX, event.clientY, d.base.id);
      setLive(
        arrowFrom(
          d.base,
          d.end === "from" ? end : d.base.from!,
          d.end === "to" ? end : d.base.to!,
        ),
      );
    } else if (d.kind === "box") {
      setLive({
        id: "draft",
        kind: d.shape,
        color,
        ...boxBetween(d.from, at),
        ...(fill && BOXES.includes(d.shape) ? { fill } : {}),
      });
    } else if (d.kind === "arrow") {
      setLive(
        arrowFrom(
          { id: "draft", kind: "arrow", color, x: 0, y: 0, w: 0, h: 0 },
          d.from,
          endAt(event.clientX, event.clientY),
        ),
      );
    } else if (d.kind === "pen") {
      d.points.push(at);
      const stroke = strokeFrom(d.points, 0);
      if (stroke) setLive({ id: "draft", kind: "pen", color, ...stroke });
    }
  };
  const onUp = (event: ReactPointerEvent<Element>) => {
    const d = drag.current;
    if (!d) return;
    event.stopPropagation();
    drag.current = null;
    const at = host.toWorld(event.clientX, event.clientY);
    const shape = liveRef.current;
    setLive(null);
    const id = newShapeId();
    if (d.kind === "move" || d.kind === "corner" || d.kind === "end") {
      if (shape && (d.kind !== "move" || d.moved)) change([put(shape)]);
    } else if (d.kind === "box") {
      const box =
        shape && shape.w * host.scale() > 6 && shape.h * host.scale() > 6
          ? shape
          : {
              x: at.x - CLICK_BOX.w / 2,
              y: at.y - CLICK_BOX.h / 2,
              ...CLICK_BOX,
            };
      change([
        put({
          id,
          kind: d.shape,
          color,
          ...boxBetween(box, { x: box.x + box.w, y: box.y + box.h }),
          ...(fill ? { fill } : {}),
        }),
      ]);
      setSelected(id);
      setTool("select");
    } else if (d.kind === "arrow") {
      if (
        shape?.from &&
        shape.to &&
        Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) *
          host.scale() >
          8
      ) {
        change([put({ ...shape, id })]);
        setSelected(id);
        setTool("select");
      }
    } else if (d.kind === "pen") {
      const stroke = strokeFrom(d.points, 0.6 / host.scale());
      if (stroke) change([put({ id, kind: "pen", color, ...stroke })]);
    }
  };
  const onPadDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const at = host.toWorld(event.clientX, event.clientY);
    setSelected(null);
    if (tool === "note") {
      event.stopPropagation();
      host.note(at);
      setTool("select");
    } else if (tool === "text") {
      event.stopPropagation();
      event.preventDefault();
      setEditing({
        created: true,
        shape: {
          id: newShapeId(),
          kind: "text",
          color,
          x: point(at).x,
          y: point(at).y - TEXT_SIZE * 0.65,
          ...textBox(""),
        },
      });
      setTool("select");
    } else if (tool === "pen") begin(event, { kind: "pen", points: [at] });
    else if (tool === "arrow")
      begin(event, {
        kind: "arrow",
        from: endAt(event.clientX, event.clientY),
      });
    else if (tool !== "select")
      begin(event, { kind: "box", shape: tool, from: at });
  };
  const onShapeDown = (
    event: ReactPointerEvent<Element>,
    shape: ShapeDraft,
  ) => {
    if (event.button !== 0 || tool !== "select") return;
    host.selected();
    setSelected(shape.id);
    begin(event, {
      kind: "move",
      base: shape,
      from: host.toWorld(event.clientX, event.clientY),
      moved: false,
    });
  };

  /* ---------- Text ---------- */
  const finishEdit = (text: string) => {
    if (!editing) return;
    const { shape, created } = editing;
    setEditing(null);
    const value = text.replace(/\s+$/, "");
    if (shape.kind === "text") {
      if (!value) {
        if (!created) remove(shape.id);
        return;
      }
      change([put({ ...shape, text: value, ...textBox(value) })]);
      setSelected(shape.id);
      return;
    }
    if (value === (shape.text ?? "")) return;
    const rest: ShapeDraft = { ...shape };
    delete rest.text;
    change([put(value ? { ...rest, text: value } : rest)]);
  };
  const editShape = (shape: ShapeDraft) => {
    if (shape.kind === "pen" || shape.kind === "arrow") return;
    setSelected(shape.id);
    setEditing({ shape, created: false });
  };

  /* ---------- Keys and outside presses ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.("input, textarea, [contenteditable='true']") ||
        (target !== document.body && !target?.closest?.(".board"))
      )
        return;
      const { selected: id } = latest.current;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        revert(event.shiftKey ? "redo" : "undo");
      } else if (mod && event.key === "y") {
        event.preventDefault();
        revert("redo");
      } else if ((event.key === "Delete" || event.key === "Backspace") && id) {
        event.preventDefault();
        remove(id);
      } else if (event.key === "Escape") {
        setTool("select");
        setSelected(null);
      }
    };
    const onPress = (event: PointerEvent) => {
      if (
        !(event.target as Element | null)?.closest?.(
          ".board-sketch-live, .board-sketch-tools",
        )
      )
        setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPress, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPress, true);
    };
  });

  /** Attached arrows follow their targets as Board's cards move. */
  const repaint = () => {
    for (const shape of latest.current.byId.values()) {
      if (shape.kind !== "arrow" || !shape.from || !shape.to) continue;
      if (!shape.from.attach && !shape.to.attach) continue;
      const els = svgRef.current?.querySelectorAll<SVGPathElement>(
        `g[data-shape="${CSS.escape(shape.id)}"] > path`,
      );
      if (!els?.length) continue;
      const { a, b } = arrowEnds(shape.from, shape.to, resolve);
      const d = arrowPath(a, b);
      for (const el of els)
        if (el.getAttribute("d") !== d) el.setAttribute("d", d);
    }
  };

  /* ---------- Rendering ---------- */
  const interactive = !phone && tool === "select";
  const scale = host.scale();
  const renderShape = (shape: ShapeDraft) => {
    const style = { color: COLORS[shape.color] } as CSSProperties;
    const hit = interactive
      ? {
          className: "board-sketch-hit board-sketch-live",
          onPointerDown: (event: ReactPointerEvent<Element>) =>
            onShapeDown(event, shape),
          onPointerMove: onMove,
          onPointerUp: onUp,
          onPointerCancel: onUp,
          onDoubleClick: (event: ReactMouseEvent) => {
            event.stopPropagation();
            editShape(shape);
          },
        }
      : null;
    const solid = Boolean(shape.fill || shape.text);
    const label =
      shape.text && shape.kind !== "text" && editing?.shape.id !== shape.id
        ? lines(
            shape.text,
            shape.x + shape.w / 2,
            shape.y + shape.h / 2,
            LABEL_SIZE,
            "middle",
          )
        : null;
    const geometry = (props: Record<string, unknown>) => {
      if (shape.kind === "rect")
        return (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            rx={6}
            {...props}
          />
        );
      if (shape.kind === "ellipse")
        return (
          <ellipse
            cx={shape.x + shape.w / 2}
            cy={shape.y + shape.h / 2}
            rx={shape.w / 2}
            ry={shape.h / 2}
            {...props}
          />
        );
      if (shape.kind === "diamond") {
        const cx = shape.x + shape.w / 2,
          cy = shape.y + shape.h / 2;
        return (
          <polygon
            points={`${cx},${shape.y} ${shape.x + shape.w},${cy} ${cx},${shape.y + shape.h} ${shape.x},${cy}`}
            {...props}
          />
        );
      }
      if (shape.kind === "text")
        return (
          <rect
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            {...props}
          />
        );
      if (shape.kind === "pen")
        return <path d={strokePath(shape)} {...props} />;
      const { a, b } = arrowEnds(shape.from!, shape.to!, resolve);
      return <path d={arrowPath(a, b)} {...props} />;
    };
    const line = shape.kind === "pen" || shape.kind === "arrow";
    return (
      <g
        key={shape.id}
        className={`board-sketch-shape board-sketch-${shape.kind}`}
        data-shape={shape.id}
        data-kind={shape.kind}
        data-color={shape.color}
        style={style}
      >
        {shape.kind === "text"
          ? editing?.shape.id === shape.id
            ? null
            : lines(
                shape.text ?? "",
                shape.x + 4,
                shape.y + 4,
                TEXT_SIZE,
                "start",
              )
          : geometry({
              className: shape.fill
                ? "board-sketch-ink board-sketch-fill"
                : "board-sketch-ink",
            })}
        {label}
        {hit
          ? geometry({
              ...hit,
              "data-hit": shape.id,
              // Lines and empty boxes are picked by their outline; filled or
              // labelled boxes and text anywhere inside.
              style: {
                pointerEvents:
                  shape.kind === "text" || (solid && !line) ? "all" : "stroke",
              },
            })
          : null}
      </g>
    );
  };
  const selection = (() => {
    const shape = selected ? byId.get(selected) : null;
    if (!shape || phone || tool !== "select") return null;
    const pad = 6 / scale,
      r = 5 / scale;
    const box = boundsOf(shape, resolve);
    const handle = (
      key: string,
      at: Point,
      start: (event: ReactPointerEvent<Element>) => void,
      round = false,
    ) => (
      <rect
        key={key}
        className={`board-sketch-handle board-sketch-live${round ? " board-sketch-end" : ""}`}
        data-handle={key}
        x={at.x - r}
        y={at.y - r}
        width={r * 2}
        height={r * 2}
        rx={round ? r : r / 3}
        style={{ strokeWidth: 1.5 / scale }}
        onPointerDown={start}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
    );
    const handles: ReactNode[] = [];
    if (shape.kind === "arrow") {
      const { a, b } = arrowEnds(shape.from!, shape.to!, resolve);
      for (const [end, at] of [
        ["from", a],
        ["to", b],
      ] as const)
        handles.push(
          handle(
            end,
            at,
            (event) => begin(event, { kind: "end", base: shape, end }),
            true,
          ),
        );
    } else if (shape.kind !== "text")
      for (const corner of ["nw", "ne", "sw", "se"] as const)
        handles.push(
          handle(
            corner,
            {
              x: corner.includes("w") ? shape.x : shape.x + shape.w,
              y: corner.includes("n") ? shape.y : shape.y + shape.h,
            },
            (event) => begin(event, { kind: "corner", base: shape, corner }),
          ),
        );
    return (
      <g className="board-sketch-selection" data-selected={shape.id}>
        <rect
          className="board-sketch-frame"
          x={box.x - pad}
          y={box.y - pad}
          width={box.w + pad * 2}
          height={box.h + pad * 2}
          style={{
            strokeWidth: 1.5 / scale,
            strokeDasharray: `${4 / scale} ${4 / scale}`,
          }}
        />
        {handles}
      </g>
    );
  })();
  const editor = editing ? (
    <TextEditor
      key={editing.shape.id}
      shape={editing.shape}
      onDone={finishEdit}
    />
  ) : null;

  const layer = (
    <>
      <svg
        ref={svgRef}
        className={`board-sketch${phone ? " board-sketch-view" : ""}`}
        aria-hidden="true"
      >
        {shown.map(renderShape)}
        {selection}
      </svg>
      {editor}
    </>
  );

  const selectedShape = selected ? byId.get(selected) : undefined;
  const tools = phone ? null : (
    <>
      {tool !== "select" ? (
        <div
          className={`board-sketch-pad board-sketch-live board-sketch-pad-${tool}`}
          data-tool={tool}
          onPointerDown={onPadDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      ) : null}
      <div
        className="board-sketch-tools"
        role="toolbar"
        aria-label="Drawing tools"
        aria-orientation="vertical"
      >
        {TOOLS.map(([name, label, Icon]) => (
          <button
            key={name}
            type="button"
            className="board-sketch-tool"
            aria-label={label}
            title={label}
            aria-pressed={tool === name}
            onClick={() => {
              setTool(name);
              if (name !== "select") setSelected(null);
            }}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        ))}
        <span className="board-sketch-rule" aria-hidden="true" />
        <div className="board-sketch-colors" role="group" aria-label="Colour">
          {BOARD_SHAPE_COLORS.map((name) => (
            <button
              key={name}
              type="button"
              className="board-sketch-color"
              aria-label={`Colour ${name}`}
              title={name}
              aria-pressed={(selectedShape?.color ?? color) === name}
              style={{ color: COLORS[name] } as CSSProperties}
              onClick={() => {
                setColor(name);
                if (selectedShape && selectedShape.color !== name)
                  change([put({ ...selectedShape, color: name })]);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          className="board-sketch-tool"
          aria-label="Fill"
          title="Fill"
          aria-pressed={
            selectedShape && BOXES.includes(selectedShape.kind)
              ? Boolean(selectedShape.fill)
              : fill
          }
          onClick={() => {
            if (selectedShape && BOXES.includes(selectedShape.kind)) {
              const { fill: was, ...rest } = selectedShape;
              setFill(!was);
              change([put(was ? rest : { ...rest, fill: true })]);
            } else setFill(!fill);
          }}
        >
          <PaintBucket size={16} aria-hidden="true" />
        </button>
        <span className="board-sketch-rule" aria-hidden="true" />
        <button
          type="button"
          className="board-sketch-tool"
          aria-label="Undo drawing"
          title="Undo (Ctrl+Z)"
          disabled={!history.current.undo.length}
          onClick={() => revert("undo")}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="board-sketch-tool"
          aria-label="Redo drawing"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!history.current.redo.length}
          onClick={() => revert("redo")}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="board-sketch-tool"
          aria-label="Delete drawing"
          title="Delete (Delete)"
          disabled={!selectedShape}
          onClick={() => selected && remove(selected)}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </>
  );
  return { layer, tools, repaint };
}

/** Lines of text, as SVG text, from a corner or around a centre. */
function lines(
  text: string,
  x: number,
  y: number,
  size: number,
  anchor: "start" | "middle",
) {
  const rows = text.split("\n");
  const step = size * 1.3;
  const top =
    anchor === "middle" ? y - ((rows.length - 1) * step) / 2 : y + size * 0.8;
  return (
    <text
      className="board-sketch-text"
      x={x}
      y={top}
      textAnchor={anchor}
      dominantBaseline={anchor === "middle" ? "middle" : "alphabetic"}
      style={{ fontSize: size }}
    >
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
        <tspan key={index} x={x} y={top + index * step}>
          {row || " "}
        </tspan>
      ))}
    </text>
  );
}

function TextEditor({
  shape,
  onDone,
}: {
  shape: ShapeDraft;
  onDone(text: string): void;
}) {
  const [text, setText] = useState(shape.text ?? "");
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  const box = shape.kind === "text";
  const size = textBox(text);
  const style: CSSProperties = box
    ? {
        left: shape.x,
        top: shape.y,
        width: Math.max(size.w, 120),
        height: size.h,
        fontSize: TEXT_SIZE,
        color: COLORS[shape.color],
      }
    : {
        left: shape.x,
        top: shape.y,
        width: Math.max(shape.w, 80),
        height: Math.max(shape.h, 40),
        fontSize: LABEL_SIZE,
        textAlign: "center",
        color: COLORS[shape.color],
      };
  return (
    <textarea
      className={`board-sketch-edit board-sketch-live${box ? "" : " board-sketch-edit-label"}`}
      aria-label={box ? "Drawing text" : "Drawing label"}
      // biome-ignore lint/a11y/noAutofocus: the text is typed where it was placed
      autoFocus
      value={text}
      style={style}
      onChange={(event) => setText(event.target.value)}
      onBlur={finish}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.metaKey || event.ctrlKey))
        ) {
          event.preventDefault();
          finish();
        }
      }}
    />
  );
}
