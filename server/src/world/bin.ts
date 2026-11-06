import {
  BIN_BUS_INTERVAL_MS,
  BIN_BUS_DRIVE_MS,
  parseBinCountdown,
  type BinCountdown,
  type BinEntry,
  type BinOutcome,
  type BinState,
  type BinTarget,
  type BinView,
} from "../../../shared/bin";
import type { Clock, Scheduler } from "../service/ports";

const MAX_ENTRIES = 64;
const MAX_OUTCOMES = 12;
const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 100;
/** The close's intent is known not to be in storage: nothing will be sent. */
export class BinCloseNotRecorded extends Error {}
export const NOT_RECORDED =
  "World could not record the close, so nothing was sent.";

/** A later agent joins a departure only if it still has this long to go. */
export const MIN_JOIN_MS = 3_000;

type Staged = BinEntry & {
  /** Monotonic ms when it closes; null while the bin is paused. */
  deadline: number | null;
};

export type BinAdd = BinTarget & {
  label: string;
  view: BinView;
  /** Share this entry's departure (Town: one bus collects everyone at the stop). */
  join?: string;
};

/**
 * Records the durable close intents for entries whose countdown ended. It
 * resolves once they are committed; a rejection means nothing was recorded,
 * so nothing will be sent.
 */
export type BinCommit = (entries: readonly BinEntry[]) => Promise<void>;

/**
 * The service's bin: reversible staging in memory. Each agent's countdown runs
 * on the service clock, so a reload keeps it; a service restart loses it, so
 * nothing is closed. Nothing reaches Herdr from here: when a countdown ends,
 * or on Close now, the entry is handed to `commit`, which records one durable
 * close intent per entry for the effect runner. The runner reports back
 * through `settle`.
 */
export class WorldBinRegistry {
  private revision = 0;
  private paused = false;
  private readonly entries = new Map<string, Staged>();
  private readonly closing = new Map<string, BinEntry>();
  private outcomes: BinOutcome[] = [];
  private timer: { cancel(): void } | null = null;
  private nextId = 1;
  private busAt = 0;
  private busOrigin = 0;
  private busCycle = 0;
  private driving = false;

  constructor(
    private readonly deps: {
      /** The service incarnation: entry IDs carry it. */
      epoch: string;
      /** Production uses a periodic bus; legacy countdown callers remain supported. */
      scheduled?: boolean;
      clock: Clock;
      scheduler: Scheduler;
      commit: BinCommit;
      countdown(): BinCountdown;
      publish(revision: number): void;
      log?(message: string): void;
    },
  ) {
    if (deps.scheduled) {
      this.busOrigin = deps.clock.monotonic();
      this.busAt = this.busOrigin + BIN_BUS_INTERVAL_MS;
      this.schedule();
    }
  }

  list(): BinState {
    const now = this.deps.clock.monotonic();
    return {
      epoch: this.deps.epoch,
      ...(this.deps.scheduled
        ? {
            bus: {
              cycle: this.busCycle,
              driving: this.driving,
              remaining_ms: Math.max(0, this.busAt - now),
              elapsed_ms: this.driving
                ? Math.min(
                    BIN_BUS_DRIVE_MS,
                    BIN_BUS_DRIVE_MS - (this.busAt - now),
                  )
                : 0,
            },
          }
        : {}),
      revision: this.revision,
      paused: this.paused,
      entries: [...this.entries.values()].map(({ deadline, ...entry }) => ({
        ...entry,
        remaining_ms:
          deadline === null ? entry.remaining_ms : Math.max(0, deadline - now),
      })),
      closing: [...this.closing.keys()],
      closing_entries: [...this.closing.values()],
      outcomes: [...this.outcomes],
      countdown_s: parseBinCountdown(this.deps.countdown()),
    };
  }

  /** Whether this run owns the entry (its close may still report back). */
  owns(id: string) {
    return this.entries.has(id) || this.closing.has(id);
  }

