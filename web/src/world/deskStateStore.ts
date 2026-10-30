import { useEffect, useSyncExternalStore } from "react";
import { bridge } from "../api";
import {
  parseDeskState,
  type DeskState,
  type DeskIdentity,
} from "../../../shared/deskState";
import type { BridgeControlMsg, ConnectionStatus } from "../api";

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};
export type DeskStoreState = DeskState & {
  verified: boolean;
  error: string | null;
};

/** A socket epoch and a service revision are separate admission boundaries. */
export class WorldDeskStore {
  private state: DeskStoreState = {
    revision: 0,
    records: [],
    verified: false,
    error: null,
  };
  private epoch = 0;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  constructor(private readonly client: Client) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  start() {
    if (this.unlisten.length) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (control.type === "world_desk_changed") void this.refresh();
      }),
      this.client.onStatus((status) => {
        if (status === "disconnected" || status === "connected") {
          this.epoch++;
          this.set(
            status === "connected"
              ? { revision: 0, records: [], verified: false, error: null }
              : { ...this.state, verified: false },
          );
        }
        if (status === "connected") void this.refresh();
      }),
    ];
    void this.refresh();
  }
  stop() {
    this.epoch++;
    for (const unlisten of this.unlisten) unlisten();
    this.unlisten = [];
  }
  async refresh() {
    const epoch = this.epoch;
    try {
      const result = parseDeskState(await this.client.call("world.desk.get"));
      if (!result) throw new Error("Invalid Desk state response");
      if (epoch === this.epoch && result.revision >= this.state.revision)
        this.set({ ...result, verified: true, error: null });
    } catch (error) {
      if (epoch === this.epoch)
        this.set({ ...this.state, verified: false, error: String(error) });
    }
  }
  async mutate(
    method: "world.desk.review" | "world.desk.open",
    identity: DeskIdentity,
    extra: Record<string, unknown> = {},
  ) {
    if (!this.state.verified) return false;
    const epoch = this.epoch;
    try {
      const result = parseDeskState(
        await this.client.call(method, { ...identity, ...extra }),
      );
      if (!result) throw new Error("Invalid Desk state response");
      if (epoch !== this.epoch) return false;
      if (result.revision >= this.state.revision)
        this.set({ ...result, verified: true, error: null });
      return true;
    } catch (error) {
      if (epoch === this.epoch)
        this.set({ ...this.state, error: String(error) });
      return false;
    }
  }
  private set(state: DeskStoreState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

export function useWorldDeskState(store: WorldDeskStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

let shared: WorldDeskStore | null = null;
let users = 0;

/**
 * The one reviewed record (the service's Desk state) every view reads, so
 * marking work reviewed in Needs you, Town or Desk clears it everywhere.
 */
export function sharedDeskStore() {
  return (shared ??= new WorldDeskStore(bridge));
}

/** Keep the shared store observing while any view uses it. */
export function useSharedDeskStore(store = sharedDeskStore()) {
  useEffect(() => {
    if (store !== shared) {
      store.start();
      return () => store.stop();
    }
    if (users++ === 0) store.start();
    return () => {
      if (--users === 0) store.stop();
    };
  }, [store]);
  return store;
}
