import { useSyncExternalStore } from "react";
import type { BridgeControlMsg, ConnectionStatus } from "../../api";
import {
  EMPTY_BIN,
  parseBinCountdown,
  type BinEntry,
  type BinOutcome,
  type BinState,
  type BinTarget,
  type BinView,
} from "../../../../shared/bin";

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

export type WorldBinView = BinState & {
  /** The service answered since the socket last connected. */
  verified: boolean;
  error: string | null;
  /** When this state was read, on the page's monotonic clock. */
  readAt: number;
};

const text = (value: unknown) => typeof value === "string" && value.length > 0;

function parseEntry(value: unknown): BinEntry | null {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    !text(v.id) ||
    !text(v.connection_id) ||
    !Number.isSafeInteger(v.connection_generation) ||
    !text(v.workspace_id) ||
    !text(v.tab_id) ||
    !text(v.pane_id) ||
    !text(v.terminal_id) ||
    typeof v.label !== "string" ||
    !Number.isFinite(v.duration_ms) ||
    !Number.isFinite(v.remaining_ms) ||
    !text(v.trip)
  )
    return null;
  return {
    id: v.id as string,
    connection_id: v.connection_id as string,
    connection_generation: v.connection_generation as number,
    workspace_id: v.workspace_id as string,
    tab_id: v.tab_id as string,
    pane_id: v.pane_id as string,
    terminal_id: v.terminal_id as string,
    label: v.label,
    view: (["board", "town", "desk"] as const).includes(v.view as "town")
      ? (v.view as BinView)
      : "other",
    duration_ms: v.duration_ms as number,
    // A service from before the drive away has none.
    departure_ms: Number.isFinite(v.departure_ms)
      ? Math.max(0, v.departure_ms as number)
      : 0,
    remaining_ms: Math.max(0, v.remaining_ms as number),
    trip: v.trip as string,
  };
}

function parseOutcome(value: unknown): BinOutcome | null {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    !text(v.id) ||
    typeof v.label !== "string" ||
    !["closed", "gone", "refused", "uncertain"].includes(v.result as string)
  )
    return null;
  return {
    id: v.id as string,
    label: v.label,
    view: (["board", "town", "desk"] as const).includes(v.view as "town")
      ? (v.view as BinView)
      : "other",
    result: v.result as BinOutcome["result"],
    closed_tab: v.closed_tab === true,
    ...(typeof v.detail === "string" ? { detail: v.detail } : {}),
  };
}

export function parseBinState(value: unknown): BinState | null {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    typeof v.epoch !== "string" ||
    !Number.isSafeInteger(v.revision) ||
    !Array.isArray(v.entries)
  )
    return null;
  return {
    epoch: v.epoch,
    revision: v.revision as number,
    paused: v.paused === true,
    entries: v.entries.map(parseEntry).filter((e): e is BinEntry => e !== null),
    closing: Array.isArray(v.closing)
      ? v.closing.filter((id): id is string => text(id))
      : [],
    outcomes: Array.isArray(v.outcomes)
      ? v.outcomes.map(parseOutcome).filter((o): o is BinOutcome => o !== null)
      : [],
    countdown_s: parseBinCountdown(v.countdown_s),
  };
}

export type BinDrop = BinTarget & {
  label: string;
  view: BinView;
  join?: string;
};

/**
 * The browser's view of the service-held bin. A new service run (epoch)
 * replaces the state whatever its revision; within a run, an older revision
 * never replaces a newer one. Outcomes are announced once each.
 */
export class WorldBinStore {
  private state: WorldBinView = {
    ...EMPTY_BIN,
    verified: false,
    error: null,
    readAt: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly outcomeListeners = new Set<(o: BinOutcome) => void>();
  private seen = new Set<string>();
  private loaded = false;
  private unlisten: (() => void)[] = [];

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
  /** Each close's result, once, as it arrives (not those already shown at load). */
  onOutcome(listener: (outcome: BinOutcome) => void) {
    this.outcomeListeners.add(listener);
    return () => {
      this.outcomeListeners.delete(listener);
    };
  }

  start() {
    if (this.unlisten.length) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (
          control.type === "world_bin_changed" &&
          control.revision !== this.state.revision
        )
          void this.refresh();
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
    for (const off of this.unlisten.splice(0)) off();
  }

  /** Time left for an entry now, from the state's read time. */
  remaining(entry: BinEntry, at = this.now()) {
    return this.state.paused
      ? entry.remaining_ms
      : Math.max(0, entry.remaining_ms - (at - this.state.readAt));
  }

  async refresh() {
    try {
      this.accept(await this.client.call("world.bin.list"));
    } catch {
      // A failed read changes nothing shown unless the bin was live: the
      // next connection reads it again.
      if (this.state.verified) this.set({ ...this.state, verified: false });
    }
  }

  add(drop: BinDrop) {
    return this.mutate("world.bin.add", drop);
  }
  restore(id: string) {
    return this.mutate("world.bin.restore", { id });
  }
  /**
   * Close now exactly these entries, as this page shows them: their IDs name
   * the service run, which refuses another run's (no unscoped "all").
   */
  closeNow(ids: readonly string[]) {
    return this.mutate("world.bin.close_now", { ids: [...ids] });
  }
  pause() {
    return this.mutate("world.bin.pause");
  }
  resume() {
    return this.mutate("world.bin.resume");
  }
  setCountdown(seconds: number) {
    return this.mutate("world.bin.countdown.set", { countdown_s: seconds });
  }

  /** Resolves with the accepted state, or throws the service's refusal. */
  private async mutate(method: string, params?: object) {
    try {
      const next = this.accept(
        await this.client.call(method, params as Record<string, unknown>),
      );
      return next;
    } catch (error) {
      this.set({
        ...this.state,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** Take a service state if it is newer; returns what the store now holds. */
  accept(value: unknown): WorldBinView {
    const next = parseBinState(value);
    if (!next) return this.state;
    const newRun = next.epoch !== this.state.epoch;
    if (!newRun && next.revision < this.state.revision) return this.state;
    if (newRun) this.seen = new Set();
    const fresh = next.outcomes.filter((o) => !this.seen.has(o.id));
    for (const o of next.outcomes) this.seen.add(o.id);
    // Only a page that was already showing the bin announces: a first load
    // shows earlier results without replaying their sounds.
    const announce = this.loaded ? fresh : [];
    this.loaded = true;
    this.set({ ...next, verified: true, error: null, readAt: this.now() });
    for (const outcome of announce)
      for (const listener of this.outcomeListeners) listener(outcome);
    return this.state;
  }

  private set(state: WorldBinView) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

let shared: WorldBinStore | null = null;
/** The page's one bin store, started on first use. */
export function worldBinStore(client?: Client): WorldBinStore {
  if (!shared) {
    if (!client) throw new Error("The bin store needs a client first");
    shared = new WorldBinStore(client);
    shared.start();
  }
  return shared;
}

export function useWorldBin(store: WorldBinStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
