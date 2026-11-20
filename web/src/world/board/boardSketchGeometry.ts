import type {
  BoardShape,
  BoardShapeAttach,
  BoardShapeEnd,
} from "../../../../shared/boardShapes";
import { BOARD_SHAPE_LIMITS } from "../../../../shared/boardShapes";

/**
 * Board drawings' geometry (BoardSketch.tsx): pure, in Board units, so the
 * drawing layer's arithmetic is tested without a browser.
 */

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
/** What an attached arrow end points at: its box and outline. */
export type Target = { box: Box; outline: "rect" | "ellipse" | "diamond" };
export type ShapeDraft = Omit<BoardShape, "rev">;

export const TEXT_SIZE = 20;
const LINE = 1.3;
/** Space between an attached arrow's tip and its target's outline. */
const GAP = 6;

export const round = (value: number) => Math.round(value * 10) / 10;

export function boxBetween(a: Point, b: Point): Box {
  return {
    x: round(Math.min(a.x, b.x)),
    y: round(Math.min(a.y, b.y)),
    w: round(Math.abs(a.x - b.x)),
    h: round(Math.abs(a.y - b.y)),
  };
}
export const centre = (box: Box): Point => ({
  x: box.x + box.w / 2,
  y: box.y + box.h / 2,
});
export const contains = (box: Box, at: Point, pad = 0) =>
  at.x >= box.x - pad &&
  at.x <= box.x + box.w + pad &&
  at.y >= box.y - pad &&
  at.y <= box.y + box.h + pad;

/** A text shape's box: its lines at Board's text size. */
export function textBox(text: string): { w: number; h: number } {
  const lines = (text || " ").split("\n");
  const longest = Math.max(...lines.map((line) => line.length), 1);
  return {
    w: round(longest * TEXT_SIZE * 0.6 + 8),
    h: round(lines.length * TEXT_SIZE * LINE + 8),
  };
}

