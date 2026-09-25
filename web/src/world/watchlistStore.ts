import { useSyncExternalStore } from "react";
import type { BridgeControlMsg, ConnectionStatus } from "../api";

export type WorldWatch = {
  connectionId: string;
  generation: number;
  terminalId: string;
  label: string;
};

export type WorldWatchlistState = {
  revision: number;
  records: readonly WorldWatch[];
  verified: boolean;
  error: string | null;
};

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const EMPTY: WorldWatchlistState = {
  revision: 0,
  records: [],
  verified: false,
  error: null,
};

function parse(
  value: unknown,
): { revision: number; records: WorldWatch[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(input.revision) ||
    (input.revision as number) < 0 ||
    !Array.isArray(input.records)
  )
    return null;
  const records: WorldWatch[] = [];
  const seen = new Set<string>();
  for (const candidate of input.records) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.connection_id !== "string" ||
      !item.connection_id ||
      !Number.isSafeInteger(item.connection_generation) ||
      (item.connection_generation as number) < 0 ||
      typeof item.terminal_id !== "string" ||
      !item.terminal_id ||
      typeof item.label !== "string"
    )
      continue;
    const watch = {
      connectionId: item.connection_id,
      generation: item.connection_generation as number,
      terminalId: item.terminal_id,
      label: item.label,
    };
    const key = JSON.stringify([
      watch.connectionId,
      watch.generation,
      watch.terminalId,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(watch);
  }
  return { revision: input.revision as number, records };
}

export class WorldWatchlistStore {
  private state = EMPTY;
  private listeners = new Set<() => void>();
  private epoch = 0;
  private unlistenControl: (() => void) | null = null;
  private unlistenStatus: (() => void) | null = null;

  constructor(private readonly client: Client) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  start() {
    if (this.unlistenControl) return;
    this.unlistenControl = this.client.onControl((control) => {
      if (control.type === "world_watchlist_changed") void this.refresh();
    });
    this.unlistenStatus = this.client.onStatus((status) => {
      if (status === "connected") {
        this.epoch += 1;
        void this.refresh(true);
      }
      if (status === "disconnected")
        this.set({ ...this.state, verified: false });
    });
  }
  stop() {
    this.epoch += 1;
    this.unlistenControl?.();
    this.unlistenStatus?.();
    this.unlistenControl = null;
    this.unlistenStatus = null;
  }
  async refresh(resetRevision = false) {
    const epoch = this.epoch;
    try {
      const next = parse(await this.client.call("world.watchlist.list"));
      if (
        !next ||
        epoch !== this.epoch ||
        (!resetRevision && next.revision < this.state.revision)
      )
        return;
      this.set({ ...next, verified: true, error: null });
    } catch (error) {
      if (epoch === this.epoch)
        this.set({
          ...this.state,
          verified: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  async mutate(
    method: "world.watchlist.pin" | "world.watchlist.unpin",
    watch: WorldWatch,
  ) {
    if (!this.state.verified) {
      this.set({
        ...this.state,
        error: "World watchlist is disconnected",
      });
      return false;
    }
    try {
      const result = parse(
        await this.client.call(method, {
          connection_id: watch.connectionId,
          connection_generation: watch.generation,
          terminal_id: watch.terminalId,
          label: watch.label,
        }),
      );
      if (result) {
        this.set({ ...result, verified: true, error: null });
        return true;
      }
      await this.refresh();
      return this.state.verified && !this.state.error;
    } catch (error) {
      this.set({
        ...this.state,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  private set(state: WorldWatchlistState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

export function useWorldWatchlist(store: WorldWatchlistStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
