import { useCallback, useSyncExternalStore } from "react";

/**
 * The page's one second clock for the bus's countdowns. Town's stop signs
 * and the bin's chip and tray all read `now` from here, so at any instant
 * they compute the timetable from the same moment and cannot read a second
 * apart (each with its own timer, they ticked out of phase). One timer runs
 * while any of them counts down.
 */
let now = typeof performance === "undefined" ? 0 : performance.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const read = () => now;

function subscribe(listener: () => void) {
  if (!listeners.size) {
    now = performance.now();
    timer = setInterval(() => {
      now = performance.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size || timer === null) return;
    clearInterval(timer);
    timer = null;
  };
}

const still = () => () => {};

/** `performance.now()` as of the shared clock's last tick, ticking while `running`. */
export function useBinSecondClock(running: boolean) {
  const follow = useCallback(
    (listener: () => void) => (running ? subscribe(listener) : still()),
    [running],
  );
  return useSyncExternalStore(follow, read, read);
}