/** Fewer points along nearly straight runs (Ramer–Douglas–Peucker). */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = points[first]!,
      b = points[last]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    let farthest = -1,
      distance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const p = points[i]!;
      const d = length
        ? Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / length
        : Math.hypot(p.x - a.x, p.y - a.y);
      if (d > distance) {
        distance = d;
        farthest = i;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** A pen stroke from the points drawn, simplified to fit the saved bound. */
export function strokeFrom(
  drawn: readonly Point[],
  tolerance: number,
): Pick<ShapeDraft, "x" | "y" | "w" | "h" | "points"> | null {
  if (!drawn.length) return null;
  let points = tolerance > 0 ? simplify(drawn, tolerance) : [...drawn];
  for (
    let t = Math.max(tolerance, 0.25);
    points.length * 2 > BOARD_SHAPE_LIMITS.points;
  )
    points = simplify(drawn, (t *= 2));
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = round(Math.min(...xs)),
    y = round(Math.min(...ys));
  return {
    x,
    y,
    w: round(Math.max(...xs) - x),
    h: round(Math.max(...ys) - y),
    points: points.flatMap((p) => [round(p.x - x), round(p.y - y)]),
  };
}

/** A smooth path through a stroke's points (midpoint quadratic curves). */
export function strokePath(shape: Pick<ShapeDraft, "x" | "y" | "points">) {
  const p = shape.points ?? [];
  const at = (i: number): Point => ({
    x: shape.x + p[i * 2]!,
    y: shape.y + p[i * 2 + 1]!,
  });
  const count = p.length / 2;
  if (!count) return "";
  const first = at(0);
  if (count === 1) return `M${first.x} ${first.y}l0.01 0`;
  let d = `M${first.x} ${first.y}`;
  for (let i = 1; i < count - 1; i++) {
    const a = at(i),
      b = at(i + 1);
    d += `Q${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  }
  const last = at(count - 1);
  return `${d}L${last.x} ${last.y}`;
}

/** Where the line from a box's centre toward `toward` leaves its outline. */
export function outlinePoint(target: Target, toward: Point, gap = GAP): Point {
  const c = centre(target.box);
  const rx = target.box.w / 2 + gap,
    ry = target.box.h / 2 + gap;
  const dx = toward.x - c.x,
    dy = toward.y - c.y;
  if (!dx && !dy) return c;
  let t: number;
  if (target.outline === "ellipse")
    t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  else if (target.outline === "diamond")
    t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else t = Math.min(rx / Math.abs(dx || 1e-9), ry / Math.abs(dy || 1e-9));
  // Toward a point inside the outline, stop at the point.
  t = Math.min(t, 1);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export type Resolve = (attach: BoardShapeAttach) => Target | null;

/** An arrow's drawn ends: attached ends meet their targets' outlines. */
export function arrowEnds(
  from: BoardShapeEnd,
  to: BoardShapeEnd,
  resolve: Resolve,
): { a: Point; b: Point } {
  const ta = from.attach ? resolve(from.attach) : null;
  const tb = to.attach ? resolve(to.attach) : null;
  const ra = ta ? centre(ta.box) : { x: from.x, y: from.y };
  const rb = tb ? centre(tb.box) : { x: to.x, y: to.y };
  return {
    a: ta ? outlinePoint(ta, rb) : ra,
    b: tb ? outlinePoint(tb, ra) : rb,
  };
}

/** A line with an open head at `b`, sized to the line's length. */
export function arrowPath(a: Point, b: Point) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const head = Math.min(16, Math.max(6, length / 3));
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const wing = (side: number) => ({
    x: round(b.x - head * Math.cos(angle + side * 0.45)),
    y: round(b.y - head * Math.sin(angle + side * 0.45)),
  });
  const l = wing(1),
    r = wing(-1);
  const ax = round(a.x),
    ay = round(a.y),
    bx = round(b.x),
    by = round(b.y);
  return `M${ax} ${ay}L${bx} ${by}M${l.x} ${l.y}L${bx} ${by}L${r.x} ${r.y}`;
}

/** The box an outline or selection frame goes around. */
export function boundsOf(shape: ShapeDraft, resolve: Resolve): Box {
  if (shape.kind === "arrow" && shape.from && shape.to) {
    const { a, b } = arrowEnds(shape.from, shape.to, resolve);
    return boxBetween(a, b);
  }
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

/** Shapes an arrow end can attach to: boxes and text, topmost first. */
export function shapeAt(
  shapes: readonly ShapeDraft[],
  at: Point,
  except?: string,
): ShapeDraft | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (shape.id === except || shape.kind === "arrow" || shape.kind === "pen")
      continue;
    if (contains(shape, at, 4)) return shape;
  }
  return null;
}

/** Moved by (dx, dy): an arrow that moves leaves what it was attached to. */
export function moved(shape: ShapeDraft, dx: number, dy: number): ShapeDraft {
  const next = { ...shape, x: round(shape.x + dx), y: round(shape.y + dy) };
  if (shape.kind === "arrow" && shape.from && shape.to) {
    next.from = { x: round(shape.from.x + dx), y: round(shape.from.y + dy) };
    next.to = { x: round(shape.to.x + dx), y: round(shape.to.y + dy) };
  }
  return next;
}

/** Given a new box; a stroke's points scale with it. */
export function resized(shape: ShapeDraft, box: Box): ShapeDraft {
  const next = { ...shape, ...box };
  if (shape.kind === "pen" && shape.points) {
    const sx = shape.w ? box.w / shape.w : 1,
      sy = shape.h ? box.h / shape.h : 1;
    next.points = shape.points.map((value, index) =>
      round(value * (index % 2 ? sy : sx)),
    );
  }
  return next;
}

/** A box resized by dragging one corner, the opposite corner fixed. */
export function dragCorner(
  box: Box,
  corner: "nw" | "ne" | "sw" | "se",
  to: Point,
): Box {
  const fixed = {
    x: corner.includes("w") ? box.x + box.w : box.x,
    y: corner.includes("n") ? box.y + box.h : box.y,
  };
  return boxBetween(fixed, to);
}

/** An arrow's saved box: around its saved ends. */
export function arrowBox(from: Point, to: Point): Box {
  return boxBetween(from, to);
}

/* ---------- Undo ---------- */

/** One drawing before and after a change; null where it did not exist. */
export type ShapeChange = {
  id: string;
  before: ShapeDraft | null;
  after: ShapeDraft | null;
  /** The revision the change leaves the drawing at (0 when deleted). */
  rev: number;
};
export type ShapeOp =
  | { op: "shape.put"; shape: ShapeDraft; rev?: number }
  | { op: "shape.delete"; id: string; rev: number };

/** A saved drawing without its revision. */
export const strip = (shape: BoardShape): ShapeDraft => {
  const draft: Partial<BoardShape> = { ...shape };
  delete draft.rev;
  return draft as ShapeDraft;
};
/** The same drawing, whatever order its fields were written in. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, entry]) => [key, canonical(entry)]),
        )
      : value;
export const sameShape = (a: ShapeDraft, b: ShapeDraft) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * The operations that put each drawing back to `before`, or null when any of
 * them is not as the change left it (changed on another device, or by a
 * change not undone first): undo never overwrites a newer edit. Drawings are
 * compared by content, since deleting and restoring one starts its revisions
 * again. Applying the operations is itself a change (see changesFor), which
 * is what redo reverts.
 */
export function revertOps(
  changes: readonly ShapeChange[],
  current: readonly BoardShape[],
): ShapeOp[] | null {
  const byId = new Map(current.map((shape) => [shape.id, shape]));
  const ops: ShapeOp[] = [];
  for (const change of changes) {
    const now = byId.get(change.id);
    if (change.after ? !now || !sameShape(strip(now), change.after) : now)
      return null;
    if (!change.before)
      ops.push({ op: "shape.delete", id: change.id, rev: now!.rev });
    else if (now)
      ops.push({ op: "shape.put", shape: change.before, rev: now.rev });
    else ops.push({ op: "shape.put", shape: change.before });
  }
  return ops;
}

/** The changes for `ops` applied to `current`, for the undo history. */
export function changesFor(
  ops: readonly ShapeOp[],
  current: readonly BoardShape[],
): ShapeChange[] {
  const byId = new Map(current.map((shape) => [shape.id, shape]));
  return ops.map((op) => {
    const id = op.op === "shape.put" ? op.shape.id : op.id;
    const was = byId.get(id);
    return {
      id,
      before: was ? strip(was) : null,
      after: op.op === "shape.put" ? op.shape : null,
      rev: op.op === "shape.put" ? (was?.rev ?? 0) + 1 : 0,
    };
  });
}
