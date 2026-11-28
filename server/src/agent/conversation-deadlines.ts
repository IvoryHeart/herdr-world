import type { Scheduler } from "../service/clock";
import { DELIVERY_CHECK_MS } from "./conversation-delivery";

/**
 * Each send's check ends even without a browser read. The caller's final read
 * settles what it can, expires the rest and notifies watchers after IO completes.
 */
export function createConversationDeadlines(
  scheduler: Scheduler,
  finish: (paneId: string) => Promise<void>,
) {
  const timers = new Set<ReturnType<Scheduler["schedule"]>>();
  return {
    schedule(paneId: string) {
      const timer = scheduler.schedule(async () => {
        timers.delete(timer);
        await finish(paneId);
      }, DELIVERY_CHECK_MS + 1000);
      timer.unref?.();
      timers.add(timer);
    },
    dispose() {
      for (const timer of timers) timer.cancel();
      timers.clear();
    },
  };
}
