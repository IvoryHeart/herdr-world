import { useSyncExternalStore } from "react";

/**
 * One clock for Board's ages (step timers, idle time, usage reading ages):
 * a single timer while anything shows an age, so a card re-renders only its
 * own age, never the Board.
 */
export const BOARD_CLOCK_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (timer === undefined)
    timer = setInterval(() => {
      now = Date.now();
      for (const each of [...listeners]) each();
    }, BOARD_CLOCK_MS);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** A clock nobody watched is brought up to date before it is read. */
const read = () => {
  if (timer === undefined && Date.now() - now >= BOARD_CLOCK_MS)
    now = Date.now();
  return now;
};

/** The time, moving on every 30 seconds while subscribed. */
export function useBoardNow() {
  return useSyncExternalStore(subscribe, read, read);
}
