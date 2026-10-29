import type { BinEntry, BinState } from "../../../../shared/bin";
import type { BridgeControlMsg } from "../../api";
import { configureBinClient, refreshBin } from "./binStore";

/**
 * A fake of the service's bin for browser suites: it records every call and
 * keeps entries the way the service does, without timers. A suite closes an
 * entry with `expire`, as the countdown ending would.
 */
export function fakeBinService(countdownMs = 30_000) {
  let revision = 0;
  let paused = false;
  let entries: BinEntry[] = [];
  let outcomes: BinState["outcomes"] = [];
  let next = 1;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const controls = new Set<(control: BridgeControlMsg) => void>();
  const state = (): BinState => ({
    revision,
    paused,
    entries: entries.map((entry) => ({ ...entry })),
    outcomes: [...outcomes],
  });
  const changed = () => {
    revision += 1;
    for (const listener of controls)
      listener({ type: "world_bin_changed", revision });
  };
  const service = {
    calls,
    state,
    entries: () => entries,
    /** The countdown ends: the entry closes and every World hears. */
    expire(id: string) {
      const entry = entries.find((item) => item.id === id);
      if (!entry) return;
      entries = entries.filter((item) => item !== entry);
      outcomes = [
        ...outcomes,
        {
          id,
          label: entry.label,
          view: entry.view,
          result: "closed",
          closed_tab: true,
        },
      ];
      changed();
    },
    reset() {
      revision += 1;
      paused = false;
      entries = [];
      outcomes = [];
      calls.length = 0;
      void refreshBin();
    },
    async call(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      if (method === "world.bin.add") {
        const join = entries.find((entry) => entry.id === params.join);
        entries.push({
          ...(params as unknown as BinEntry),
          id: `bin-${next++}`,
          duration_ms: countdownMs,
          remaining_ms: join?.remaining_ms ?? countdownMs,
        });
      } else if (method === "world.bin.pause") paused = true;
      else if (method === "world.bin.resume") paused = false;
      else if (method === "world.bin.restore")
        entries = entries.filter((entry) => entry.id !== params.id);
      else if (method === "world.bin.close_now") {
        for (const entry of [...entries])
          if (params.id === "all" || entry.id === params.id)
            service.expire(entry.id);
        return state();
      } else if (method !== "world.bin.list")
        throw new Error(`unexpected ${method}`);
      if (method !== "world.bin.list") {
        if (!entries.length) paused = false;
        changed();
      }
      return state();
    },
    onControl(callback: (control: BridgeControlMsg) => void) {
      controls.add(callback);
      return () => {
        controls.delete(callback);
      };
    },
    onStatus() {
      return () => {};
    },
  };
  configureBinClient(service);
  return service;
}
