import type { Scheduler } from "./ports";

/** How long stop waits for requests that were running when it began. */
const DRAIN_TIMEOUT_MS = 2_000;

/** Requests and socket messages still running; stop waits for them. */
export function inFlightWork(
  scheduler: Scheduler,
  onTimeout: (requests: number) => void,
) {
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work);
    void work.then(
      () => inFlight.delete(work),
      () => inFlight.delete(work),
    );
    return work;
  }
  function drained(): Promise<void> {
    if (!inFlight.size) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = scheduler.schedule(() => {
        onTimeout(inFlight.size);
        resolve();
      }, DRAIN_TIMEOUT_MS);
      void Promise.allSettled([...inFlight]).then(() => {
        timer.cancel();
        resolve();
      });
    });
  }
  return { track, drained };
}
