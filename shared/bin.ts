/**
 * The agent bin and Town's bus. An agent put in the bin is held: nothing is
 * closed. A bus runs on one fixed schedule: every `BIN_BUS_INTERVAL_MS` it
 * sets off, everyone waiting boards, and it drives the whole route. When it
 * has left the map, `BIN_BUS_TRIP_MS` later, World records one durable close
 * intent per rider, which the effect runner dispatches under its recovery
 * rules. Until the bus has left the map, Put back takes an agent out again,
 * even one Town shows aboard. Holding and the
 * trip are reversible staging in the service's memory: a reload keeps them
 * and a service restart drops them without closing anything.
 */

/** The bus sets off this often, on a fixed schedule. */
export const BIN_BUS_INTERVAL_MS = 180_000;
/** How long the bus drives its route; its riders close when it ends. */
export const BIN_BUS_TRIP_MS = 20_000;

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
};

export type BinEntry = BinTarget & {
  id: string;
  /** The agent's name, for the bin, the bus and the receipt. */
  label: string;
  view: BinView;
  /**
   * The bus on the map takes it: it closes when the bus leaves, unless it is
   * put back first. Town shows it boarding as the bus passes its stop.
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

/** The bus's schedule, as it stood when the state was read. */
export type BinBus = {
  interval_ms: number;
  trip_ms: number;
  /** Until the next bus sets off. */
  next_ms: number;
  /** How long the bus on the map has driven, or null when none is out. */
  elapsed_ms: number | null;
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
    interval_ms: BIN_BUS_INTERVAL_MS,
    trip_ms: BIN_BUS_TRIP_MS,
    next_ms: BIN_BUS_INTERVAL_MS,
    elapsed_ms: null,
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
