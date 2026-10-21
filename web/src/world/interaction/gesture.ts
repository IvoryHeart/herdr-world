/**
 * Pointer input for World's spatial views (Town and Board) as one explicit
 * state machine. A view classifies what each pointer landed on, feeds
 * normalised events in, and applies the effects that come out; this module
 * never touches the DOM, a camera or a view's data, so every gesture can be
 * tested as a sequence of events.
 *
 * States: idle, pressing (down, not yet moved), panning, pinching, dragging an
 * item, drawing a line from a handle, dragging a group. A new gesture's first
 * finger resets anything left over, so a lift the view never saw cannot leave
 * it stuck. A second finger turns any press or drag into a pinch, and a
 * cancelled or lost pointer ends its gesture without a tap or a drop.
 *
 * Each view describes its targets through a GestureConfig: what role a target
 * plays, and the view's thresholds. A touch press held still on a draggable
 * target becomes a drag when the view reports the hold (its timer feeds a
 * `hold` event), so a quick swipe across it still pans; a mouse drags once it
 * moves past the threshold.
 */

export type Point = { x: number; y: number };

/**
 * What a target is to the machine:
 * - `plain`: tapped, or panned across;
 * - `drag`: picked up and moved (an item);
 * - `line`: a handle a line is drawn from;
 * - `group`: dragged as a whole at once (a host's label);
 * - `pick`: chosen on press, never dragged (a string's hit line).
 */
export type GestureRole = "plain" | "drag" | "line" | "group" | "pick";

export type GestureConfig<T> = {
  role(target: T): GestureRole;
  /** The key a drag, line, group or pick effect carries. */
  key(target: T): string;
  /** Touch hold before a draggable target lifts; null drags on movement. */
  holdMs: number | null;
  dragThreshold: number;
  doubleTap: {
    ms: number;
    distance: number;
    /** Whether mouse taps count (Board leaves them to native dblclick). */
    mouse: boolean;
    /** Whether a tap on this target can make a double tap. */
    on(target: T): boolean;
  };
};

export type GestureEvent<T> =
  | {
      type: "down";
      id: number;
      at: Point;
      time: number;
      target: T;
      primary: boolean;
      pointerType: string;
    }
  | { type: "move"; id: number; at: Point; time: number }
  | { type: "up"; id: number; at: Point; time: number }
  /** A touch press has been held still for the view's hold time. */
  | { type: "hold"; id: number; time: number }
  /** The browser took the pointer away (cancel, lost capture). */
  | { type: "cancel"; id: number };

export type GestureEffect<T> =
  | { type: "panBy"; dx: number; dy: number }
  | { type: "fling"; vx: number; vy: number }
  | { type: "stopCamera" }
  | { type: "pinchStart"; mid: Point; distance: number }
  | { type: "pinch"; mid: Point; scale: number }
  | {
      type: "liftCard";
      key: string;
      target: T;
      grab: Point;
      at: Point;
      /** True when a touch hold lifted it (the view may vibrate). */
      held: boolean;
    }
  | { type: "moveCard"; key: string; at: Point }
  | { type: "dropCard"; key: string; at: Point; vx: number; vy: number }
  /** A drag ended without a drop (pinch took over, cancel): keep it there. */
  | { type: "settleCard"; key: string }
  | { type: "tap"; target: T; at: Point; pointerType: string }
  /** The second tap of a double tap, instead of its tap. */
  | { type: "doubleTap"; target: T; at: Point; pointerType: string }
  | { type: "startString"; key: string; at: Point }
  | { type: "moveString"; at: Point }
  | { type: "dropString"; at: Point; travelled: number }
  | { type: "cancelString" }
  | { type: "moveHost"; key: string; dx: number; dy: number }
  | { type: "dropHost"; key: string }
  /** A group drag ended without a drop: put it back, save nothing. */
  | { type: "cancelHost"; key: string }
  | { type: "pickString"; id: string };

