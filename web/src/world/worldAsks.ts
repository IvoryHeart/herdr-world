import { useEffect, useSyncExternalStore } from "react";
import { bridge, type BridgeControlMsg, type ConnectionStatus } from "../api";

/**
 * Questions agents ask the owner with `herdr-world ask` (the service's World
 * ledger, server/src/world/world-ledger.ts). Town's attention list shows the
 * open ones, fetched alone (`world.asks.get`) only when a change notice
 * carries a newer revision, and the owner's answer goes back through
 * `world.ask.answer`.
 */

export type WorldAsk = {
  id: string;
  at: number;
  actor: {
    label: string;
    verified: boolean;
    connection_id?: string;
    pane_id?: string;
    terminal_id?: string;
  };
  question: string;
  options: string[];
  owner_only: boolean;
  answer?: { text: string; at: number; by: string };
};

/** The open questions at a ledger revision (`world.asks.get`). */
type OpenAsks = { revision: number; asks: WorldAsk[] };

export type AsksClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

const NONE: readonly WorldAsk[] = [];

export class WorldAsksStore {
  private revision = -1;
  private open: readonly WorldAsk[] = NONE;
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private users = 0;

  constructor(private readonly client: AsksClient) {}

  get = () => this.open;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start() {
    this.users += 1;
    if (this.unlisten.length) return;
    this.unlisten = [
      this.client.onControl((control) => {
        // Most ledger changes are Board moves and results: fetch only
        // when a question was asked or answered.
        if (
          control.type === "world_ledger_changed" &&
          control.asks === true &&
          (control.revision ?? 0) > this.revision
        )
          void this.refresh();
      }),
      this.client.onStatus((status) => {
        // A restarted service may count revisions from the start again.
        if (status === "connected") {
          this.revision = -1;
          void this.refresh();
        }
      }),
    ];
    void this.refresh();
  }

  stop() {
    this.users = Math.max(0, this.users - 1);
    if (this.users) return;
    for (const off of this.unlisten) off();
    this.unlisten = [];
  }

  private take(asks: unknown) {
    const next = asks as OpenAsks | null;
    if (!next || !Array.isArray(next.asks) || next.revision < this.revision)
      return;
    this.revision = next.revision;
    this.open = next.asks.filter((ask) => !ask.answer);
    for (const listener of this.listeners) listener();
  }

  async refresh() {
    try {
      this.take(await this.client.call("world.asks.get"));
    } catch {
      // Questions come back with the next change or reconnect.
    }
  }

  /** Answer as the owner; resolves to an error message, or null. */
  async answer(id: string, text: string): Promise<string | null> {
    try {
      this.take(
        await this.client.call("world.ask.answer", { id, answer: text }),
      );
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
}

let shared: WorldAsksStore | null = null;
export function sharedAsksStore() {
  shared ??= new WorldAsksStore(bridge);
  return shared;
}

/** Open questions for the owner, oldest first, while the caller is shown. */
export function useWorldAsks(store: WorldAsksStore = sharedAsksStore()) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
