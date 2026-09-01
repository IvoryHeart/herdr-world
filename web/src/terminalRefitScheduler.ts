/**
 * Fitting the Ghostty canvas can reflow the full terminal buffer. Keep that
 * work responsive during a continuous host resize while always applying the
 * latest dimensions shortly after the final observation.
 */
export const TERMINAL_REFIT_INTERVAL_MS = 80;

type TerminalRefitSchedulerOptions = {
  intervalMs?: number;
  now?: () => number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (frame: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (timer: number) => void;
};

export function createTerminalRefitScheduler(
  refit: () => void,
  {
    intervalMs = TERMINAL_REFIT_INTERVAL_MS,
    now = () => performance.now(),
    requestAnimationFrame = (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame = (frame) => window.cancelAnimationFrame(frame),
    setTimeout = (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout = (timer) => window.clearTimeout(timer),
  }: TerminalRefitSchedulerOptions = {},
) {
  let pending = false;
  let frame: number | null = null;
  let timer: number | null = null;
  let lastRefitAt: number | null = null;

  const queueFrame = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (!pending) return;

      const currentTime = now();
      const remainingMs = lastRefitAt === null
        ? 0
        : intervalMs - (currentTime - lastRefitAt);
      if (remainingMs > 0) {
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            queueFrame();
          }, remainingMs);
        }
        return;
      }

      pending = false;
      lastRefitAt = currentTime;
      refit();
    });
  };

  return {
    request() {
      pending = true;
      if (timer === null) queueFrame();
    },
    cancel() {
      pending = false;
      if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