  /** Put an agent in the bin; an agent already in it keeps its countdown. */
  add(input: BinAdd): BinState {
    const target = normalize(input);
    const same = [...this.entries.values(), ...this.closing.values()].some(
      (entry) =>
        entry.connection_id === target.connection_id &&
        entry.connection_generation === target.connection_generation &&
        entry.pane_id === target.pane_id,
    );
    if (same) return this.list();
    if (this.entries.size >= MAX_ENTRIES)
      throw new Error(`The bin holds at most ${MAX_ENTRIES} agents`);
    const now = this.deps.clock.monotonic();
    if (this.deps.scheduled) {
      const id = `bin-${this.deps.epoch}-${this.nextId++}`;
      this.entries.set(id, {
        ...target,
        id,
        boarded: false,
        trip: "scheduled",
        duration_ms: BIN_BUS_INTERVAL_MS,
        remaining_ms: 0,
        deadline: null,
      });
      this.changed();
      return this.list();
    }
    const joined =
      typeof input.join === "string" ? this.entries.get(input.join) : undefined;
    const joinedLeft = joined
      ? joined.deadline === null
        ? joined.remaining_ms
        : joined.deadline - now
      : 0;
    const joins = joined !== undefined && joinedLeft >= MIN_JOIN_MS;
    const duration = parseBinCountdown(this.deps.countdown()) * 1000;
    const id = `bin-${this.deps.epoch}-${this.nextId++}`;
    const remaining = joins ? joinedLeft : duration;
    this.entries.set(id, {
      ...target,
      id,
      trip: joins ? joined.trip : id,
      duration_ms: joins ? joined.duration_ms : duration,
      remaining_ms: remaining,
      deadline: this.paused ? null : now + remaining,
    });
    this.changed();
    return this.list();
  }

  pause(): BinState {
    if (this.deps.scheduled) return this.list();
    if (this.paused) return this.list();
    const now = this.deps.clock.monotonic();
    for (const entry of this.entries.values()) {
      entry.remaining_ms = Math.max(0, (entry.deadline ?? now) - now);
      entry.deadline = null;
    }
    this.paused = true;
    this.changed();
    return this.list();
  }

  resume(): BinState {
    if (!this.paused) return this.list();
    const now = this.deps.clock.monotonic();
    for (const entry of this.entries.values())
      entry.deadline = now + entry.remaining_ms;
    this.paused = false;
    this.changed();
    return this.list();
  }

  /** Take an agent back out; nothing is closed. */
  restore(id: string): BinState {
    if (this.entries.get(id)?.boarded) return this.list();
    if (!this.entries.delete(id)) return this.list();
    this.emptied();
    this.changed();
    return this.list();
  }

  /**
   * Close now, without waiting: exactly the entries named, as the caller saw
   * them. Every ID must belong to this service run, so a page still showing
   * an earlier run's bin can never close agents staged since.
   */
  closeNow(ids: readonly string[]): BinState {
    const run = `bin-${this.deps.epoch}-`;
    if (!ids.length || ids.some((id) => !id.startsWith(run)))
      throw new Error("The bin changed since it was shown; nothing was closed");
    const named = new Set(ids);
    const due = [...this.entries.values()].filter((entry) =>
      named.has(entry.id),
    );
    if (!due.length) return this.list();
    this.depart(due);
    return this.list();
  }

  /** A connection's new runtime retires the old one's staged entries; none is closed. */
  retireConnectionGeneration(connectionId: string, generation: number) {
    let changed = false;
    for (const [id, entry] of this.entries)
      if (
        entry.connection_id === connectionId &&
        entry.connection_generation !== generation
      ) {
        this.entries.delete(id);
        this.record({
          id,
          label: entry.label,
          view: entry.view,
          result: "gone",
          closed_tab: false,
          detail: "Its host restarted, so it was not closed.",
        });
        changed = true;
      }
    if (!changed) return;
    this.emptied();
    this.changed();
  }

  /** The durable close finished (or will never be sent). */
  settle(id: string, outcome: Omit<BinOutcome, "id" | "label" | "view">) {
    const entry = this.closing.get(id);
    this.closing.delete(id);
    this.record({
      id,
      label: entry?.label ?? "Agent",
      view: entry?.view ?? "other",
      ...outcome,
    });
    this.revision += 1;
    this.deps.publish(this.revision);
  }

  /** Something the state shows changed outside the entries (the setting). */
  touch() {
    this.revision += 1;
    this.deps.publish(this.revision);
  }

  dispose() {
    this.timer?.cancel();
    this.timer = null;
  }

  private emptied() {
    if (!this.entries.size) this.paused = false;
  }

  private changed() {
    this.revision += 1;
    this.schedule();
    this.deps.publish(this.revision);
  }

