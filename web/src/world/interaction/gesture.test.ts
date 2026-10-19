import { describe, expect, test } from "bun:test";
import { TOWN_GESTURES, type TownGestureTarget } from "../town/townGesture";
import {
  initialGesture,
  stepGesture,
  waitsForHold,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
} from "./gesture";

// Town's configuration exercises the shared machine; Board's own cases live
// in board/boardGesture.test.ts.
type T = TownGestureTarget;
const desk: T = {
  hit: { kind: "desk", key: "d1" } as T["hit"],
  drag: {
    kind: "desk",
    key: "d1",
    hostKey: "h1",
    from: "r1",
    label: "Move build",
  },
};
const road: T = { hit: null, drag: null };

let clock = 0;
const down = (
  id: number,
  x: number,
  y: number,
  target: T,
  type = "touch",
  primary = true,
): GestureEvent<T> => ({
  type: "down",
  id,
  at: { x, y },
  time: (clock += 10),
  target,
  primary,
  pointerType: type,
});
const move = (id: number, x: number, y: number, dt = 16): GestureEvent<T> => ({
  type: "move",
  id,
  at: { x, y },
  time: (clock += dt),
});
const up = (id: number, x: number, y: number, dt = 16): GestureEvent<T> => ({
  type: "up",
  id,
  at: { x, y },
  time: (clock += dt),
});
const hold = (id: number): GestureEvent<T> => ({
  type: "hold",
  id,
  time: (clock += 350),
});

function run(
  events: GestureEvent<T>[],
  from: GestureState<T> = initialGesture(),
) {
  let state = from;
  const effects: GestureEffect<T>[] = [];
  for (const event of events) {
    const next = stepGesture(state, event, TOWN_GESTURES);
    state = next.state;
    effects.push(...next.effects);
  }
  return {
    state,
    effects,
    types: effects.map((e) => e.type).filter((t) => t !== "stopCamera"),
  };
}

describe("Shared gestures, as Town uses them", () => {
  test("a touch held still on a desk picks it up, and moving carries it", () => {
    expect(waitsForHold(TOWN_GESTURES, desk, "touch")).toBe(true);
    const { types, effects } = run([
      down(1, 100, 100, desk),
      hold(1),
      move(1, 140, 120),
      up(1, 140, 120, 200),
    ]);
    expect(types).toEqual(["liftCard", "moveCard", "dropCard"]);
    expect(effects.find((e) => e.type === "liftCard")).toMatchObject({
      key: "d1",
      held: true,
      grab: { x: 100, y: 100 },
    });
  });

  test("a quick swipe across a desk pans, and the late hold does nothing", () => {
    const { types, state } = run([
      down(1, 100, 100, desk),
      move(1, 130, 100),
      hold(1),
      move(1, 160, 100),
      up(1, 160, 100),
    ]);
    expect(types).toContain("panBy");
    expect(types).not.toContain("liftCard");
    expect(state.mode.name).toBe("idle");
  });

  test("a second finger during a drag cancels it into a pinch, without a drop", () => {
    const { types } = run([
      down(1, 100, 100, desk),
      hold(1),
      move(1, 120, 100),
      down(2, 200, 100, road, "touch", false),
      move(2, 260, 100),
      up(2, 260, 100),
      up(1, 120, 100),
    ]);
    expect(types.slice(0, 5)).toEqual([
      "liftCard",
      "moveCard",
      "settleCard",
      "pinchStart",
      "pinch",
    ]);
    expect(types).not.toContain("dropCard");
  });

  test("a mouse drags a desk after 6 px, without a hold", () => {
    expect(waitsForHold(TOWN_GESTURES, desk, "mouse")).toBe(false);
    expect(run([down(1, 0, 0, desk, "mouse"), move(1, 4, 0)]).types).toEqual(
      [],
    );
    const { types, effects } = run([
      down(1, 0, 0, desk, "mouse"),
      move(1, 7, 0),
      move(1, 20, 0),
    ]);
    expect(types).toEqual(["liftCard", "moveCard"]);
    expect(effects[1]).toMatchObject({ held: false });
  });

  test("a double tap is a double tap for touch and mouse, instead of a second tap", () => {
    for (const type of ["touch", "mouse"]) {
      const { types, effects } = run([
        down(1, 50, 50, desk, type),
        up(1, 50, 50),
        down(2, 52, 51, desk, type),
        up(2, 52, 51, 100),
      ]);
      expect(types).toEqual(["tap", "doubleTap"]);
      expect(effects[effects.length - 1]).toMatchObject({ target: desk });
    }
    // Too slow is two taps.
    expect(
      run([
        down(1, 50, 50, road),
        up(1, 50, 50),
        down(2, 50, 50, road),
        up(2, 50, 50, 400),
      ]).types,
    ).toEqual(["tap", "tap"]);
  });

  test("a cancelled pointer ends its gesture without a tap or a drop", () => {
    expect(run([down(1, 0, 0, road), { type: "cancel", id: 1 }]).types).toEqual(
      [],
    );
    expect(
      run([down(1, 0, 0, desk), hold(1), { type: "cancel", id: 1 }]).types,
    ).toEqual(["liftCard", "settleCard"]);
  });

  test("a road or room is never picked up, however long it is held", () => {
    expect(waitsForHold(TOWN_GESTURES, road, "touch")).toBe(false);
    expect(run([down(1, 0, 0, road), hold(1), up(1, 0, 0)]).types).toEqual([
      "tap",
    ]);
  });
});
