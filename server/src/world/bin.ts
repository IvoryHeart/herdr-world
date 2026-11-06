import {
  BIN_BUS_INTERVAL_MS,
  BIN_BUS_TRIP_MS,
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

export type BinAdd = BinTarget & {
  label: string;
  view: BinView;
  /** Its tab is pinned: never close the tab's last pane. */
  preserve_tab?: boolean;
};

/**
 * Records the durable close intents for the bus's riders. It resolves once
 * they are committed; a rejection means nothing was recorded, so nothing
 * will be sent.
 */
export type BinCommit = (entries: readonly BinEntry[]) => Promise<void>;

/**
 * The service's bin: reversible holding in memory, and one bus on a fixed
 * schedule. Buses set off every `interval` ms from the service's start; one
 * sets off only when someone is waiting, and everyone waiting boards. When
 * its trip ends the riders are handed to `commit`, which records one durable
 * close intent per entry for the effect runner; the runner reports back
 * through `settle`. Until then, Put back takes an entry out, riding or not.
Nothing reaches Herdr from here. A reload keeps this
 * state; a service restart loses it, so nothing held is closed.
 */
export class WorldBinRegistry {
  private revision = 0;
  private readonly entries = new Map<string, BinEntry>();
  private readonly closing = new Map<string, BinEntry>();
  private outcomes: BinOutcome[] = [];
  private timer: { cancel(): void } | null = null;
  private nextId = 1;
  /** The schedule's origin: buses set off at anchor + k·interval. */
  private readonly anchor: number;
  /** When the bus on the map set off, or null when none is out. */
  private trip: number | null = null;
  private readonly interval: number;
  private readonly tripMs: number;

  constructor(
    private readonly deps: {
      /** The service incarnation: entry IDs carry it. */
      epoch: string;
      clock: Clock;
      scheduler: Scheduler;
      commit: BinCommit;
      publish(revision: number): void;
      log?(message: string): void;
      interval_ms?: number;
      trip_ms?: number;
    },
  ) {
    this.anchor = deps.clock.monotonic();
    this.interval = deps.interval_ms ?? BIN_BUS_INTERVAL_MS;
    this.tripMs = Math.min(deps.trip_ms ?? BIN_BUS_TRIP_MS, this.interval);
  }

  list(): BinState {
    const now = this.deps.clock.monotonic();
    return {
      epoch: this.deps.epoch,
      revision: this.revision,
      entries: [...this.entries.values()].map((entry) => ({ ...entry })),
      closing: [...this.closing.values()].map((entry) => ({ ...entry })),
      outcomes: [...this.outcomes],
      bus: {
        interval_ms: this.interval,
        trip_ms: this.tripMs,
        next_ms: this.departure(now) - now,
        elapsed_ms: this.trip === null ? null : now - this.trip,
      },
    };
  }

  /** Whether this run owns the entry (its close may still report back). */
  owns(id: string) {
    return this.entries.has(id) || this.closing.has(id);
  }

  /** Whether this pane, on this runtime, is held or closing. */
  holds(target: Pick<BinTarget, "connection_id" | "connection_generation">) {
    return (paneId: string) =>
      [...this.entries.values(), ...this.closing.values()].some(
        (entry) =>
          entry.connection_id === target.connection_id &&
          entry.connection_generation === target.connection_generation &&
          entry.pane_id === paneId,
      );
  }

  /** Put an agent in the bin; an agent already in it stays as it is. */
  add(input: BinAdd): BinState {
    const target = normalize(input);
    if (this.holds(target)(target.pane_id)) return this.list();
    if (this.entries.size >= MAX_ENTRIES)
      throw new Error(`The bin holds at most ${MAX_ENTRIES} agents`);
    const id = `bin-${this.deps.epoch}-${this.nextId++}`;
    // A bus already on the map has collected its riders: this one waits.
    this.entries.set(id, { ...target, id, riding: false });
    this.changed();
    return this.list();
  }

  /**
   * Take an agent back out; nothing is closed. Where the bus picks it up
   * depends on each browser's Town layout, so the service allows this until
   * the bus has left the map and its close is recorded.
   */
  restore(id: string): BinState {
    if (!this.entries.delete(id)) return this.list();
    this.changed();
    return this.list();
  }

  /**
   * Close now, without waiting for the bus: exactly the entries named, as
   * the caller saw them. Every ID must belong to this service run, so a page
   * still showing an earlier run's bin can never close agents held since.
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

  /** A connection's new runtime retires the old one's held entries; none is closed. */
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
    if (changed) this.changed();
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

  dispose() {
    this.timer?.cancel();
    this.timer = null;
  }

  /** The first scheduled departure after `now`. */
  private departure(now: number) {
    const k = Math.floor((now - this.anchor) / this.interval) + 1;
    return this.anchor + k * this.interval;
  }

  private changed() {
    this.revision += 1;
    this.schedule();
    this.deps.publish(this.revision);
  }

  /** One timer: the bus leaving the map, else the next departure for anyone waiting. */
  private schedule() {
    this.timer?.cancel();
    this.timer = null;
    const now = this.deps.clock.monotonic();
    let at: number;
    let run: () => void;
    if (this.trip !== null) {
      at = this.trip + this.tripMs;
      run = () => this.arrive();
    } else if (this.entries.size) {
      at = this.departure(now);
      run = () => this.setOff(at);
    } else return;
    this.timer = this.deps.scheduler.schedule(
      () => {
        this.timer = null;
        run();
      },
      Math.max(0, at - now),
    );
  }

  /** The bus sets off: everyone waiting boards. */
  private setOff(at: number) {
    if (this.trip !== null || !this.entries.size) return this.schedule();
    this.trip = at;
    for (const entry of this.entries.values()) entry.riding = true;
    this.changed();
  }

  /** The bus has left the map: its riders' closes are recorded. */
  private arrive() {
    this.trip = null;
    const riders = [...this.entries.values()].filter((entry) => entry.riding);
    if (riders.length) this.depart(riders);
    else this.changed();
  }

  /** From here on, only the durable intent decides. */
  private depart(due: BinEntry[]) {
    const leaving = due.map((entry) => ({ ...entry }));
    for (const entry of leaving) {
      this.entries.delete(entry.id);
      this.closing.set(entry.id, entry);
    }
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

function normalize(input: BinAdd): Omit<BinEntry, "id" | "riding"> {
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
    preserve_tab: input.preserve_tab === true,
  };
}
