import type { BridgeControlMsg, ConnectionStatus } from "../../api";
import {
  EMPTY_BIN,
  type BinEntry,
  type BinOutcome,
  type BinState,
  type BinTarget,
  type BinView,
} from "../../../../shared/bin";
import type { WorldLeafObject } from "../worldObject";

/** The service's bin as this page last read it. */
export type WorldBin = BinState & {
  /** `performance.now()` when it was read: the bus's clock runs from here. */
  readAt: number;
  verified: boolean;
};

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function entryOf(value: unknown): BinEntry | null {
  if (!record(value)) return null;
  const { connection_generation: generation } = value;
  if (
    !text(value.id) ||
    !text(value.connection_id) ||
    !Number.isSafeInteger(generation) ||
    !text(value.workspace_id) ||
    !text(value.tab_id) ||
    !text(value.pane_id) ||
    !text(value.terminal_id)
  )
    return null;
  return {
    id: value.id,
    connection_id: value.connection_id,
    connection_generation: generation as number,
    workspace_id: value.workspace_id,
    tab_id: value.tab_id,
    pane_id: value.pane_id,
    terminal_id: value.terminal_id,
    label: typeof value.label === "string" ? value.label : "Agent",
    view: (["town", "board", "desk"].includes(value.view as string)
      ? value.view
      : "other") as BinView,
    riding: value.riding === true,
    preserve_tab: value.preserve_tab === true,
  };
}

const RESULTS = new Set(["closed", "gone", "refused", "uncertain"]);

/** A service reply, or null when it is not a bin state. */
export function parseBinState(value: unknown): BinState | null {
  if (!record(value) || typeof value.epoch !== "string") return null;
  const bus = value.bus;
  if (
    !Number.isSafeInteger(value.revision) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.closing) ||
    !record(bus) ||
    !count(bus.interval_ms) ||
    !count(bus.trip_ms) ||
    !count(bus.next_ms) ||
    !(bus.elapsed_ms === null || count(bus.elapsed_ms))
  )
    return null;
  const entries = (list: unknown[]) =>
    list.map(entryOf).filter((entry): entry is BinEntry => entry !== null);
  return {
    epoch: value.epoch,
    revision: value.revision as number,
    entries: entries(value.entries),
    closing: entries(value.closing),
    outcomes: (Array.isArray(value.outcomes) ? value.outcomes : []).filter(
      (outcome): outcome is BinOutcome =>
        record(outcome) &&
        text(outcome.id) &&
        typeof outcome.label === "string" &&
        RESULTS.has(outcome.result as string),
    ),
    bus: {
      interval_ms: bus.interval_ms,
      trip_ms: bus.trip_ms,
      next_ms: bus.next_ms,
      elapsed_ms: bus.elapsed_ms as number | null,
    },
  };
}

/** Where the bus is `now` (performance.now()), from the state as read. */
export function binBusClock(bin: WorldBin, now: number) {
  const since = Math.max(0, now - bin.readAt);
  const { interval_ms, trip_ms, next_ms, elapsed_ms } = bin.bus;
  const elapsed = elapsed_ms === null ? null : elapsed_ms + since;
  return {
    /** How far into its trip the bus on the map is, or null. */
    elapsed: elapsed !== null && elapsed < trip_ms ? elapsed : null,
    /** Until the next bus sets off (the schedule repeats). */
    next: interval_ms
      ? (((next_ms - since) % interval_ms) + interval_ms) % interval_ms ||
        interval_ms
      : 0,
  };
}

/** "2:05" */
export const binClockLabel = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export type BinAddRequest = BinTarget & {
  label: string;
  view: BinView;
  preserve_tab: boolean;
};

/**
 * The request to hold `leaf`. Its tab keeps its last pane when its desk is
 * pinned in Town or its tab is pinned in Spaces (`pinnedTabs`, the tab pins
 * of the leaf's connection).
 */
export function binAddRequest(
  leaf: WorldLeafObject,
  view: BinView,
  pinnedDesk: boolean,
  pinnedTabs: ReadonlySet<string>,
): BinAddRequest {
  return {
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    workspace_id: leaf.workspaceId,
    tab_id: leaf.tabId,
    pane_id: leaf.nativeId,
    terminal_id: leaf.terminalId,
    label: leaf.label,
    view,
    preserve_tab: pinnedDesk || pinnedTabs.has(leaf.tabId),
  };
}

/**
 * The bin as every view shows it: refreshed on the service's revision
 * notices and on reconnect. Actions return the service's error text, or null.
 */
export class WorldBinStore {
  private state: WorldBin = { ...EMPTY_BIN, readAt: 0, verified: false };
  private listeners = new Set<() => void>();
  private users = 0;
  private generation = 0;
  private unlisten: (() => void)[] = [];
  /** When this page first saw each entry, so a remount does not replay its walk. */
  private seen = new Map<string, number>();

  constructor(
    private readonly client: Client,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** When this page first saw the entry, by its clock. */
  firstSeen = (id: string) => this.seen.get(id) ?? this.now();

  /** Counted: the last user to stop ends the subscription. */
  start() {
    this.users += 1;
    if (this.users > 1) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (control.type === "world_bin_changed") void this.refresh();
      }),
      this.client.onStatus((status) => {
        if (status === "connected") void this.refresh();
        if (status === "disconnected")
          this.set({ ...this.state, verified: false });
      }),
    ];
    void this.refresh();
  }

  stop() {
    this.users = Math.max(0, this.users - 1);
    if (this.users) return;
    this.generation += 1;
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }

  async refresh() {
    const generation = this.generation;
    try {
      const next = parseBinState(await this.client.call("world.bin.list"));
      if (next && generation === this.generation) this.accept(next);
    } catch {
      if (generation === this.generation)
        this.set({ ...this.state, verified: false });
    }
  }

  add(request: BinAddRequest) {
    return this.act("world.bin.add", { ...request });
  }
  restore(id: string) {
    return this.act("world.bin.restore", { id });
  }
  closeNow(ids: readonly string[]) {
    return this.act("world.bin.close_now", { ids: [...ids] });
  }

  private async act(method: string, params: Record<string, unknown>) {
    try {
      const next = parseBinState(await this.client.call(method, params));
      if (next) this.accept(next);
      else await this.refresh();
      return null;
    } catch (error) {
      void this.refresh();
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** A newer revision, or any revision of another service run. */
  private accept(next: BinState) {
    if (
      next.epoch === this.state.epoch &&
      this.state.verified &&
      next.revision < this.state.revision
    )
      return;
    const now = this.now();
    const live = new Set([...next.entries, ...next.closing].map((e) => e.id));
    for (const id of live) if (!this.seen.has(id)) this.seen.set(id, now);
    for (const id of this.seen.keys()) if (!live.has(id)) this.seen.delete(id);
    this.set({ ...next, readAt: now, verified: true });
  }

  private set(state: WorldBin) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
