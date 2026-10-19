/**
 * Board's pointer input as one explicit state machine. The view classifies
 * what each pointer landed on, feeds normalised events in, and applies the
 * effects that come out; this module never touches the DOM, the camera or
 * the board's data, so every gesture can be tested as a sequence of events.
 *
 * States: idle, pressing (down, not yet moved), panning, pinching, dragging a
 * card, dragging a string, dragging a host label. A new gesture's first
 * finger resets anything left over, so a lift the board never saw cannot
 * leave it stuck.
 */

export type Point = { x: number; y: number };

/** What a pointer landed on, decided by the view from the DOM. */
export type GestureTarget =
  | { kind: "empty" }
  | { kind: "card"; key: string; paneKey?: string }
  | { kind: "handle"; key: string }
  | { kind: "host"; key: string }
  | { kind: "string"; id: string };

export type GestureEvent =
  | {
      type: "down";
      id: number;
      at: Point;
      time: number;
      target: GestureTarget;
      primary: boolean;
      pointerType: string;
    }
  | { type: "move"; id: number; at: Point; time: number }
  | { type: "up"; id: number; at: Point; time: number }
  /** The browser took the pointer away (cancel, lost capture). */
  | { type: "cancel"; id: number };

export type GestureEffect =
  | { type: "panBy"; dx: number; dy: number }
  | { type: "fling"; vx: number; vy: number }
  | { type: "stopCamera" }
  | { type: "pinchStart"; mid: Point; distance: number }
  | { type: "pinch"; mid: Point; scale: number }
  | { type: "liftCard"; key: string; grab: Point; at: Point }
  | { type: "moveCard"; key: string; at: Point }
  | { type: "dropCard"; key: string; at: Point; vx: number; vy: number }
  /** A drag ended without a drop (pinch took over, cancel): keep it there. */
  | { type: "settleCard"; key: string }
  | {
      type: "tap";
      target: GestureTarget;
      at: Point;
      pointerType: string;
    }
  | { type: "doubleTap"; at: Point }
  | { type: "startString"; key: string; at: Point }
  | { type: "moveString"; at: Point }
  | { type: "dropString"; at: Point; travelled: number }
  | { type: "cancelString" }
  | { type: "moveHost"; key: string; dx: number; dy: number }
  | { type: "dropHost"; key: string }
  | { type: "pickString"; id: string };

type Sample = { x: number; y: number; t: number };
type Mode =
  | { name: "idle" }
  | {
      name: "pressing";
      id: number;
      start: Point;
      target: GestureTarget;
      pointerType: string;
    }
  | { name: "panning"; id: number; last: Point; hist: Sample[]; start: Point }
  | {
      name: "pinching";
      ids: [number, number];
      distance: number;
      mid: Point;
    }
  | { name: "card"; id: number; key: string; hist: Sample[] }
  | { name: "string"; id: number; start: Point }
  | { name: "host"; id: number; key: string; last: Point };

export type GestureState = {
  mode: Mode;
  /** Pointers currently down, by ID. */
  pointers: ReadonlyMap<number, Point>;
  /** The last tap on empty board, for a touch double-tap. */
  lastTap: { at: Point; time: number } | null;
};

export const DRAG_THRESHOLD = 6;
export const DOUBLE_TAP_MS = 450;
export const DOUBLE_TAP_DISTANCE = 32;
const FLING_MIN = 150;
const VELOCITY_WINDOW_MS = 110;

export const initialGesture = (): GestureState => ({
  mode: { name: "idle" },
  pointers: new Map(),
  lastTap: null,
});

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
function velocity(hist: Sample[], now: number) {
  if (hist.length < 2) return { vx: 0, vy: 0 };
  const last = hist[hist.length - 1]!;
  const first = hist.find((s) => last.t - s.t < VELOCITY_WINDOW_MS) ?? hist[0]!;
  const dt = (last.t - first.t) / 1000;
  // A pause before release means no throw.
  if (dt <= 0 || now - last.t > 90) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}
const keep = (hist: Sample[], sample: Sample) => [...hist.slice(-7), sample];

/** Effects that end the current mode when something else takes over. */
function abandon(mode: Mode): GestureEffect[] {
  if (mode.name === "card") return [{ type: "settleCard", key: mode.key }];
  if (mode.name === "string") return [{ type: "cancelString" }];
  if (mode.name === "host") return [{ type: "dropHost", key: mode.key }];
  return [];
}

