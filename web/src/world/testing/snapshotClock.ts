import type { Clock, Scheduler } from "../../../../server/src/service/clock";

/** Deadline time is driven; ordinary transport work still yields an IO turn. */
export class SnapshotClock implements Clock, Scheduler {
  private value = Date.now();
  private nextId = 0;
  private readonly timers = new Map<
    number,
    { at: number; callback: () => void }
  >();
  now = () => this.value;
  monotonic = () => this.value;
  schedule(callback: () => void, delay: number) {
    if (delay === 0) {
      const turn = setImmediate(callback);
      return { cancel: () => clearImmediate(turn) };
    }
    const id = ++this.nextId;
    this.timers.set(id, { at: this.value + delay, callback });
    return {
      cancel: () => {
        this.timers.delete(id);
      },
    };
  }
  advance(ms: number) {
    this.value += ms;
    for (const [id, timer] of this.timers)
      if (timer.at <= this.value) {
        this.timers.delete(id);
        timer.callback();
      }
  }
}
