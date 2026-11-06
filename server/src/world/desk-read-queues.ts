type Job = { read(): Promise<void>; done(): void; promise: Promise<void> };
type Lane = { running: boolean; jobs: Map<string, Job> };

/** One active read per host and kind, retained until settlement even after cancellation. */
export class DeskReadQueues {
  private readonly lanes = new Map<string, Lane>();

  enqueue(
    laneKey: string,
    key: string,
    read: () => Promise<void>,
  ): Promise<void> {
    let lane = this.lanes.get(laneKey);
    if (!lane)
      this.lanes.set(laneKey, (lane = { running: false, jobs: new Map() }));
    const previous = lane.jobs.get(key);
    if (previous) {
      previous.read = read;
      return previous.promise;
    }
    const deferred = Promise.withResolvers<void>();
    lane.jobs.set(key, {
      read,
      done: deferred.resolve,
      promise: deferred.promise,
    });
    this.drain(laneKey, lane);
    return deferred.promise;
  }

  cancel(laneKey: string, key: string): void {
    const lane = this.lanes.get(laneKey),
      job = lane?.jobs.get(key);
    if (!lane || !job) return;
    lane.jobs.delete(key);
    job.done();
    if (!lane.running && !lane.jobs.size) this.lanes.delete(laneKey);
  }

  private drain(key: string, lane: Lane): void {
    if (lane.running) return;
    const next = lane.jobs.entries().next().value;
    if (!next) {
      this.lanes.delete(key);
      return;
    }
    const [jobKey, job] = next;
    lane.jobs.delete(jobKey);
    lane.running = true;
    const settled = () => {
      lane.running = false;
      job.done();
      this.drain(key, lane);
    };
    try {
      void job.read().then(settled, settled);
    } catch {
      settled();
    }
  }
}
