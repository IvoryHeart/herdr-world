/**
 * Board's frame loop, as a client of World's shared frame scheduler
 * (worldFrameScheduler.ts). Anything that changes what is on screen calls
 * invalidate(reason), which asks for a state frame; the frame runs with the
 * reasons collected since the last one. While the frame says something is
 * still moving (gliding cards, a settling camera), the loop asks for motion
 * frames, which the scheduler pauses while the user types in a terminal and
 * under reduced motion; a drag keeps invalidating, so it never pauses. The
 * scheduler skips a board that is off screen or in a hidden document, and
 * shares one frame budget with Town. An error in one frame is reported and
 * never stops later frames. A still board costs nothing.
 */

import { registerWorldFrames } from "../worldFrameScheduler";

export type FrameLoop = {
  invalidate(reason: string): void;
  /** True while a frame is requested. */
  running(): boolean;
  stop(): void;
};

/** The part of registerWorldFrames the loop uses; tests pass a fake. */
export type FrameRegistrar = (
  element: Element,
  draw: (now: number) => void,
) => {
  request(kind?: "state" | "motion"): void;
  dispose(): void;
};

export type FrameLoopOptions = {
  /** The board, so the scheduler can skip it while it is off screen. */
  element: Element;
  /** Draw one frame; return true while something is still moving. */
  frame(dt: number, reasons: ReadonlySet<string>): boolean;
  onError(error: unknown, reasons: ReadonlySet<string>): void;
  register?: FrameRegistrar;
};

const MAX_DT = 1 / 30;

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const register = options.register ?? registerWorldFrames;
  let last: number | null = null;
  let reasons = new Set<string>();
  let requested = false;
  let stopped = false;

  const draw = (time: number) => {
    requested = false;
    if (stopped) return;
    const dt =
      last === null
        ? 1 / 60
        : Math.min(MAX_DT, Math.max(0.001, (time - last) / 1000));
    last = time;
    const current = reasons;
    reasons = new Set();
    let moving = false;
    try {
      moving = options.frame(dt, current);
    } catch (error) {
      options.onError(error, current);
    }
    // New reasons arrived during the frame: they are state. Otherwise keep
    // going only as motion, which the scheduler may hold back.
    if (reasons.size) ask("state");
    else if (moving) ask("motion");
    else last = null;
  };
  const frames = register(options.element, draw);
  const ask = (kind: "state" | "motion") => {
    if (stopped) return;
    requested = true;
    frames.request(kind);
  };
  return {
    invalidate(reason) {
      reasons.add(reason);
      ask("state");
    },
    running: () => requested,
    stop() {
      stopped = true;
      requested = false;
      frames.dispose();
    },
  };
}
