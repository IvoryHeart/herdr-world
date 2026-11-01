import {
  BIN_DEPARTURE_MS,
  type BinEntry,
  type BinState,
} from "../../../../shared/bin";

/**
 * A browser fixture's World bin: the service's world.bin.* answers with an
 * in-page registry and a call log. Countdowns are frozen unless a fixture
 * supplies its clock. Fixtures never close anything; tests drive the controls.
 */
export function createFakeBin(epoch = "fixture-run", now?: () => number) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let readAt = now?.() ?? 0;
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
      if (now) {
        const at = now();
        if (!state.paused)
          for (const entry of state.entries)
            entry.remaining_ms = Math.max(
              0,
              entry.remaining_ms - (at - readAt),
            );
        readAt = at;
      }
      calls.push({ method, params: structuredClone(params) });
      switch (method) {
        case "world.bin.list":
          return structuredClone(state);
        case "world.bin.add": {
          // Like the service: boarding a bus that has not pulled away
          // restarts its countdown in full for everyone on it.
          const waiting = state.entries.filter(
            (entry) => entry.remaining_ms > entry.departure_ms,
          );
          const soonest =
            waiting.find((entry) => entry.id === params.join) ?? waiting[0];
          if (soonest)
            for (const entry of state.entries)
              if (entry.trip === soonest.trip)
                entry.remaining_ms = 30_000 + BIN_DEPARTURE_MS;
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
            departure_ms: BIN_DEPARTURE_MS,
            remaining_ms: 30_000 + BIN_DEPARTURE_MS,
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
        case "world.bin.close_now": {
          // Fixtures never close: the named entries just leave the bin.
          const ids = Array.isArray(params.ids) ? params.ids : [];
          if (
            !ids.length ||
            ids.some((id) => !String(id).startsWith(`bin-${epoch}-`))
          )
            throw new Error(
              "The bin changed since it was shown; nothing was closed",
            );
          state.entries = state.entries.filter((e) => !ids.includes(e.id));
          return changed();
        }
        default:
          throw new Error(`unknown bin operation ${method}`);
      }
    },
  };
}
