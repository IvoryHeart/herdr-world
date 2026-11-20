/**
 * Board drawings: shapes, arrows, text and pen strokes the user draws on
 * Board to brainstorm. They are saved with the one World Board document,
 * beside notes and strings, and are visual only: unlike a string, an arrow
 * never sends anything to an agent. An arrow end may attach to another
 * drawing, a note or a card (a workspace or tab card key, a native-keyed
 * preference like a card's position); when that target is gone the end stays
 * at its last saved point.
 */

export type BoardShapeKind =
  | "rect"
  | "ellipse"
  | "diamond"
  | "text"
  | "pen"
  | "arrow";
export const BOARD_SHAPE_KINDS: readonly BoardShapeKind[] = [
  "rect",
  "ellipse",
  "diamond",
  "text",
  "pen",
  "arrow",
];
/** Ink follows the Board surface (dark on whiteboard, chalk on blackboard). */
export type BoardShapeColor =
  | "ink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple";
export const BOARD_SHAPE_COLORS: readonly BoardShapeColor[] = [
  "ink",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
];
export type BoardShapeAttach =
  | { shape: string }
  | { note: string }
  | { card: string };
export type BoardShapeEnd = { x: number; y: number; attach?: BoardShapeAttach };
export type BoardShape = {
  id: string;
  kind: BoardShapeKind;
  color: BoardShapeColor;
  /** Top-left and size in Board units; for an arrow, the box of its ends. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tinted fill for rectangles, ellipses and diamonds. */
  fill?: boolean;
  /** The label of a box shape, or a text shape's text. */
  text?: string;
  /** A pen stroke: x, y pairs relative to the top-left. */
  points?: number[];
  /** An arrow's ends. */
  from?: BoardShapeEnd;
  to?: BoardShapeEnd;
  rev: number;
};

export const BOARD_SHAPE_LIMITS = Object.freeze({
  shapes: 1_000,
  text: 2_000,
  /** Numbers in one stroke (x, y pairs). */
  points: 4_000,
  key: 512,
  coordinate: 1e7,
  size: 1e6,
});

export class BoardShapeError extends Error {}
const fail = (message: string): never => {
  throw new BoardShapeError(`invalid board: ${message}`);
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown, what: string) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= BOARD_SHAPE_LIMITS.key
    ? value
    : fail(
        `${what} must be a string of at most ${BOARD_SHAPE_LIMITS.key} characters`,
      );
const coordinate = (value: unknown, what: string) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) <= BOARD_SHAPE_LIMITS.coordinate
    ? value
    : fail(`${what} must be a finite number`);
const size = (value: unknown, what: string) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= BOARD_SHAPE_LIMITS.size
    ? value
    : fail(`${what} must be a size`);

function attach(value: unknown): BoardShapeAttach {
  if (!isObject(value)) return fail("arrow attachment must be an object");
  if ("shape" in value) return { shape: id(value.shape, "attached shape") };
  if ("note" in value) return { note: id(value.note, "attached note") };
  if ("card" in value) return { card: id(value.card, "attached card") };
  return fail("arrow attachment");
}
function end(value: unknown, what: string): BoardShapeEnd {
  if (!isObject(value)) return fail(`${what} must be an object`);
  return {
    x: coordinate(value.x, what),
    y: coordinate(value.y, what),
    ...(value.attach === undefined ? {} : { attach: attach(value.attach) }),
  };
}

/** Parse a drawing strictly; anything unexpected is refused. */
export function parseBoardShape(value: unknown, rev: number): BoardShape {
  if (!isObject(value)) return fail("shape must be an object");
  const kind = value.kind as BoardShapeKind;
  if (!BOARD_SHAPE_KINDS.includes(kind)) fail("shape kind");
  const color = value.color as BoardShapeColor;
  if (!BOARD_SHAPE_COLORS.includes(color)) fail("shape colour");
  const shape: BoardShape = {
    id: id(value.id, "shape id"),
    kind,
    color,
    x: coordinate(value.x, "shape x"),
    y: coordinate(value.y, "shape y"),
    w: size(value.w, "shape width"),
    h: size(value.h, "shape height"),
    rev,
  };
  if (value.fill === true && ["rect", "ellipse", "diamond"].includes(kind))
    shape.fill = true;
  if (value.text !== undefined) {
    if (kind === "pen" || kind === "arrow")
      fail("only boxes and text hold text");
    if (
      typeof value.text !== "string" ||
      value.text.length > BOARD_SHAPE_LIMITS.text
    )
      fail(`shape text must be at most ${BOARD_SHAPE_LIMITS.text} characters`);
    shape.text = value.text as string;
  }
  if (kind === "pen") {
    const points = value.points;
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length % 2 ||
      points.length > BOARD_SHAPE_LIMITS.points
    )
      fail(`a stroke has 1 to ${BOARD_SHAPE_LIMITS.points / 2} points`);
    shape.points = (points as unknown[]).map((entry) =>
      coordinate(entry, "stroke point"),
    );
  } else if (value.points !== undefined) fail("only a stroke has points");
  if (kind === "arrow") {
    shape.from = end(value.from, "arrow start");
    shape.to = end(value.to, "arrow end");
    if (
      shape.from.attach &&
      "shape" in shape.from.attach &&
      shape.from.attach.shape === shape.id
    )
      fail("an arrow cannot attach to itself");
    if (
      shape.to.attach &&
      "shape" in shape.to.attach &&
      shape.to.attach.shape === shape.id
    )
      fail("an arrow cannot attach to itself");
  } else if (value.from !== undefined || value.to !== undefined)
    fail("only an arrow has ends");
  return shape;
}

export function parseBoardShapes(value: unknown): BoardShape[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return fail("shapes must be a list");
  const shapes = value.map((entry) => {
    const rev =
      isObject(entry) &&
      Number.isSafeInteger(entry.rev) &&
      (entry.rev as number) > 0
        ? (entry.rev as number)
        : fail("shape rev");
    return parseBoardShape(entry, rev);
  });
  checkBoardShapes(shapes);
  return shapes;
}

export function checkBoardShapes(shapes: readonly BoardShape[]) {
  if (shapes.length > BOARD_SHAPE_LIMITS.shapes)
    fail(`at most ${BOARD_SHAPE_LIMITS.shapes} drawings`);
  const ids = new Set(shapes.map((shape) => shape.id));
  if (ids.size !== shapes.length) fail("duplicate drawing ids");
}
