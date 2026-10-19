/**
 * Board's frame loop. Anything that changes what is on screen calls
 * invalidate(reason); a frame runs on the next animation frame with the
 * reasons collected since the last one. The loop keeps going while the frame
 * says something is still moving, and stops otherwise, so a still board costs
 * nothing. An error in one frame is reported and never stops later frames.
 */

export type FrameLoop = {
  invalidate(reason: string): void;
  /** True while a frame is scheduled. */
  running(): boolean;
  stop(): void;
};

export type FrameLoopOptions = {
  /** Draw one frame; return true while something is still moving. */
  frame(dt: number, reasons: ReadonlySet<string>): boolean;
  onError(error: unknown, reasons: ReadonlySet<string>): void;
  request?: (callback: (time: number) => void) => number;
  cancel?: (handle: number) => void;
  now?: () => number;
};

const MAX_DT = 1 / 30;

export function createFrameLoop(options: FrameLoopOptions): FrameLoop {
  const request = options.request ?? ((cb) => requestAnimationFrame(cb));
  const cancel = options.cancel ?? ((handle) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => performance.now());
  let handle: number | null = null;
  let last: number | null = null;
  let reasons = new Set<string>();
  let stopped = false;

  const run = (time: number) => {
    handle = null;
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
    if (moving || reasons.size) schedule();
    else last = null;
  };
  const schedule = () => {
    if (handle === null && !stopped) handle = request(run);
  };
  return {
    invalidate(reason) {
      reasons.add(reason);
      schedule();
    },
    running: () => handle !== null,
    stop() {
      stopped = true;
      if (handle !== null) cancel(handle);
      handle = null;
      void now;
    },
  };
}