type Sample = { x: number; y: number; t: number };
type Mode<T> =
  | { name: "idle" }
  | {
      name: "pressing";
      id: number;
      start: Point;
      last: Point;
      target: T;
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

export type GestureState<T> = {
  mode: Mode<T>;
  /** Pointers currently down, by ID. */
  pointers: ReadonlyMap<number, Point>;
  /** The last tap that could start a double tap. */
  lastTap: { at: Point; time: number } | null;
};

export const DRAG_THRESHOLD = 6;
const FLING_MIN = 150;
const VELOCITY_WINDOW_MS = 110;

export const initialGesture = <T>(): GestureState<T> => ({
  mode: { name: "idle" },
  pointers: new Map(),
  lastTap: null,
});

/** Whether a press on this target waits for a hold (touch on a drag target). */
export function waitsForHold<T>(
  config: GestureConfig<T>,
  target: T,
  pointerType: string,
) {
  return (
    config.holdMs !== null &&
    pointerType !== "mouse" &&
    config.role(target) === "drag"
  );
}

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
function abandon<T>(mode: Mode<T>): GestureEffect<T>[] {
  if (mode.name === "card") return [{ type: "settleCard", key: mode.key }];
  if (mode.name === "string") return [{ type: "cancelString" }];
  if (mode.name === "host") return [{ type: "cancelHost", key: mode.key }];
  return [];
}

export function stepGesture<T>(
  state: GestureState<T>,
  event: GestureEvent<T>,
  config: GestureConfig<T>,
): { state: GestureState<T>; effects: GestureEffect<T>[] } {
  const pointers = new Map(state.pointers);
  const effects: GestureEffect<T>[] = [];
  let mode = state.mode;
  let lastTap = state.lastTap;
  const done = () => ({ state: { mode, pointers, lastTap }, effects });
  const lift = (
    pressing: Extract<Mode<T>, { name: "pressing" }>,
    at: Point,
    time: number,
    held: boolean,
  ) => {
    const key = config.key(pressing.target);
    effects.push({
      type: "liftCard",
      key,
      target: pressing.target,
      grab: pressing.start,
      at,
      held,
    });
    mode = { name: "card", id: pressing.id, key, hist: [{ ...at, t: time }] };
  };

  if (event.type === "down") {
    const role = config.role(event.target);
    // A string's hit line is picked, not dragged, but only as a gesture's
    // first pointer: a second finger on one joins the gesture as a pinch.
    if (role === "pick" && (event.primary || pointers.size === 0)) {
      effects.push({ type: "pickString", id: config.key(event.target) });
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
    if (role === "line") {
      mode = { name: "string", id: event.id, start: event.at };
      effects.push({
        type: "startString",
        key: config.key(event.target),
        at: event.at,
      });
    } else if (role === "group")
      mode = {
        name: "host",
        id: event.id,
        key: config.key(event.target),
        last: event.at,
      };
    else
      mode = {
        name: "pressing",
        id: event.id,
        start: event.at,
        last: event.at,
        target: event.target,
        pointerType: event.pointerType,
      };
    return done();
  }

  if (event.type === "hold") {
    // Held still on a draggable target: pick it up where it was pressed.
    if (
      mode.name === "pressing" &&
      mode.id === event.id &&
      waitsForHold(config, mode.target, mode.pointerType)
    )
      lift(mode, mode.last, event.time, true);
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
      if (distance(event.at, mode.start) < config.dragThreshold) {
        mode = { ...mode, last: event.at };
        return done();
      }
      // A draggable target lifts on movement, unless touch must hold first:
      // then moving before the hold pans instead.
      if (
        config.role(mode.target) === "drag" &&
        !waitsForHold(config, mode.target, mode.pointerType)
      ) {
        lift(mode, event.at, event.time, false);
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
    if (!cancelled && at && event.type === "up") {
      const tap = config.doubleTap;
      const counts =
        tap.on(mode.target) && (tap.mouse || mode.pointerType !== "mouse");
      const previous = lastTap;
      if (
        counts &&
        previous &&
        event.time - previous.time < tap.ms &&
        distance(previous.at, at) < tap.distance
      ) {
        effects.push({
          type: "doubleTap",
          target: mode.target,
          at,
          pointerType: mode.pointerType,
        });
        lastTap = null;
      } else {
        effects.push({
          type: "tap",
          target: mode.target,
          at,
          pointerType: mode.pointerType,
        });
        lastTap = counts ? { at, time: event.time } : null;
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
    effects.push(
      cancelled || !at
        ? { type: "cancelHost", key: mode.key }
        : { type: "dropHost", key: mode.key },
    );
    mode = { name: "idle" };
  }
  return done();
}
