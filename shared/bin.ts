/**
 * The agent bin and Town's bus. An agent put in the bin is held: nothing is
 * closed. The bus lives at Apartments. Once someone waits for it, it sets off
 * `BIN_BUS_BOARDING_MS` later (never before it is back from a trip), everyone
 * waiting boards, and it drives the route out past their stops and back at
 * `BIN_BUS_SPEED_KMH`: its trip's length is `binBusTripMs`, so the countdown
 * is when the bus is back at Apartments. The route is one shared measure for
 * the whole trip: the first Town to see exactly those waiting measures the
 * bus's way past all their stops on its roads (world.bin.route), and every
 * view times and draws the bus by that one distance. When the trip ends World records one
 * durable close intent per rider, which the effect runner dispatches under
 * its recovery rules. Until the trip ends, Put back takes an agent out
 * again, even one Town shows aboard, and the bus can be stopped where it is
 * so nothing closes until it is let go. Holding and the trip are reversible
 * staging in the service's memory: a reload keeps them and a service restart
 * drops them without closing anything.
 */

/** The bus's speed along the route, in km/h (36 km/h is 10 m a second). */
export const BIN_BUS_SPEED_KMH = 36;
/** It sets off this long after the first agent starts waiting for it. */
export const BIN_BUS_BOARDING_MS = 60_000;
/** It waits about this long at each stop where someone boards. */
export const BIN_BUS_DWELL_MS = 10_000;
/** Pulling away from a stand and pulling in at the next, per leg of the drive. */
export const BIN_BUS_PULL_MS = 2_500;
/**
 * Turning round where it must go back the way it came, and back at
 * Apartments its doors opening and its riders stepping off and walking in.
 */
export const BIN_BUS_ARRIVE_MS = 10_000;
/**
 * The next trip's route, Apartments past every waiting agent's stop and
 * back, in metres, until a Town has measured it on its roads
 * (world.bin.route).
 */
export const BIN_BUS_ROUTE_M = 500;
/** The longest route a Town may report, in metres. */
export const BIN_BUS_ROUTE_MAX_M = 50_000;

/**
 * How long the bus's trip lasts, in ms: the route at its speed, a pull away
 * and a pull in for each leg (Apartments to each stop, and back), its wait
 * at each stop, and its riders stepping off at Apartments. The service
 * times the trip by it; Town fits the bus's drive into it.
 */
export function binBusTripMs(route_m: number, stops: number): number {
  const legs = Math.max(1, stops + 1);
  return (
    Math.round((route_m / (BIN_BUS_SPEED_KMH / 3.6)) * 1000) +
    legs * BIN_BUS_PULL_MS +
    Math.max(0, stops) * BIN_BUS_DWELL_MS +
    BIN_BUS_ARRIVE_MS
  );
}

/**
 * Who a route was measured for: the waiting agents' IDs, sorted, one a
 * line. A measure stands only while exactly these agents wait.
 */
export function binRiderKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("\n");
}

/** The view an agent was put in the bin from (reported back with its outcome). */
export type BinView = "board" | "town" | "desk" | "other";

/** The pane to close, qualified by connection and runtime generation. */
export type BinTarget = {
  connection_id: string;
  connection_generation: number;
  workspace_id: string;
  tab_id: string;
  pane_id: string;
  terminal_id: string;
  /** A herdr-core terminal: closing it is a native kill (M7). */
  runtime?: "herdr-core";
  /**
   * Every terminal that ends with it, as the person confirmed them (core
   * ends a program's children with it). The close refuses if more would.
   */
  confirmation?: BinCoreConfirmation;
};

export type BinCoreConfirmation = {
  core_id: string;
  terminals: Array<{
    address: string;
    pid: number | null;
    /** The program's print: a kept replacement is not what was confirmed. */
    occupant?: string | null;
    remote?: boolean;
  }>;
};

export type BinEntry = BinTarget & {
  id: string;
  /** The agent's name, for the bin, the bus and the receipt. */
  label: string;
  view: BinView;
  /**
   * The bus out on its trip takes it: it closes when the trip ends, unless it
   * is put back first. Town shows it boarding as the bus halts at its stop.
   */
  riding: boolean;
  /** Its tab is pinned: the close never takes the tab's last pane. */
  preserve_tab: boolean;
};

export type BinOutcome = {
  id: string;
  label: string;
  view: BinView;
  /**
   * closed: Herdr closed it. gone: it had already closed, moved or its host
   * restarted, so nothing was sent. refused: World or Herdr refused the close.
   * uncertain: the close may have happened; World will not resend it.
   */
  result: "closed" | "gone" | "refused" | "uncertain";
  /** Its tab or workspace closed with it (it was the last pane). */
  closed_tab: boolean;
  detail?: string;
};

/** The bus, as it stood when the state was read. */
export type BinBus = {
  /** Its speed along the route, in km/h. */
  speed_kmh: number;
  /**
   * The bus on the map: its route past every rider's stop and back, in
   * metres (0 at home). Every Town draws its drive to this distance.
   */
  route_m: number;
  /** Its trip's length (binBusTripMs), or 0 while it is at home. */
  trip_ms: number;
  /** How long the bus has been out on its trip, or null when none is out. */
  elapsed_ms: number | null;
  /** The bus out on its trip was stopped: it stands, and nothing closes, until it goes. */
  stopped: boolean;
  /** The trip on the map, counted from 1 in this service run, or null. */
  trip: number | null;
  /**
   * Until the next bus sets off for those waiting, or null when nobody waits
   * for one or the bus out is stopped.
   */
  next_ms: number | null;
  /** The next bus's route and trip, for those waiting now (0 with nobody). */
  next_route_m: number;
  next_trip_ms: number;
  /**
   * A Town has measured the next route for exactly those waiting now; until
   * then it is `BIN_BUS_ROUTE_M` and every waiting agent counts as a stop.
   */
  next_measured: boolean;
};

export type BinState = {
  /**
   * The service run. A restart starts revisions and IDs again, so a browser
   * takes a new run's state whatever its revision, and no stale ID can name
   * an agent added after the restart.
   */
  epoch: string;
  revision: number;
  /** Agents held in the bin, waiting at a stop or riding the bus. */
  entries: BinEntry[];
  /** Agents whose bus has left and whose close is being carried out. */
  closing: BinEntry[];
  /** The most recent results, newest last, so every open World can show them. */
  outcomes: BinOutcome[];
  bus: BinBus;
};

export const EMPTY_BIN: BinState = {
  epoch: "",
  revision: 0,
  entries: [],
  closing: [],
  outcomes: [],
  bus: {
    speed_kmh: BIN_BUS_SPEED_KMH,
    route_m: 0,
    trip_ms: 0,
    elapsed_ms: null,
    stopped: false,
    trip: null,
    next_ms: null,
    next_route_m: 0,
    next_trip_ms: 0,
    next_measured: false,
  },
};

/**
 * The pinned-tab rule: closing `target` would leave its tab without a pane
 * that is not itself held in the bin. `tabPanes` are every pane of its tab.
 */
export function binEmptiesTab(
  target: Pick<BinTarget, "pane_id">,
  tabPanes: readonly { pane_id: string }[],
  held: (paneId: string) => boolean,
): boolean {
  return !tabPanes.some(
    (pane) => pane.pane_id !== target.pane_id && !held(pane.pane_id),
  );
}
