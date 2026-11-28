import type { Clock, Scheduler } from "../../server/src/service/clock";

/** Fixture-owned time. No global timer mocking, IO turns or wall-clock waits. */
export class ManualClock implements Clock, Scheduler {
  private value = 0;
  private readonly jobs = new Set<{ at: number; callback: () => void }>();
  now = () => this.value;
  monotonic = () => this.value;
  schedule(callback: () => void, delay: number) {
    const job = { at: this.value + delay, callback };
    this.jobs.add(job);
    return {
      cancel: () => {
        this.jobs.delete(job);
      },
    };
  }
  get pending() {
    return this.jobs.size;
  }
  advance(ms: number) {
    const target = this.value + ms;
    for (;;) {
      const next = [...this.jobs]
        .filter((job) => job.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.value = next.at;
      this.jobs.delete(next);
      next.callback();
    }
    this.value = target;
  }
}
