import {
  BIN_DEPARTURE_MS,
  parseBinCountdown,
  type BinCountdown,
  type BinEntry,
  type BinOutcome,
  type BinReservation,
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

type Staged = BinEntry & {
  /** Monotonic ms when it closes; null while the bin is paused. */
  deadline: number | null;
  trip_started: number | null;
};

export type BinAdd = BinTarget & {
  label: string;
  view: BinView;
  /**
   * Board this entry's bus (Town: one bus collects everyone at the stop).
   * Boarding before the bus pulls away restarts the countdown in full for
   * everyone on it; once it has pulled away the agent waits for the next.
   */
  join?: string;
  /** A captured browser pin: native admission must preserve this tab. */
  preserve_tab?: boolean;
};

/**
 * Records the durable close intents for entries whose bus has left. It
 * resolves once they are committed; a rejection means nothing was recorded,
 * so nothing will be sent.
 */
export type BinCommit = (entries: readonly BinEntry[]) => Promise<void>;

/**
 * The service's bin: reversible staging in memory. Each agent's countdown and
 * its bus's drive away run on the service clock, so a reload keeps them; a
 * service restart loses them, so nothing is closed. Nothing reaches Herdr
 * from here: when the drive away ends (the bus has left the map), or on
 * Close now, the entry is handed to `commit`, which records one durable
 * close intent per entry for the effect runner. The runner reports back
 * through `settle`.
 */
export class WorldBinRegistry {
  private revision = 0;
  private paused = false;
  private readonly holders = new Set<object>();
  private manualHold = false;
  private disposed = false;
  private readonly entries = new Map<string, Staged>();
  private readonly closing = new Map<string, BinEntry>();
  private readonly reservations = new Map<string, BinReservation>();
  private outcomes: BinOutcome[] = [];
  private timer: { cancel(): void } | null = null;
  private nextId = 1;

  constructor(
    private readonly deps: {
      /** The service incarnation: entry IDs carry it. */
      epoch: string;
      clock: Clock;
      scheduler: Scheduler;
      commit: BinCommit;
      countdown(): BinCountdown;
      publish(revision: number): void;
      log?(message: string): void;
    },
  ) {}

  list(): BinState {
    const now = this.deps.clock.monotonic();
    return {
      epoch: this.deps.epoch,
      revision: this.revision,
      paused: this.paused,
      entries: [...this.entries.values()].map(
        ({ deadline, trip_started, ...entry }) => ({
          ...entry,
          trip_elapsed_ms:
            (entry.trip_elapsed_ms ?? 0) +
            (trip_started === null ? 0 : Math.max(0, now - trip_started)),
          remaining_ms:
            deadline === null
              ? entry.remaining_ms
              : Math.max(0, deadline - now),
        }),
      ),
      closing: [...this.closing.keys()],
      reservations: [...this.reservations.values()],
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
    if (
      [...this.reservations.values()].some(
        (entry) =>
          entry.connection_id === target.connection_id &&
          entry.connection_generation === target.connection_generation &&
          entry.pane_id === target.pane_id &&
          entry.terminal_id === target.terminal_id,
      )
    )
      throw new Error("That agent's close is still pending or uncertain");
    if (this.reservations.size >= MAX_ENTRIES)
      throw new Error(`The bin holds at most ${MAX_ENTRIES} agents`);
    const now = this.deps.clock.monotonic();
    // Every view drops into the same waiting trip. A caller may name its bus,
    // but joining/resetting is a service rule, never a browser requirement.
    const waiting = [...this.entries.values()]
      .filter(
        (entry) =>
          (entry.deadline === null
            ? entry.remaining_ms
            : entry.deadline - now) > entry.departure_ms,
      )
      .sort(
        (a, b) =>
          (a.deadline ?? a.remaining_ms) - (b.deadline ?? b.remaining_ms),
      );
    const joined =
      waiting.find((entry) => entry.id === input.join) ?? waiting[0];
    const duration = parseBinCountdown(this.deps.countdown()) * 1000;
    const id = `bin-${this.deps.epoch}-${this.nextId++}`;
    const remaining = duration + BIN_DEPARTURE_MS;
    const deadline = this.paused ? null : now + remaining;
    const trip = joined ? joined.trip : id;
    // Boarding restarts the countdown in full for everyone on that bus.
    if (joined)
      for (const entry of this.entries.values())
        if (entry.trip === trip)
          Object.assign(entry, {
            duration_ms: duration,
            departure_ms: BIN_DEPARTURE_MS,
            remaining_ms: remaining,
            deadline,
          });
    this.entries.set(id, {
      ...target,
      id,
      trip,
      duration_ms: duration,
      departure_ms: BIN_DEPARTURE_MS,
      remaining_ms: remaining,
      deadline,
      trip_duration_ms: joined?.trip_duration_ms ?? duration,
      trip_elapsed_ms: joined
        ? (joined.trip_elapsed_ms ?? 0) +
          (joined.trip_started === null
            ? 0
            : Math.max(0, now - joined.trip_started))
        : 0,
      trip_started: this.paused ? null : now,
    });
    this.reservations.set(id, { id, ...target });
    this.changed();
    return this.list();
  }

  pause(owner?: object): BinState {
    if (!this.entries.size) return this.list();
    if (owner) this.holders.add(owner);
    else this.manualHold = true;
    if (this.paused) return this.list();
    const now = this.deps.clock.monotonic();
    for (const entry of this.entries.values()) {
      entry.remaining_ms = Math.max(0, (entry.deadline ?? now) - now);
      entry.deadline = null;
      entry.trip_elapsed_ms =
        (entry.trip_elapsed_ms ?? 0) +
        (entry.trip_started === null
          ? 0
          : Math.max(0, now - entry.trip_started));
      entry.trip_started = null;
    }
    this.paused = true;
    this.changed();
    return this.list();
  }

  resume(): BinState {
    this.holders.clear();
    this.manualHold = false;
    if (!this.paused) return this.list();
    const now = this.deps.clock.monotonic();
    for (const entry of this.entries.values()) {
      entry.deadline = now + entry.remaining_ms;
      entry.trip_started = now;
    }
    this.paused = false;
    this.changed();
    return this.list();
  }

  /** A browser window owns its open tray, not the view it currently renders. */
  release(owner: object): BinState {
    if (!this.holders.delete(owner)) return this.list();
    if (this.disposed) return this.list();
    return !this.holders.size && !this.manualHold ? this.resume() : this.list();
  }

  /** Take an agent back out; nothing is closed. */
  restore(id: string): BinState {
    if (!this.entries.delete(id)) return this.list();
    this.reservations.delete(id);
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
    for (const [id, target] of this.reservations)
      if (
        target.connection_id === connectionId &&
        target.connection_generation !== generation
      ) {
        this.reservations.delete(id);
        changed = true;
      }
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
    if (outcome.result !== "uncertain") this.reservations.delete(id);
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

  /** A fresh native read can retire an uncertain target that no longer exists. */
  observeWorkspace(
    target: BinTarget,
    panes: readonly Record<string, unknown>[],
  ) {
    let changed = false;
    for (const [id, reserved] of this.reservations) {
      if (
        this.entries.has(id) ||
        this.closing.has(id) ||
        reserved.connection_id !== target.connection_id ||
        reserved.connection_generation !== target.connection_generation ||
        reserved.workspace_id !== target.workspace_id
      )
        continue;
      if (
        !panes.some(
          (pane) =>
            pane.pane_id === reserved.pane_id &&
            pane.terminal_id === reserved.terminal_id &&
            pane.tab_id === reserved.tab_id,
        )
      ) {
        this.reservations.delete(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  dispose() {
    this.disposed = true;
    this.timer?.cancel();
    this.timer = null;
  }

  private emptied() {
    if (!this.entries.size) {
      this.paused = false;
      this.holders.clear();
      this.manualHold = false;
    }
  }

  private changed() {
    this.revision += 1;
    this.schedule();
    this.deps.publish(this.revision);
  }

  private schedule() {
    this.timer?.cancel();
    this.timer = null;
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

  private expire() {
    if (this.paused) return;
    const now = this.deps.clock.monotonic();
    const due = [...this.entries.values()].filter(
      (entry) => entry.deadline !== null && entry.deadline <= now,
    );
    if (!due.length) return this.schedule();
    this.depart(due);
  }

  /** The bus has left: from here on, only the durable intent decides. */
  private depart(due: Staged[]) {
    const leaving = due.map((staged): BinEntry => {
      const entry: Partial<Staged> = { ...staged, remaining_ms: 0 };
      delete entry.deadline;
      delete entry.trip_started;
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
): Omit<
  Staged,
  | "id"
  | "duration_ms"
  | "departure_ms"
  | "remaining_ms"
  | "deadline"
  | "trip"
  | "trip_started"
> {
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
    label: label || "Agent",
    view: (["town", "board", "desk"] as const).includes(
      input.view as "town" | "board" | "desk",
    )
      ? input.view
      : "other",
  };
}
