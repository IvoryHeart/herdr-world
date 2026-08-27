export type TerminalResize = {
  cols: number;
  rows: number;
};

/**
 * Keep terminal resize traffic from outrunning the daemon while retaining the
 * latest dimensions for the next send. The renderer can still refit every
 * animation frame; this only rate-limits the network side effect.
 */
export const TERMINAL_RESIZE_SEND_INTERVAL_MS = 50;

type TerminalResizeSchedulerOptions = {
  intervalMs?: number;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (timer: number) => void;
};

export function sameTerminalResize(
  left: TerminalResize | null,
  right: TerminalResize | null,
): boolean {
  return Boolean(left && right && left.cols === right.cols && left.rows === right.rows);
}

export function createTerminalResizeScheduler(
  send: (size: TerminalResize) => boolean | void,
  {
    intervalMs = TERMINAL_RESIZE_SEND_INTERVAL_MS,
    now = () => performance.now(),
    setTimeout = (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout = (timer) => window.clearTimeout(timer),
  }: TerminalResizeSchedulerOptions = {},
) {
  let lastSent: TerminalResize | null = null;
  let lastSentAt: number | null = null;
  let pending: TerminalResize | null = null;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    timer = null;
    if (!pending) {
      return;
    }

    const currentTime = now();
    const remainingMs = lastSentAt === null
      ? 0
      : intervalMs - (currentTime - lastSentAt);
    if (remainingMs > 0) {
      timer = setTimeout(flush, remainingMs);
      return;
    }

    const next = pending;
    pending = null;
    if (sameTerminalResize(lastSent, next)) {
      return;
    }
    if (send(next) === false) {
      return;
    }
    lastSent = next;
    lastSentAt = currentTime;
  };

  return {
    submit(size: TerminalResize) {
      if (sameTerminalResize(lastSent, size)) {
        pending = null;
        clearTimer();
        return;
      }
      pending = { ...size };
      if (timer === null) {
        flush();
      }
    },
    reset() {
      pending = null;
      lastSent = null;
      lastSentAt = null;
      clearTimer();
    },
  };
}
