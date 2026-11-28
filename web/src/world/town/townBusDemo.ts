import { clock } from "../../clock";
/**
 * A testing-only switch for Town's bus: open World with `?townBusDemo` and
 * up to four of Town's agents walk out to their stops; about 6 s later a
 * short bus trip (45 s) collects them and drives them to Apartments, where
 * they walk in and the sign counts them. It is a local stand-in for the
 * bin: nothing is sent to the service and nothing closes. The page drops the
 * parameter at once; the agents stay away (moved in) until the page reloads.
 */

import {
  BIN_BUS_ROUTE_M,
  BIN_BUS_SPEED_KMH,
  type BinEntry,
} from "../../../../shared/bin";
import type { WorldBin } from "../bin/binStore";
import type { TownModel } from "./townModel";

const PARAM = "townBusDemo";
/** The riders wait this long for the bus, which is out this long. */
export const TOWN_BUS_DEMO_WAIT_MS = 6_000;
export const TOWN_BUS_DEMO_TRIP_MS = 45_000;
const RIDERS = 4;

let started: number | null | undefined;

/** When the demo started (clock.monotonic()), or null; read once per page. */
export function townBusDemoStart(): number | null {
  if (started !== undefined) return started;
  started = null;
  if (typeof location === "undefined") return started;
  const url = new URL(location.href);
  if (!url.searchParams.has(PARAM)) return started;
  started = clock.monotonic();
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return started;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetTownBusDemo() {
  started = undefined;
}

/**
 * The bin the demo shows `now` (clock.monotonic()), `start` being when it
 * began: its riders are the first agents of up to four rooms, by key, each
 * room's first (so they wait at different stops where the town has them).
 */
export function townBusDemoBin(
  model: Pick<TownModel, "agents">,
  start: number,
  now: number,
): WorldBin {
  const agents = [...model.agents.values()].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const picked: typeof agents = [];
  const rooms = new Set<string>();
  for (const agent of agents)
    if (!rooms.has(agent.roomKey)) {
      rooms.add(agent.roomKey);
      picked.push(agent);
    }
  for (const agent of agents)
    if (picked.length < RIDERS && !picked.includes(agent)) picked.push(agent);
  const since = now - start;
  const riding = since >= TOWN_BUS_DEMO_WAIT_MS;
  const over = since >= TOWN_BUS_DEMO_WAIT_MS + TOWN_BUS_DEMO_TRIP_MS;
  const entries = picked.slice(0, RIDERS).map(
    (agent): BinEntry => ({
      id: `town-bus-demo-${agent.key}`,
      connection_id: agent.currentPaneRef.connectionId,
      connection_generation: agent.currentPaneRef.generation,
      workspace_id: "",
      tab_id: "",
      pane_id: agent.currentPaneRef.nativeId,
      terminal_id: `town-bus-demo-${agent.key}`,
      label: agent.agentName ?? agent.displayLabel,
      view: "town",
      riding,
      preserve_tab: false,
    }),
  );
  return {
    epoch: "town-bus-demo",
    revision: over ? 2 : riding ? 1 : 0,
    entries: over ? [] : entries,
    // Moved in: their agents stay out of their rooms until the page reloads.
    closing: over ? entries : [],
    outcomes: [],
    bus: {
      speed_kmh: BIN_BUS_SPEED_KMH,
      route_m: riding && !over ? BIN_BUS_ROUTE_M : 0,
      trip_ms: riding && !over ? TOWN_BUS_DEMO_TRIP_MS : 0,
      elapsed_ms: riding && !over ? since - TOWN_BUS_DEMO_WAIT_MS : null,
      stopped: false,
      trip: riding && !over ? 1 : null,
      next_ms: riding ? null : TOWN_BUS_DEMO_WAIT_MS - since,
      next_route_m: riding ? 0 : BIN_BUS_ROUTE_M,
      next_trip_ms: riding ? 0 : TOWN_BUS_DEMO_TRIP_MS,
      next_measured: false,
    },
    readAt: now,
    verified: true,
  };
}

let shown: WorldBin | null = null;
const watchers = new Set<() => void>();

/**
 * The demo's bin while Town shows it (null otherwise), so the bin's chip and
 * tray count down from the same bin as Town's stops while the demo runs.
 */
export const townBusDemoShown = {
  get: () => shown,
  set(bin: WorldBin | null) {
    if (shown === bin) return;
    shown = bin;
    for (const watcher of watchers) watcher();
  },
  subscribe(watcher: () => void) {
    watchers.add(watcher);
    return () => {
      watchers.delete(watcher);
    };
  },
};

/** When the demo's bin next changes, after `now`, or null once it is over. */
export function townBusDemoNext(start: number, now: number): number | null {
  for (const at of [
    TOWN_BUS_DEMO_WAIT_MS,
    TOWN_BUS_DEMO_WAIT_MS + TOWN_BUS_DEMO_TRIP_MS,
  ])
    if (now < start + at) return start + at;
  return null;
}
