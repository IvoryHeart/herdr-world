import { describe, expect, test } from "bun:test";
import {
  initialGesture,
  stepGesture,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
  type GestureTarget,
} from "./boardGesture";

/** Run events in order; return every effect and the final state. */
function run(events: GestureEvent[], from: GestureState = initialGesture()) {
  let state = from;
  const effects: GestureEffect[] = [];
  for (const event of events) {
    const next = stepGesture(state, event);
    state = next.state;
    effects.push(...next.effects);
  }
  return {
    state,
    effects,
    types: effects.map((e) => e.type).filter((t) => t !== "stopCamera"),
  };
}
const empty: GestureTarget = { kind: "empty" };
const card: GestureTarget = { kind: "card", key: "c1" };
let clock = 0;
const down = (
  id: number,
  x: number,
  y: number,
  target: GestureTarget = empty,
  opts: { primary?: boolean; type?: string } = {},
): GestureEvent => ({
  type: "down",
  id,
  at: { x, y },
  time: (clock += 10),
  target,
  primary: opts.primary ?? true,
  pointerType: opts.type ?? "mouse",
});
const move = (id: number, x: number, y: number, dt = 16): GestureEvent => ({
  type: "move",
  id,
  at: { x, y },
  time: (clock += dt),
});
const up = (id: number, x: number, y: number, dt = 16): GestureEvent => ({
  type: "up",
  id,
  at: { x, y },
  time: (clock += dt),
});

describe("Board gestures", () => {
  test("a press without movement is a tap on what it landed on", () => {
    const { types, effects, state } = run([
      down(1, 10, 10, card),
      up(1, 11, 11),
    ]);
    expect(types).toEqual(["tap"]);
    expect(effects.find((e) => e.type === "tap")).toMatchObject({
      target: card,
    });
    expect(state.mode.name).toBe("idle");
  });

  test("a touch double-tap on empty board is a double tap; a mouse one is not", () => {
    const touch = { type: "touch" };
    expect(
      run([
        down(1, 50, 50, empty, touch),
        up(1, 50, 50),
        down(2, 52, 51, empty, touch),
        up(2, 52, 51, 200),
      ]).types,
    ).toEqual(["tap", "tap", "doubleTap"]);
    // A mouse double-click uses the browser's own dblclick.
    expect(
      run([down(1, 50, 50), up(1, 50, 50), down(1, 50, 50), up(1, 50, 50)])
        .types,
    ).toEqual(["tap", "tap"]);
    // Too slow is two taps.
    expect(
      run([
        down(1, 50, 50, empty, touch),
        up(1, 50, 50),
        down(2, 50, 50, empty, touch),
        up(2, 50, 50, 600),
      ]).types,
    ).toEqual(["tap", "tap"]);
  });

  test("dragging empty board pans, and a quick release flings", () => {
    const { types, effects } = run([
      down(1, 100, 100),
      move(1, 110, 100),
      move(1, 140, 100),
      move(1, 180, 100),
      up(1, 200, 100, 10),
    ]);
    expect(types.slice(0, 3)).toEqual(["panBy", "panBy", "panBy"]);
    expect(types).toContain("fling");
    expect(
      effects
        .filter((e) => e.type === "panBy")
        .reduce((sum, e) => sum + (e as { dx: number }).dx, 0),
    ).toBe(80);
  });

  test("dragging a card lifts it past the threshold and drops it with its speed", () => {
    const small = run([down(1, 0, 0, card), move(1, 3, 3)]);
    expect(small.types).toEqual([]);
    const { types, effects } = run([
      down(1, 0, 0, card),
      move(1, 10, 0),
      move(1, 20, 0),
      up(1, 20, 0, 200),
    ]);
    expect(types).toEqual(["liftCard", "moveCard", "dropCard"]);
    expect(effects.find((e) => e.type === "liftCard")).toMatchObject({
      key: "c1",
      grab: { x: 0, y: 0 },
    });
    // A pause before release: no throw.
    expect(effects.find((e) => e.type === "dropCard")).toMatchObject({
      vx: 0,
      vy: 0,
    });
    const thrown = run([
      down(1, 0, 0, card),
      move(1, 10, 0),
      move(1, 60, 0, 16),
      up(1, 90, 0, 8),
    ]);
    expect(
      (thrown.effects.find((e) => e.type === "dropCard") as { vx: number }).vx,
    ).toBeGreaterThan(1000);
  });

  test("a handle starts a string at once; a host label moves its host", () => {
    expect(
      run([
        down(1, 0, 0, { kind: "handle", key: "n1" }),
        move(1, 50, 0),
        up(1, 200, 0),
      ]).types,
    ).toEqual(["startString", "moveString", "dropString"]);
    const host = run([
      down(1, 0, 0, { kind: "host", key: "h" }),
      move(1, 5, 2),
      up(1, 5, 2),
    ]);
    expect(host.types).toEqual(["moveHost", "dropHost"]);
    expect(host.effects.find((e) => e.type === "moveHost")).toMatchObject({
      dx: 5,
      dy: 2,
    });
  });

  test("a second finger turns any drag into a pinch, and lifting one pans", () => {
    const { types, effects, state } = run([
      down(1, 100, 100, card, { type: "touch" }),
      move(1, 120, 100),
      down(2, 200, 100, empty, { primary: false, type: "touch" }),
      move(2, 300, 100),
      up(2, 300, 100),
      move(1, 130, 100),
    ]);
    // The lift carries the position; the second finger settles the card.
    expect(types).toEqual([
      "liftCard",
      "settleCard",
      "pinchStart",
      "pinch",
      "panBy",
    ]);
    expect(
      (effects.find((e) => e.type === "pinch") as { scale: number }).scale,
    ).toBeCloseTo(180 / 80);
    expect(state.mode.name).toBe("panning");
  });

  test("a finger whose lift was never seen does not break the next pinch", () => {
    // Finger 40 never lifts; the next gesture starts with a primary finger.
    const { types, effects } = run([
      down(40, 10, 10, empty, { type: "touch" }),
      down(41, 100, 100, empty, { type: "touch" }),
      down(42, 120, 100, empty, { primary: false, type: "touch" }),
      move(42, 220, 100),
    ]);
    expect(types.filter((t) => t === "pinchStart")).toHaveLength(1);
    expect(
      (effects.find((e) => e.type === "pinch") as { scale: number }).scale,
    ).toBeCloseTo(120 / 20);
  });

  test("a cancelled drag settles in place and a cancelled string is dropped", () => {
    expect(
      run([down(1, 0, 0, card), move(1, 20, 0), { type: "cancel", id: 1 }])
        .types,
    ).toEqual(["liftCard", "settleCard"]);
    expect(
      run([
        down(1, 0, 0, { kind: "handle", key: "n" }),
        { type: "cancel", id: 1 },
      ]).types,
    ).toEqual(["startString", "cancelString"]);
    // A cancelled press is not a tap.
    expect(run([down(1, 0, 0, card), { type: "cancel", id: 1 }]).types).toEqual(
      [],
    );
  });

  test("a press on a string picks it without starting a gesture", () => {
    const { types, state } = run([down(1, 0, 0, { kind: "string", id: "s1" })]);
    expect(types).toEqual(["pickString"]);
    expect(state.pointers.size).toBe(0);
  });

  test("events for pointers that are not down change nothing", () => {
    const { types, state } = run([
      move(9, 1, 1),
      up(9, 1, 1),
      { type: "cancel", id: 9 },
    ]);
    expect(types).toEqual([]);
    expect(state.mode.name).toBe("idle");
  });
});
