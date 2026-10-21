import type { Point, Size } from "./boardPlacement";

/**
 * Board's physics runs only while the user interacts. Cards spring toward
 * their home (anchor plus offset), overlaps push apart along the shallower
 * axis, and a thrown card glides with friction. Heat starts at 1 on any
 * interaction and decays to zero within about a second; at rest the caller
 * writes every card's position back as its offset and stops stepping.
 */

export type PhysicsCard = {
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: Size;
  /** Where the card belongs; null for free cards (notes, pinned cards). */
  home: Point | null;
  /** Held by the pointer, pinned, or animating: never moved by physics. */
  fixed: boolean;
  /** A thrown card glides on its velocity instead of springing home. */
  gliding: boolean;
  /** Tabs follow their workspace more tightly than workspaces their host. */
  stiffness: number;
};

export type PhysicsState = { heat: number };

const DAMPING = 0.84;
const FRICTION = 0.9;
const COOLING = 0.93;
const PUSH = 0.22;
const GAP = 14;
/** Below this speed a glide stops and the card keeps its place. */
export const GLIDE_STOP = 25;

export function warm(state: PhysicsState) {
  state.heat = 1;
}

/** Advance by `dt` seconds. Returns the keys of glides that stopped this step. */
export function stepPhysics(
  cards: readonly PhysicsCard[],
  state: PhysicsState,
  dt: number,
): string[] {
  const stopped: string[] = [];
  if (state.heat <= 0) return stopped;
  const ax = new Map<PhysicsCard, number>();
  const ay = new Map<PhysicsCard, number>();
  for (const card of cards) {
    let fx = 0,
      fy = 0;
    if (card.home && !card.fixed && !card.gliding) {
      fx = (card.home.x - card.x) * card.stiffness;
      fy = (card.home.y - card.y) * card.stiffness;
    }
    ax.set(card, fx);
    ay.set(card, fy);
  }
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i]!;
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j]!;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const ox = (a.size.w + b.size.w) / 2 + GAP - Math.abs(dx);
      const oy = (a.size.h + b.size.h) / 2 + GAP - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      const moveA = !a.fixed,
        moveB = !b.fixed;
      if (!moveA && !moveB) continue;
      const share = moveA && moveB ? 0.5 : 1;
      const px = ox < oy ? Math.sign(dx || 1) * ox : 0;
      const py = ox < oy ? 0 : Math.sign(dy || 1) * oy;
      const push = PUSH * state.heat * share;
      if (moveA) {
        a.x -= px * push;
        a.y -= py * push;
      }
      if (moveB) {
        b.x += px * push;
        b.y += py * push;
      }
    }
  }
  const damp = Math.pow(DAMPING, dt * 60);
  const friction = Math.pow(FRICTION, dt * 60);
  for (const card of cards) {
    if (card.fixed) continue;
    if (card.gliding) {
      card.vx *= friction;
      card.vy *= friction;
      if (Math.hypot(card.vx, card.vy) < GLIDE_STOP) {
        card.gliding = false;
        card.vx = card.vy = 0;
        stopped.push(card.key);
      }
    } else {
      card.vx = (card.vx + ax.get(card)! * dt * state.heat) * damp;
      card.vy = (card.vy + ay.get(card)! * dt * state.heat) * damp;
    }
    card.x += card.vx * dt;
    card.y += card.vy * dt;
  }
  return stopped;
}

/**
 * Cool the board unless something is still held or gliding. Returns true when
 * the board has just come to rest.
 */
export function cool(
  cards: readonly PhysicsCard[],
  state: PhysicsState,
  dt: number,
  holding: boolean,
): boolean {
  if (state.heat <= 0) return false;
  if (holding || cards.some((card) => card.gliding)) return false;
  state.heat *= Math.pow(COOLING, dt * 60);
  if (state.heat >= 0.02) return false;
  state.heat = 0;
  for (const card of cards) card.vx = card.vy = 0;
  return true;
}
