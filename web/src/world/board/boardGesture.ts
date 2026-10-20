/**
 * Board's side of World's shared gesture machine (../interaction/gesture.ts):
 * what Board's pointer targets are, and Board's thresholds. The view
 * classifies a pointer's target from the DOM, feeds events in and applies the
 * effects; the machine itself is shared with Town.
 */

import {
  initialGesture as sharedInitial,
  stepGesture as sharedStep,
  waitsForHold as sharedWaits,
  type GestureConfig,
  type GestureEffect as SharedEffect,
  type GestureEvent as SharedEvent,
  type GestureRole,
  type GestureState as SharedState,
} from "../interaction/gesture";

export type { Point } from "../interaction/gesture";
export { DRAG_THRESHOLD } from "../interaction/gesture";

/** What a pointer landed on, decided by the view from the DOM. */
export type GestureTarget =
  | { kind: "empty" }
  | { kind: "card"; key: string; paneKey?: string }
  | { kind: "handle"; key: string }
  | { kind: "host"; key: string }
  | { kind: "string"; id: string };

export type GestureEvent = SharedEvent<GestureTarget>;
export type GestureEffect = SharedEffect<GestureTarget>;
export type GestureState = SharedState<GestureTarget>;

/** Touch holds this long on a card before it lifts; a quick swipe pans. */
export const HOLD_MS = 350;
export const DOUBLE_TAP_MS = 450;
export const DOUBLE_TAP_DISTANCE = 32;

const ROLES: Record<GestureTarget["kind"], GestureRole> = {
  empty: "plain",
  card: "drag",
  handle: "line",
  host: "group",
  string: "pick",
};

export const BOARD_GESTURES: GestureConfig<GestureTarget> = {
  role: (target) => ROLES[target.kind],
  key: (target) =>
    target.kind === "string"
      ? target.id
      : target.kind === "empty"
        ? ""
        : target.key,
  holdMs: HOLD_MS,
  dragThreshold: 6,
  // Touch double-taps empty board for a note; a mouse uses native dblclick.
  doubleTap: {
    ms: DOUBLE_TAP_MS,
    distance: DOUBLE_TAP_DISTANCE,
    mouse: false,
    on: (target) => target.kind === "empty",
  },
};

export const initialGesture = (): GestureState =>
  sharedInitial<GestureTarget>();
export const stepGesture = (state: GestureState, event: GestureEvent) =>
  sharedStep(state, event, BOARD_GESTURES);
export const waitsForHold = (target: GestureTarget, pointerType: string) =>
  sharedWaits(BOARD_GESTURES, target, pointerType);
