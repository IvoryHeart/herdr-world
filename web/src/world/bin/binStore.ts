import { useEffect, useSyncExternalStore } from "react";
import {
  bridge,
  type BridgeControlMsg,
  type ConnectionStatus,
} from "../../api";
import {
  EMPTY_BIN,
  type BinState,
  type BinTarget,
  type BinView,
} from "../../../../shared/bin";
import { tabPinsFor, paneCloseBlockReason } from "../../tabPins";
import type { WorldLeafObject, WorldObject } from "../worldObject";

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};
export type BinSnapshot = BinState & {
  verified: boolean;
  error: string | null;
  readAt: number;
};
export class WorldBinStore {
  private state: BinSnapshot = {
    ...EMPTY_BIN,
    verified: false,
    error: null,
    readAt: 0,
  };
  private listeners = new Set<() => void>();
  private unlisten: (() => void)[] = [];
  private users = 0;
  private sequence = 0;
  private accepted = 0;
  private connection = 0;
  constructor(
    private client: Client,
    private now = () => performance.now(),
  ) {}
  get = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: BinSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  start() {
    if (++this.users !== 1) return;
    this.unlisten = [
      this.client.onControl((control) => {
        if (control.type === "world_bin_changed") void this.refresh();
      }),
      this.client.onStatus((status) => {
        this.connection++;
        this.set({ ...this.state, verified: false });
        if (status === "connected") void this.refresh();
      }),
    ];
    void this.refresh();
  }
  stop() {
    if (--this.users > 0) return;
    for (const off of this.unlisten) off();
    this.unlisten = [];
    this.connection++;
  }
  refresh = () => this.write("world.bin.list");
  async write(method: string, params?: Record<string, unknown>) {
    const sequence = ++this.sequence;
    const connection = this.connection;
    try {
      const value = (await this.client.call(method, params)) as BinState;
      if (connection !== this.connection || sequence < this.accepted) return;
      if (
        !value ||
        typeof value.epoch !== "string" ||
        !Array.isArray(value.entries)
      )
        throw new Error("Cannot read the bin");
      if (
        value.epoch === this.state.epoch &&
        value.revision < this.state.revision
      )
        return;
      this.accepted = sequence;
      this.set({ ...value, verified: true, error: null, readAt: this.now() });
    } catch (error) {
      if (connection === this.connection && sequence >= this.accepted)
        this.set({
          ...this.state,
          ...(method === "world.bin.list" ? { verified: false } : {}),
          error: String(error instanceof Error ? error.message : error),
        });
    }
  }
}
let shared: WorldBinStore | undefined;
export function sharedBinStore() {
  return (shared ??= new WorldBinStore(bridge));
}
export function useWorldBin(store = sharedBinStore()) {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
export const BIN_OPEN_EVENT = "world-bin-open";
export function openBin() {
  window.dispatchEvent(new Event(BIN_OPEN_EVENT));
}
export function binTarget(leaf: WorldLeafObject): BinTarget {
  return {
    connection_id: leaf.connectionId,
    connection_generation: leaf.generation,
    workspace_id: leaf.workspaceId,
    tab_id: leaf.tabId,
    pane_id: leaf.pane.pane_id,
    terminal_id: leaf.terminalId,
    preserve_tab: tabPinsFor(leaf.connectionId).has(leaf.tabId),
  };
}
export function binBlockReason(leaf: WorldLeafObject, world: WorldObject) {
  if (!leaf.actionable || leaf.stale)
    return "This agent's host is unavailable.";
  return paneCloseBlockReason(
    leaf.pane.pane_id,
    world.leaves
      .filter(
        (l) =>
          l.connectionId === leaf.connectionId &&
          l.generation === leaf.generation,
      )
      .map((l) => l.pane),
    tabPinsFor(leaf.connectionId),
  );
}
export function putInBin(
  leaf: WorldLeafObject,
  world: WorldObject,
  view: BinView,
) {
  if (binBlockReason(leaf, world)) return;
  openBin();
  return sharedBinStore()
    .write("world.bin.add", { ...binTarget(leaf), label: leaf.label, view })
    .then(() =>
      sharedBinStore()
        .get()
        .entries.some((entry) => binMatches(entry, leaf)),
    );
}
export function binMatches(target: BinTarget, leaf: WorldLeafObject) {
  return (
    target.connection_id === leaf.connectionId &&
    target.connection_generation === leaf.generation &&
    target.pane_id === leaf.pane.pane_id &&
    target.terminal_id === leaf.terminalId
  );
}