export function stepGesture(
  state: GestureState,
  event: GestureEvent,
): { state: GestureState; effects: GestureEffect[] } {
  const pointers = new Map(state.pointers);
  const effects: GestureEffect[] = [];
  let mode = state.mode;
  let lastTap = state.lastTap;
  const done = () => ({ state: { mode, pointers, lastTap }, effects });

  if (event.type === "down") {
    // A string's hit line is picked, not dragged.
    if (event.target.kind === "string") {
      effects.push({ type: "pickString", id: event.target.id });
      return done();
    }
    // The first finger of a new gesture: forget leftovers.
    if (event.primary && (pointers.size || mode.name !== "idle")) {
      effects.push(...abandon(mode));
      pointers.clear();
      mode = { name: "idle" };
    }
    pointers.set(event.id, event.at);
    effects.push({ type: "stopCamera" });
    if (pointers.size === 2) {
      effects.push(...abandon(mode));
      const [a, b] = [...pointers.entries()];
      const d = distance(a![1], b![1]) || 1;
      const mid = middle(a![1], b![1]);
      mode = { name: "pinching", ids: [a![0], b![0]], distance: d, mid };
      effects.push({ type: "pinchStart", mid, distance: d });
      return done();
    }
    if (pointers.size > 2) return done();
    const target = event.target;
    if (target.kind === "handle") {
      mode = { name: "string", id: event.id, start: event.at };
      effects.push({ type: "startString", key: target.key, at: event.at });
    } else if (target.kind === "host")
      mode = { name: "host", id: event.id, key: target.key, last: event.at };
    else
      mode = {
        name: "pressing",
        id: event.id,
        start: event.at,
        target,
        pointerType: event.pointerType,
      };
    return done();
  }

  if (event.type === "move") {
    if (!pointers.has(event.id)) return done();
    pointers.set(event.id, event.at);
    if (mode.name === "pinching") {
      const a = pointers.get(mode.ids[0]),
        b = pointers.get(mode.ids[1]);
      if (a && b)
        effects.push({
          type: "pinch",
          mid: middle(a, b),
          scale: (distance(a, b) || 1) / mode.distance,
        });
      return done();
    }
    if (mode.name === "pressing" && mode.id === event.id) {
      if (distance(event.at, mode.start) < DRAG_THRESHOLD) return done();
      if (mode.target.kind === "card") {
        effects.push({
          type: "liftCard",
          key: mode.target.key,
          grab: mode.start,
          at: event.at,
        });
        mode = {
          name: "card",
          id: event.id,
          key: mode.target.key,
          hist: [{ ...event.at, t: event.time }],
        };
      } else {
        effects.push({
          type: "panBy",
          dx: event.at.x - mode.start.x,
          dy: event.at.y - mode.start.y,
        });
        mode = {
          name: "panning",
          id: event.id,
          last: event.at,
          start: mode.start,
          hist: [{ ...event.at, t: event.time }],
        };
      }
      return done();
    }
    if (mode.name === "panning" && mode.id === event.id) {
      effects.push({
        type: "panBy",
        dx: event.at.x - mode.last.x,
        dy: event.at.y - mode.last.y,
      });
      mode = {
        ...mode,
        last: event.at,
        hist: keep(mode.hist, { ...event.at, t: event.time }),
      };
    } else if (mode.name === "card" && mode.id === event.id) {
      effects.push({ type: "moveCard", key: mode.key, at: event.at });
      mode = { ...mode, hist: keep(mode.hist, { ...event.at, t: event.time }) };
    } else if (mode.name === "string" && mode.id === event.id)
      effects.push({ type: "moveString", at: event.at });
    else if (mode.name === "host" && mode.id === event.id) {
      effects.push({
        type: "moveHost",
        key: mode.key,
        dx: event.at.x - mode.last.x,
        dy: event.at.y - mode.last.y,
      });
      mode = { ...mode, last: event.at };
    }
    return done();
  }

  // up or cancel
  if (!pointers.has(event.id)) return done();
  pointers.delete(event.id);
  const cancelled = event.type === "cancel";
  if (mode.name === "pinching") {
    // One finger stays: it pans from here, without a tap.
    const rest = [...pointers.entries()][0];
    mode = rest
      ? {
          name: "panning",
          id: rest[0],
          last: rest[1],
          start: rest[1],
          hist: [],
        }
      : { name: "idle" };
    return done();
  }
  const at = event.type === "up" ? event.at : null;
  if (mode.name === "pressing" && mode.id === event.id) {
    if (!cancelled && at) {
      effects.push({
        type: "tap",
        target: mode.target,
        at,
        pointerType: mode.pointerType,
      });
      if (mode.target.kind === "empty" && mode.pointerType !== "mouse") {
        const previous = lastTap;
        if (
          previous &&
          event.time - previous.time < DOUBLE_TAP_MS &&
          distance(previous.at, at) < DOUBLE_TAP_DISTANCE
        ) {
          effects.push({ type: "doubleTap", at });
          lastTap = null;
        } else lastTap = { at, time: event.time };
      }
    }
    mode = { name: "idle" };
  } else if (mode.name === "panning" && mode.id === event.id) {
    const v = velocity(mode.hist, event.type === "up" ? event.time : 0);
    if (!cancelled && Math.hypot(v.vx, v.vy) > FLING_MIN)
      effects.push({ type: "fling", ...v });
    mode = { name: "idle" };
  } else if (mode.name === "card" && mode.id === event.id) {
    if (cancelled || !at) effects.push({ type: "settleCard", key: mode.key });
    else
      effects.push({
        type: "dropCard",
        key: mode.key,
        at,
        ...velocity(mode.hist, event.time),
      });
    mode = { name: "idle" };
  } else if (mode.name === "string" && mode.id === event.id) {
    if (cancelled || !at) effects.push({ type: "cancelString" });
    else
      effects.push({
        type: "dropString",
        at,
        travelled: distance(at, mode.start),
      });
    mode = { name: "idle" };
  } else if (mode.name === "host" && mode.id === event.id) {
    effects.push({ type: "dropHost", key: mode.key });
    mode = { name: "idle" };
  }
  return done();
}
