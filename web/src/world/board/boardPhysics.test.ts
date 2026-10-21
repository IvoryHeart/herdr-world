import { describe, expect, test } from "bun:test";
import {
  cool,
  stepPhysics,
  warm,
  type PhysicsCard,
  type PhysicsState,
} from "./boardPhysics";

const card = (key: string, patch: Partial<PhysicsCard> = {}): PhysicsCard => ({
  key,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  size: { w: 210, h: 66 },
  home: { x: 0, y: 0 },
  fixed: false,
  gliding: false,
  stiffness: 60,
  ...patch,
});

/** Run at 60 frames a second until rest; returns the seconds it took. */
function runToRest(cards: PhysicsCard[], state: PhysicsState, limit = 5) {
  const dt = 1 / 60;
  let t = 0;
  while (t < limit) {
    stepPhysics(cards, state, dt / 2);
    stepPhysics(cards, state, dt / 2);
    t += dt;
    if (cool(cards, state, dt, false)) return t;
  }
  return Infinity;
}

describe("Board physics", () => {
  test("after an interaction the board comes to rest within about a second", () => {
    const tab = card("tab", { x: 300, y: -200, home: { x: 0, y: 0 } });
    const state = { heat: 0 };
    warm(state);
    const seconds = runToRest([tab], state);
    expect(seconds).toBeLessThan(1.2);
    expect(state.heat).toBe(0);
    expect(tab.vx).toBe(0);
  });

  test("a card springs toward its home while the board is warm", () => {
    const tab = card("tab", { x: 400, y: 0, home: { x: 0, y: 0 } });
    const state = { heat: 1 };
    for (let i = 0; i < 30; i++) stepPhysics([tab], state, 1 / 60);
    expect(Math.abs(tab.x)).toBeLessThan(400);
  });

  test("a cold board never moves", () => {
    const tab = card("tab", { x: 400, home: { x: 0, y: 0 } });
    stepPhysics([tab], { heat: 0 }, 1 / 60);
    expect(tab.x).toBe(400);
  });

  test("overlapping cards separate and a held card is never pushed", () => {
    const held = card("held", { fixed: true, home: null });
    const other = card("other", { x: 20, y: 0, home: null });
    const state = { heat: 1 };
    for (let i = 0; i < 120; i++) stepPhysics([held, other], state, 1 / 60);
    expect(held.x).toBe(0);
    // Separated along the shallower overlap (here vertically): no overlap left.
    const apartX = Math.abs(other.x - held.x) >= 210 + 14 - 1;
    const apartY = Math.abs(other.y - held.y) >= 66 + 14 - 1;
    expect(apartX || apartY).toBe(true);
  });

  test("a thrown card glides, stops, and reports where it stopped", () => {
    const thrown = card("thrown", {
      gliding: true,
      vx: 1500,
      home: { x: 0, y: 0 },
    });
    const state = { heat: 1 };
    let stopped: string[] = [];
    for (let i = 0; i < 240 && !stopped.length; i++)
      stopped = stepPhysics([thrown], state, 1 / 60);
    expect(stopped).toEqual(["thrown"]);
    // It glides away from home instead of springing back.
    expect(thrown.x).toBeGreaterThan(100);
    expect(thrown.gliding).toBe(false);
  });

  test("the board stays warm while a card is held or gliding", () => {
    const state = { heat: 1 };
    const gliding = card("g", { gliding: true, vx: 800 });
    expect(cool([gliding], state, 1, false)).toBe(false);
    expect(cool([card("a")], state, 1, true)).toBe(false);
    expect(state.heat).toBe(1);
  });
});