  private schedule() {
    this.timer?.cancel();
    this.timer = null;
    if (this.deps.scheduled) {
      this.timer = this.deps.scheduler.schedule(
        () => {
          this.timer = null;
          this.runBus();
        },
        Math.max(0, this.busAt - this.deps.clock.monotonic()),
      );
      return;
    }
    if (this.paused) return;
    let next = Infinity;
    for (const entry of this.entries.values())
      if (entry.deadline !== null) next = Math.min(next, entry.deadline);
    if (next === Infinity) return;
    this.timer = this.deps.scheduler.schedule(
      () => {
        this.timer = null;
        this.expire();
      },
      Math.max(0, next - this.deps.clock.monotonic()),
    );
  }

  private runBus() {
    const now = this.deps.clock.monotonic();
    if (now < this.busAt) return this.schedule();
    if (!this.driving) {
      this.driving = true;
      this.busCycle += 1;
      for (const entry of this.entries.values()) entry.boarded = true;
      // A delayed wake still gives this bus its full drive off the map.
      this.busAt = now + BIN_BUS_DRIVE_MS;
      this.changed();
    } else {
      this.driving = false;
      this.busAt =
        this.busOrigin +
        (Math.floor((now - this.busOrigin) / BIN_BUS_INTERVAL_MS) + 1) *
          BIN_BUS_INTERVAL_MS;
      const riders = [...this.entries.values()].filter(
        (entry) => entry.boarded,
      );
      if (riders.length) this.depart(riders);
      else this.changed();
    }
  }

  private expire() {
    if (this.paused) return;
    const now = this.deps.clock.monotonic();
    const due = [...this.entries.values()].filter(
      (entry) => entry.deadline !== null && entry.deadline <= now,
    );
    if (!due.length) return this.schedule();
    this.depart(due);
  }

  /** The countdown is over: from here on, only the durable intent decides. */
  private depart(due: Staged[]) {
    const leaving = due.map((staged): BinEntry => {
      const entry: Partial<Staged> = { ...staged, remaining_ms: 0 };
      delete entry.deadline;
      return entry as BinEntry;
    });
    for (const entry of leaving) {
      this.entries.delete(entry.id);
      this.closing.set(entry.id, entry);
    }
    this.emptied();
    this.changed();
    this.deps.commit(leaving).catch((error: unknown) => {
      // Only a write storage refused before sending is known not to be
      // recorded; anything else may have committed and stays closing.
      if (!(error instanceof BinCloseNotRecorded)) {
        this.deps.log?.(`Bin close outcome unknown: ${String(error)}`);
        return;
      }
      this.deps.log?.(`Bin close was not recorded: ${String(error)}`);
      for (const entry of leaving)
        if (this.closing.has(entry.id))
          this.settle(entry.id, {
            result: "refused",
            closed_tab: false,
            detail: NOT_RECORDED,
          });
    });
  }

  private record(outcome: BinOutcome) {
    this.outcomes = [...this.outcomes, outcome].slice(-MAX_OUTCOMES);
  }
}

function normalize(
  input: BinAdd,
): Omit<Staged, "id" | "duration_ms" | "remaining_ms" | "deadline" | "trip"> {
  for (const key of [
    "connection_id",
    "workspace_id",
    "tab_id",
    "pane_id",
    "terminal_id",
  ] as const) {
    const value = input[key];
    if (typeof value !== "string" || !value || value.length > MAX_ID_LENGTH)
      throw new Error("invalid bin target");
  }
  if (
    !Number.isSafeInteger(input.connection_generation) ||
    input.connection_generation < 0
  )
    throw new Error("invalid bin target");
  const label =
    typeof input.label === "string"
      ? [...input.label.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").trim()]
          .slice(0, MAX_LABEL_LENGTH)
          .join("")
      : "";
  return {
    connection_id: input.connection_id,
    connection_generation: input.connection_generation,
    workspace_id: input.workspace_id,
    tab_id: input.tab_id,
    pane_id: input.pane_id,
    terminal_id: input.terminal_id,
    ...(input.preserve_tab === true ? { preserve_tab: true } : {}),
    label: label || "Agent",
    view: (["town", "board", "desk"] as const).includes(
      input.view as "town" | "board" | "desk",
    )
      ? input.view
      : "other",
  };
}
