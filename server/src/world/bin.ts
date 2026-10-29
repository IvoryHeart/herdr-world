import type {
  BinEntry,
  BinOutcome,
  BinState,
  BinTarget,
  BinView,
} from "../../../shared/bin";

const MAX_ENTRIES = 64;
const MAX_OUTCOMES = 12;
const MAX_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 100;
/** A later agent joins a bus only if it still has this long to go. */
export const MIN_JOIN_MS = 3_000;

type Pending = Omit<BinEntry, "remaining_ms"> & {
  /** Epoch ms when it closes; null while the bin is paused. */
  deadline: number | null;
  remaining_ms: number;
};

export type BinAdd = BinTarget & {
  label: string;
  view: BinView;
  /** Share this entry's deadline (Town: one bus collects everyone at the stop). */
  join?: string;
};

export type BinClock = {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

export type BinClose = (
  entry: BinEntry,
) => Promise<Omit<BinOutcome, "id" | "label" | "view">>;

const realClock: BinClock = {
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/**
 * The service's bin. It holds each agent's countdown in memory, so a reload
 * keeps it and a service restart cancels it (nothing is closed). One timer
 * waits for the earliest deadline; the close itself is `close`.
 */
export class WorldBinRegistry {
  /** Names this service run; entry IDs carry it, so no stale ID names a later agent. */
  private readonly epoch = crypto.randomUUID().slice(0, 8);
  private revision = 0;
  private paused = false;
  private entries = new Map<string, Pending>();
  private outcomes: BinOutcome[] = [];
  private timer: unknown = null;
  private nextId = 1;
  /** Closes run one at a time, so each reads the panes the previous close left. */
  private closing: Promise<void> = Promise.resolve();

  constructor(
    private readonly close: BinClose,
    private readonly publish: (revision: number) => void,
    private readonly clock: BinClock = realClock,
  ) {}

  list(): BinState {
    const now = this.clock.now();
    return {
      epoch: this.epoch,
      revision: this.revision,
      paused: this.paused,
      entries: [...this.entries.values()].map(({ deadline, ...entry }) => ({
        ...entry,
        remaining_ms:
          deadline === null ? entry.remaining_ms : Math.max(0, deadline - now),
      })),
      outcomes: [...this.outcomes],
    };
  }

  /** Put an agent in the bin; an agent already in it keeps its timer. */
  add(input: BinAdd, durationMs: number): BinState {
    const target = normalize(input);
    const same = [...this.entries.values()].find(
      (entry) =>
        entry.connection_id === target.connection_id &&
        entry.connection_generation === target.connection_generation &&
        entry.pane_id === target.pane_id,
    );
    if (same) return this.list();
    if (this.entries.size >= MAX_ENTRIES)
      throw new Error(`The bin holds at most ${MAX_ENTRIES} agents`);
    const now = this.clock.now();
    const joined =
      typeof input.join === "string" ? this.entries.get(input.join) : undefined;
    const joinedLeft = joined
      ? joined.deadline === null
        ? joined.remaining_ms
        : joined.deadline - now
      : 0;
    const remaining =
      joined && joinedLeft >= MIN_JOIN_MS ? joinedLeft : durationMs;
    const id = `bin-${this.epoch}-${this.nextId++}`;
    this.entries.set(id, {
      ...target,
      id,
      duration_ms:
        joined && joinedLeft >= MIN_JOIN_MS ? joined.duration_ms : durationMs,
      remaining_ms: remaining,
      deadline: this.paused ? null : now + remaining,
    });
    this.changed();
    return this.list();
  }

  pause(): BinState {
    if (this.paused) return this.list();
    const now = this.clock.now();
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
    const now = this.clock.now();
    for (const entry of this.entries.values())
      entry.deadline = now + entry.remaining_ms;
    this.paused = false;
    this.changed();
    return this.list();
  }

  /** Take an agent back out; nothing is closed. */
  restore(id: string): BinState {
    if (!this.entries.delete(id)) return this.list();
    if (!this.entries.size) this.paused = false;
    this.changed();
    return this.list();
  }

  /** Close now, without waiting: one entry, or every entry with "all". */
  closeNow(id: string): BinState {
    const due =
      id === "all"
        ? [...this.entries.values()]
        : [this.entries.get(id)].filter((entry): entry is Pending => !!entry);
    if (!due.length) return this.list();
    for (const entry of due) this.entries.delete(entry.id);
    if (!this.entries.size) this.paused = false;
    this.changed();
    for (const entry of due) this.queue(entry);
    return this.list();
  }

  /** A connection's new runtime retires the old one's entries without closing them. */
  retireConnectionGeneration(connectionId: string, generation: number) {
    let changed = false;
    for (const [id, entry] of this.entries) {
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
    }
    if (!changed) return;
    if (!this.entries.size) this.paused = false;
    this.changed();
  }

  dispose() {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
  }

  private changed() {
    this.revision += 1;
    this.schedule();
    this.publish(this.revision);
  }

  private schedule() {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    if (this.paused) return;
    let next = Infinity;
    for (const entry of this.entries.values())
      if (entry.deadline !== null) next = Math.min(next, entry.deadline);
    if (next === Infinity) return;
    this.timer = this.clock.setTimer(
      () => {
        this.timer = null;
        this.expire();
      },
      Math.max(0, next - this.clock.now()),
    );
  }

  private expire() {
    if (this.paused) return;
    const now = this.clock.now();
    const due = [...this.entries.values()].filter(
      (entry) => entry.deadline !== null && entry.deadline <= now,
    );
    if (!due.length) return this.schedule();
    for (const entry of due) this.entries.delete(entry.id);
    this.changed();
    for (const entry of due) this.queue(entry);
  }

  /**
   * Two panes of one workspace closing together must not both see two panes
   * and both send pane.close: the second is the workspace's last pane.
   */
  private queue(entry: Pending) {
    // run records its own failures; nothing may stop later closes.
    this.closing = this.closing.then(() => this.run(entry)).catch(() => {});
  }

  /** Settles once every queued close has finished (tests). */
  settled() {
    return this.closing;
  }

  private async run(entry: Pending) {
    let outcome: Omit<BinOutcome, "id" | "label" | "view">;
    try {
      outcome = await this.close({ ...entry, remaining_ms: 0 });
    } catch (error) {
      outcome = {
        result: "failed",
        closed_tab: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    this.record({
      id: entry.id,
      label: entry.label,
      view: entry.view,
      ...outcome,
    });
    this.revision += 1;
    this.publish(this.revision);
  }

  private record(outcome: BinOutcome) {
    this.outcomes = [...this.outcomes, outcome].slice(-MAX_OUTCOMES);
  }
}

function normalize(
  input: BinAdd,
): Omit<Pending, "id" | "duration_ms" | "remaining_ms" | "deadline"> {
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
    view:
      input.view === "town" || input.view === "board" ? input.view : "other",
  };
}
