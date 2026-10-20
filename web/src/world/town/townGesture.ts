/**
 * Town's side of World's shared gesture machine (../interaction/gesture.ts).
 * A target is what the canvas hit test found under the pointer, and what a
 * drag from it would carry (a desk or a seated agent, zoomed in); the machine
 * is shared with Board.
 */

import type { GestureConfig } from "../interaction/gesture";
import type { TownDrag } from "./townDrag";
import { townHitKey, type TownHit } from "./townHitTest";

export type TownGestureTarget = {
  hit: TownHit | null;
  /** What dragging from here would carry; null when nothing can move. */
  drag: TownDrag | null;
};

/** Touch holds still this long on a desk or agent before it lifts. */
export const TOWN_HOLD_MS = 350;

export const TOWN_GESTURES: GestureConfig<TownGestureTarget> = {
  role: (target) => (target.drag ? "drag" : "plain"),
  key: (target) => target.drag?.key ?? townHitKey(target.hit) ?? "",
  holdMs: TOWN_HOLD_MS,
  dragThreshold: 6,
  // Any pointer can double tap: an agent or desk opens, elsewhere zooms in.
  doubleTap: { ms: 320, distance: 30, mouse: true, on: () => true },
};
