import type { BinEntry, BinState } from "../../../../shared/bin";

/**
 * A browser fixture's World bin: the service's world.bin.* answers with an
 * in-page registry and a call log. Countdowns are frozen at their duration
 * (fixtures never close anything); tests drive pause, resume and put back.
 */
export function createFakeBin(epoch = "fixture-run") {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let next = 1;
  const state: BinState = {
    epoch,
    revision: 1,
    paused: false,
    entries: [],
    closing: [],
    outcomes: [],
    countdown_s: 30,
  };
  const changed = () => {
    state.revision += 1;
    if (!state.entries.length) state.paused = false;
    return structuredClone(state);
  };
  return {
    calls,
    state,
    call(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params: structuredClone(params) });
      switch (method) {
        case "world.bin.list":
          return structuredClone(state);
        case "world.bin.add": {
          const soonest = state.entries.find(
            (entry) => entry.id === params.join,
          );
          const id = `bin-${epoch}-${next++}`;
          const entry: BinEntry = {
            id,
            connection_id: String(params.connection_id),
            connection_generation: Number(params.connection_generation),
            workspace_id: String(params.workspace_id),
            tab_id: String(params.tab_id),
            pane_id: String(params.pane_id),
            terminal_id: String(params.terminal_id),
            label: String(params.label ?? "Agent"),
            view: "town",
            duration_ms: 30_000,
            remaining_ms: 30_000,
            trip: soonest?.trip ?? id,
          };
          state.entries.push(entry);
          return changed();
        }
        case "world.bin.pause":
          state.paused = true;
          return changed();
        case "world.bin.resume":
          state.paused = false;
          return changed();
        case "world.bin.restore":
          state.entries = state.entries.filter((e) => e.id !== params.id);
          return changed();
        case "world.bin.close_now":
          // Fixtures never close: the entry just leaves the bin.
          state.entries =
            params.id === "all"
              ? []
              : state.entries.filter((e) => e.id !== params.id);
          return changed();
        default:
          throw new Error(`unknown bin operation ${method}`);
      }
    },
  };
}
