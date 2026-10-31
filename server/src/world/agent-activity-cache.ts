import {
  activityFromList,
  enrichActivityList,
  type AgentActivityEntry,
} from "../../../shared/agentActivity";
import type { Clock } from "../service/ports";
import type { FocusedOwner } from "./focused-acquisition";

type Reading = {
  epoch: number;
  cached?: { entries: AgentActivityEntry[]; at: number };
  pending?: { epoch: number; promise: Promise<AgentActivityEntry[]> };
};
const keyOf = (owner: FocusedOwner) =>
  `${owner.connection_id}\0${owner.connection_generation}`;

/** Cache session stats, not live agent status; all readers share pending stats. */
export class AgentActivityCache {
  private readonly readings = new Map<string, Reading>();
  constructor(
    private readonly deps: {
      clock: Clock;
      active(owner: FocusedOwner): boolean;
      changed(owner: FocusedOwner, entries: AgentActivityEntry[]): void;
    },
  ) {}

  clear(owner: FocusedOwner): void {
    const key = keyOf(owner),
      state = this.readings.get(key);
    if (!state) return;
    state.epoch++;
    state.cached = undefined;
    if (!state.pending) this.readings.delete(key);
  }

  async enrich<T>(
    owner: FocusedOwner,
    raw: T,
    read: () => Promise<unknown>,
    isCurrent: () => boolean,
    force = false,
  ): Promise<T> {
    if (!this.deps.active(owner) || !isCurrent()) return (await read()) as T;
    const key = keyOf(owner);
    let state = this.readings.get(key);
    if (!state) this.readings.set(key, (state = { epoch: 0 }));
    if (
      state.cached &&
      !force &&
      this.deps.clock.monotonic() - state.cached.at <= 5000
    )
      return enrichActivityList(raw, state.cached.entries);
    if (state.pending && state.pending.epoch !== state.epoch) {
      // A previous hold's work must drain before a replacement reading starts.
      await state.pending.promise.catch(() => {});
      return this.enrich(owner, raw, read, isCurrent, force);
    }
    if (!state.pending) {
      const epoch = state.epoch;
      const reading = state;
      const promise = read()
        .then((result) => {
          const entries = activityFromList(result);
          if (
            reading.epoch === epoch &&
            isCurrent() &&
            this.deps.active(owner)
          ) {
            const changed =
              !reading.cached ||
              JSON.stringify(reading.cached.entries) !==
                JSON.stringify(entries);
            reading.cached = { entries, at: this.deps.clock.monotonic() };
            if (changed) this.deps.changed(owner, entries);
          }
          return entries;
        })
        .finally(() => {
          reading.pending = undefined;
          if (!reading.cached && this.readings.get(key) === reading)
            this.readings.delete(key);
        });
      state.pending = { epoch, promise };
    }
    return enrichActivityList(raw, await state.pending.promise);
  }
}
