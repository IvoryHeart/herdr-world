import { useEffect, useSyncExternalStore } from "react";
import {
  EMPTY_BIN,
  type BinEntry,
  type BinOutcome,
  type BinState,
  type BinTarget,
  type BinView,
} from "../../../../shared/bin";
import type { BridgeControlMsg, ConnectionStatus } from "../../api";

/**
 * The browser's view of the service's bin: every open World shows the same
 * countdowns. Times are read relative to when the state arrived, so the
 * browser's clock never has to agree with the service's.
 */

export type BinClient = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onControl(callback: (control: BridgeControlMsg) => void): () => void;
  onStatus(callback: (status: ConnectionStatus) => void): () => void;
};

export type WorldBinState = {
  bin: BinState;
  /** performance.now() when `bin` arrived. */
  receivedAt: number;
  /** Whether the service has answered at least once. */
  loaded: boolean;
  error: string | null;
};

let state: WorldBinState = {
  bin: EMPTY_BIN,
  receivedAt: 0,
  loaded: false,
  error: null,
};
const listeners = new Set<() => void>();
const outcomeListeners = new Set<(outcome: BinOutcome) => void>();
const seenOutcomes = new Set<string>();
let users = 0;
let unlisten: (() => void)[] = [];
let clientOverride: BinClient | null = null;

/** Tests (and harness pages) supply their own bridge. */
export function configureBinClient(client: BinClient | null) {
  clientOverride = client;
}

async function client(): Promise<BinClient> {
  return clientOverride ?? (await import("../../api")).bridge;
}

function parse(value: unknown): BinState | null {
  const v = value as Partial<BinState> | null;
  if (
    !v ||
    !Number.isSafeInteger(v.revision) ||
    typeof v.paused !== "boolean" ||
    !Array.isArray(v.entries)
  )
    return null;
  return {
    revision: v.revision as number,
    paused: v.paused,
    entries: v.entries.filter(
      (entry): entry is BinEntry =>
        !!entry &&
        typeof entry.id === "string" &&
        typeof entry.pane_id === "string" &&
        typeof entry.remaining_ms === "number",
    ),
    outcomes: Array.isArray(v.outcomes) ? v.outcomes : [],
  };
}

function accept(value: unknown) {
  const bin = parse(value);
  if (!bin || (state.loaded && bin.revision < state.bin.revision)) return;
  const first = !state.loaded;
  state = { bin, receivedAt: performance.now(), loaded: true, error: null };
  for (const outcome of bin.outcomes) {
    if (seenOutcomes.has(outcome.id)) continue;
    seenOutcomes.add(outcome.id);
    // Closes from before this page loaded are history, not news.
    if (!first) for (const listener of outcomeListeners) listener(outcome);
  }
  for (const listener of listeners) listener();
}

export async function refreshBin() {
  try {
    accept(await (await client()).call("world.bin.list"));
  } catch (error) {
    state = {
      ...state,
      error: error instanceof Error ? error.message : String(error),
    };
    for (const listener of listeners) listener();
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const get = () => state;

/** The bin, kept current while any view shows it. */
export function useWorldBin() {
  useEffect(() => {
    users += 1;
    if (users === 1)
      void client().then((b) => {
        if (!users || unlisten.length) return;
        unlisten = [
          b.onControl((control) => {
            if (
              control.type === "world_bin_changed" &&
              (control.revision ?? 0) > state.bin.revision
            )
              void refreshBin();
          }),
          b.onStatus((status) => {
            if (status === "connected") void refreshBin();
          }),
        ];
        void refreshBin();
      });
    return () => {
      users -= 1;
      if (users) return;
      for (const off of unlisten) off();
      unlisten = [];
    };
  }, []);
  return useSyncExternalStore(subscribe, get, get);
}

/** Hear about each close as it happens (sound, animation, receipt). */
export function onBinOutcome(listener: (outcome: BinOutcome) => void) {
  outcomeListeners.add(listener);
  return () => {
    outcomeListeners.delete(listener);
  };
}

/** Milliseconds left on an entry now. */
export function binTimeLeft(
  entry: BinEntry,
  current: WorldBinState,
  now = performance.now(),
) {
  if (current.bin.paused) return entry.remaining_ms;
  return Math.max(0, entry.remaining_ms - (now - current.receivedAt));
}

async function mutate(method: string, params?: Record<string, unknown>) {
  const result = await (await client()).call(method, params);
  accept(result);
  return state.bin;
}

export const addToBin = (
  target: BinTarget & { label: string; view: BinView; join?: string },
) => mutate("world.bin.add", target);
export const pauseBin = () => mutate("world.bin.pause");
export const resumeBin = () => mutate("world.bin.resume");
export const restoreFromBin = (id: string) =>
  mutate("world.bin.restore", { id });
export const closeFromBin = (id: string | "all") =>
  mutate("world.bin.close_now", { id });

/** Whether this pane is in the bin. */
export function binEntryFor(
  bin: BinState,
  connectionId: string,
  generation: number,
  paneId: string,
) {
  return bin.entries.find(
    (entry) =>
      entry.connection_id === connectionId &&
      entry.connection_generation === generation &&
      entry.pane_id === paneId,
  );
}

/** A short receipt for a close. */
export function binOutcomeText(outcome: BinOutcome) {
  if (outcome.result === "closed")
    return outcome.closed_tab
      ? `Closed ${outcome.label} and its tab.`
      : `Closed ${outcome.label}'s pane.`;
  if (outcome.result === "gone")
    return `${outcome.label} was not closed. ${outcome.detail ?? ""}`.trim();
  return `Couldn't close ${outcome.label}. ${outcome.detail ?? ""}`.trim();
}
