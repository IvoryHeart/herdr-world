import {
  type BinCoreConfirmation,
  BIN_BUS_BOARDING_MS,
  BIN_BUS_ROUTE_M,
  BIN_BUS_ROUTE_MAX_M,
  BIN_BUS_SPEED_KMH,
  binBusTripMs,
  binRiderKey,
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
 * A Town's measure of the next trip (world.bin.route): the bus's way from
 * Apartments past the stops of exactly the agents `ids` and back, in metres,
 * and how many stops it halts at.
 */
export type BinRouteReport = { ids: string[]; route_m: number; stops: number };

/** @internal */
export const ENDED_BEFORE_BUS =
  "It ended before the bus came, so nothing was closed.";

/**
 * The service's bin: reversible holding in memory, and one bus. It sets off
 * `boarding` ms after the first agent starts waiting, once it is back from
 * any trip, and everyone waiting boards. Its trip lasts as long as its route
 * takes at its speed (binBusTripMs): past all its riders' stops and back,
 * as the first Town to see exactly those riders measured it (route). When its trip ends the
 * riders are handed to `commit`, which records one durable
 * close intent per entry for the effect runner; the runner reports back
 * through `settle`. Until then, Put back takes an entry out, riding or not,
 * and the bus can be stopped (stopBus) so nothing closes until it goes on.
 * Nothing reaches Herdr from here. A reload keeps this
 * state; a service restart loses it, so nothing held is closed.
 */
export class WorldBinRegistry {
  private revision = 0;
  private readonly entries = new Map<string, BinEntry>();
  /** When each held entry was put in the bin (wall clock, ms). */
  private readonly heldAt = new Map<string, number>();
  /** When each held entry started waiting for a bus (monotonic, ms). */
  private readonly waitingSince = new Map<string, number>();
  private readonly closing = new Map<string, BinEntry>();
  private outcomes: BinOutcome[] = [];
  private timer: { cancel(): void } | null = null;
  private nextId = 1;
  /** When the bus on the map set off, or null when none is out. */
  private trip: number | null = null;
  /** The bus on the map's route there and back (m) and its trip's length. */
  private tripRoute = { route_m: 0, trip_ms: 0 };
  /** A Town's measure of the next trip, for the riders `key` (binRiderKey). */
  private measured: { key: string; route_m: number; stops: number } | null =
    null;
  /** When someone stopped the bus on the map, or null while it drives. */
  private stoppedAt: number | null = null;
  private trips = 0;
  private readonly boarding: number;
  private readonly tripMs: (route_m: number, stops: number) => number;

  constructor(
    private readonly deps: {
      /** The service incarnation: entry IDs carry it. */
      epoch: string;
      clock: Clock;
      scheduler: Scheduler;
      commit: BinCommit;
      publish(revision: number): void;
      log?(message: string): void;
      /** The bin's journey, one line per step, for the service journal. */
      info?(message: string): void;
      /** How long the bus waits for riders after the first starts waiting. */
      boarding_ms?: number;
      /** A trip's length for its route (binBusTripMs). */
      trip_ms?: (route_m: number, stops: number) => number;
    },
  ) {
    this.boarding = deps.boarding_ms ?? BIN_BUS_BOARDING_MS;
    this.tripMs = deps.trip_ms ?? binBusTripMs;
  }

  list(): BinState {
    const now = this.deps.clock.monotonic();
    const out = this.trip !== null;
    const at = this.departure();
    const waiting = this.waiting();
    const next = this.nextRoute();
    return {
      epoch: this.deps.epoch,
      revision: this.revision,
      entries: [...this.entries.values()].map((entry) => ({ ...entry })),
      closing: [...this.closing.values()].map((entry) => ({ ...entry })),
      outcomes: [...this.outcomes],
      bus: {
        speed_kmh: BIN_BUS_SPEED_KMH,
        route_m: out ? this.tripRoute.route_m : 0,
        trip_ms: out ? this.tripRoute.trip_ms : 0,
        elapsed_ms:
          this.trip === null ? null : (this.stoppedAt ?? now) - this.trip,
        stopped: this.stoppedAt !== null,
        trip: this.trip === null ? null : this.trips,
        next_ms: at === null ? null : Math.max(0, at - now),
        next_route_m: next.route_m,
        next_trip_ms: waiting.length
          ? this.tripMs(next.route_m, next.stops)
          : 0,
        next_measured: next.measured,
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
    this.heldAt.set(id, this.deps.clock.now());
    this.waitingSince.set(id, this.deps.clock.monotonic());
    this.deps.info?.(
      `Bin holds ${id}: ${target.runtime ?? "herdr"} ${target.connection_id} generation ${target.connection_generation} pane ${target.pane_id} terminal ${target.terminal_id}`,
    );
    this.changed();
    return this.list();
  }

  /**
   * Take an agent back out; nothing is closed. Where the bus picks it up
   * depends on each browser's Town layout, so the service allows this until
   * the bus has left the map and its close is recorded.
   */
  restore(id: string): BinState {
    if (!this.forget(id)) return this.list();
    this.deps.info?.(`Bin put back ${id}`);
    this.resumeIfEmpty();
    this.changed();
    return this.list();
  }

  /**
   * A Town's measure of the next trip: its way past the stops of everyone
   * waiting and back, on that Town's roads. It stands only for exactly the
   * agents it names, while they are the ones waiting: a measure for others
   * (from a page that has yet to see a change) is ignored, and the first
   * measure of those waiting stands, so pages with different layouts never
   * undo each other. A trip's route is fixed once its bus sets off.
   */
  route(report: BinRouteReport): BinState {
    const ids = report?.ids;
    const metres = report?.route_m;
    const stops = report?.stops;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > MAX_ENTRIES ||
      ids.some((id) => typeof id !== "string") ||
      typeof metres !== "number" ||
      !Number.isFinite(metres) ||
      metres < 0 ||
      metres > BIN_BUS_ROUTE_MAX_M ||
      !Number.isSafeInteger(stops) ||
      stops < 1 ||
      stops > ids.length
    )
      throw new Error("invalid bin route");
    const key = binRiderKey(ids);
    const waiting = binRiderKey(this.waiting().map((entry) => entry.id));
    if (key !== waiting || this.measured?.key === key) return this.list();
    this.measured = { key, route_m: Math.round(metres), stops };
    this.changed();
    return this.list();
  }

  /**
   * Stop the bus where it is, so its riders can be put back: nothing closes
   * while it stands. Only a bus on the map stops.
   */
  stopBus(): BinState {
    if (this.trip === null || this.stoppedAt !== null) return this.list();
    this.stoppedAt = this.deps.clock.monotonic();
    this.changed();
    return this.list();
  }

  /** Let a stopped bus drive on from where it stood. */
  goBus(): BinState {
    if (this.stoppedAt === null) return this.list();
    this.resumeTrip();
    this.changed();
    return this.list();
  }

  /**
   * A stopped bus with nobody left aboard has nothing to wait for: however
   * its last rider left (put back, ended by itself, or its host restarted),
   * it drives on, so later agents still board and close.
   */
  private resumeIfEmpty() {
    if (
      this.stoppedAt !== null &&
      ![...this.entries.values()].some((entry) => entry.riding)
    )
      this.resumeTrip();
  }

  private resumeTrip() {
    if (this.trip !== null && this.stoppedAt !== null)
      this.trip += this.deps.clock.monotonic() - this.stoppedAt;
    this.stoppedAt = null;
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
        this.forget(id);
        this.deps.info?.(
          `Bin dropped ${id}: ${connectionId} is now generation ${generation}`,
        );
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
    this.resumeIfEmpty();
    this.changed();
  }

  /**
   * A complete pane list of a connection's runtime, read from `readAt`
   * (wall clock): a held agent, waiting or riding, whose pane and terminal
   * it no longer has has ended by itself. It leaves the bin with nothing
   * closed, instead of waiting invisibly for a bus that would only find it
   * gone. A list read before the agent was held cannot witness its end.
   */
  observeComplete(
    connectionId: string,
    generation: number,
    panes: readonly Record<string, unknown>[],
    readAt: number,
  ) {
    const paneIds = new Set<unknown>(panes.map((pane) => pane.pane_id));
    const terminalIds = new Set<unknown>(panes.map((pane) => pane.terminal_id));
    let changed = false;
    for (const [id, entry] of this.entries) {
      const heldAt = this.heldAt.get(id);
      if (
        entry.connection_id !== connectionId ||
        entry.connection_generation !== generation ||
        heldAt === undefined ||
        readAt <= heldAt ||
        paneIds.has(entry.pane_id) ||
        terminalIds.has(entry.terminal_id)
      )
        continue;
      this.forget(id);
      this.deps.info?.(
        `Bin dropped ${id}: pane ${entry.pane_id} terminal ${entry.terminal_id} ended ${entry.riding ? "on the bus" : "at the stop"}`,
      );
      this.record({
        id,
        label: entry.label,
        view: entry.view,
        result: "gone",
        closed_tab: false,
        detail: ENDED_BEFORE_BUS,
      });
      changed = true;
    }
    if (!changed) return;
    this.resumeIfEmpty();
    this.changed();
  }

  /** The durable close finished (or will never be sent). */
  settle(id: string, outcome: Omit<BinOutcome, "id" | "label" | "view">) {
    const entry = this.closing.get(id);
    this.closing.delete(id);
    this.deps.info?.(
      `Bin close of ${id}: ${outcome.result}${outcome.detail ? ` (${outcome.detail})` : ""}`,
    );
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

  /** Those waiting for a bus: held, and not aboard the one out. */
  private waiting() {
    return [...this.entries.values()].filter((entry) => !entry.riding);
  }

  /**
   * The next trip's route, for those waiting now: a Town's measure of
   * exactly them, else `BIN_BUS_ROUTE_M` with each of them a stop.
   */
  private nextRoute(): { route_m: number; stops: number; measured: boolean } {
    const waiting = this.waiting();
    if (!waiting.length) return { route_m: 0, stops: 0, measured: false };
    const key = binRiderKey(waiting.map((entry) => entry.id));
    if (this.measured?.key === key)
      return {
        route_m: this.measured.route_m,
        stops: this.measured.stops,
        measured: true,
      };
    return { route_m: BIN_BUS_ROUTE_M, stops: waiting.length, measured: false };
  }

  /**
   * When the next bus sets off (monotonic): `boarding` after the first of
   * those waiting started to, and never before the bus out is back. Null
   * when nobody waits, or while the bus out is stopped.
   */
  private departure(): number | null {
    if (this.stoppedAt !== null) return null;
    const since = this.waiting().map(
      (entry) => this.waitingSince.get(entry.id) ?? 0,
    );
    if (!since.length) return null;
    const at = Math.min(...since) + this.boarding;
    return this.trip === null
      ? at
      : Math.max(at, this.trip + this.tripRoute.trip_ms);
  }

  private changed() {
    this.revision += 1;
    this.schedule();
    this.deps.publish(this.revision);
  }

  /**
   * One timer: the bus leaving the map, else the next departure for anyone
   * waiting. A stopped bus holds the schedule: none is due until it goes.
   */
  private schedule() {
    this.timer?.cancel();
    this.timer = null;
    const now = this.deps.clock.monotonic();
    let at: number;
    let run: () => void;
    if (this.stoppedAt !== null) return;
    if (this.trip !== null) {
      at = this.trip + this.tripRoute.trip_ms;
      run = () => this.arrive();
    } else {
      const departure = this.departure();
      if (departure === null) return;
      at = departure;
      run = () => this.setOff();
    }
    this.timer = this.deps.scheduler.schedule(
      () => {
        this.timer = null;
        run();
      },
      Math.max(0, at - now),
    );
  }

  /** The bus sets off: everyone waiting boards, and its route sets its trip. */
  private setOff() {
    if (this.trip !== null || !this.entries.size) return this.schedule();
    const riders = [...this.entries.values()];
    const { route_m, stops } = this.nextRoute();
    this.measured = null;
    this.trip = this.deps.clock.monotonic();
    this.tripRoute = { route_m, trip_ms: this.tripMs(route_m, stops) };
    this.trips += 1;
    for (const entry of riders) entry.riding = true;
    this.deps.info?.(
      `Bin bus ${this.trips} set off with ${riders.length} aboard: ${route_m} m there and back, ${this.tripRoute.trip_ms} ms`,
    );
    this.changed();
  }

  /** The bus has left the map: its riders' closes are recorded. */
  private arrive() {
    if (this.stoppedAt !== null) return;
    this.trip = null;
    const riders = [...this.entries.values()].filter((entry) => entry.riding);
    if (riders.length) this.depart(riders);
    else this.changed();
  }

  /** From here on, only the durable intent decides. */
  private depart(due: BinEntry[]) {
    const leaving = due.map((entry) => ({ ...entry }));
    for (const entry of leaving) {
      this.forget(entry.id);
      this.closing.set(entry.id, entry);
    }
    this.deps.info?.(
      `Bin closing ${leaving.map((entry) => entry.id).join(", ")}`,
    );
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

  /** Take a held entry out of the bin; false when it was not held. */
  private forget(id: string) {
    this.heldAt.delete(id);
    this.waitingSince.delete(id);
    return this.entries.delete(id);
  }

  private record(outcome: BinOutcome) {
    this.outcomes = [...this.outcomes, outcome].slice(-MAX_OUTCOMES);
  }
}

function coreConfirmation(value: unknown): BinCoreConfirmation {
  const input = (value ?? {}) as Record<string, unknown>;
  if (
    typeof input.core_id !== "string" ||
    !input.core_id ||
    input.core_id.length > MAX_ID_LENGTH ||
    !Array.isArray(input.terminals) ||
    input.terminals.length === 0 ||
    input.terminals.length > 256
  )
    throw new Error("invalid bin target");
  return {
    core_id: input.core_id,
    terminals: input.terminals.map((item) => {
      const t = (item ?? {}) as Record<string, unknown>;
      if (typeof t.address !== "string" || t.address.length > MAX_ID_LENGTH)
        throw new Error("invalid bin target");
      if (
        t.occupant !== undefined &&
        t.occupant !== null &&
        (typeof t.occupant !== "string" || t.occupant.length > 128)
      )
        throw new Error("invalid bin target");
      return {
        address: t.address,
        pid: typeof t.pid === "number" ? t.pid : null,
        occupant: typeof t.occupant === "string" ? t.occupant : null,
        ...(t.remote === true ? { remote: true } : {}),
      };
    }),
  };
}

function normalize(
  input: BinAdd,
): Omit<BinEntry, "id" | "riding" | "route_m" | "stop"> {
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
  const core = input.runtime === "herdr-core";
  const confirmation = core ? coreConfirmation(input.confirmation) : null;
  return {
    connection_id: input.connection_id,
    connection_generation: input.connection_generation,
    ...(confirmation ? { runtime: "herdr-core" as const, confirmation } : {}),
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
