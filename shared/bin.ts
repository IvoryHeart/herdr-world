/**
 * The agent bin. An agent dropped in it waits out a countdown, then its bus
 * drives away, and it is closed when the bus has left the map, unless the
 * owner takes it back first. Both are reversible staging held in the
 * service's memory: a reload keeps them and a service restart cancels them
 * without closing anything. Only when the departure ends (or the owner
 * chooses Close now) does World record a durable close intent, which the
 * effect runner dispatches under its recovery rules.
 */

/** The countdowns the owner can choose, in seconds. */
export const BIN_COUNTDOWNS = [10, 30, 60, 120] as const;
export type BinCountdown = (typeof BIN_COUNTDOWNS)[number];
export const DEFAULT_BIN_COUNTDOWN: BinCountdown = 30;
export const BIN_COUNTDOWN_LABELS: Record<BinCountdown, string> = {
  10: "10 s",
  30: "30 s",
  60: "1 min",
  120: "2 min",
};

/**
 * After the countdown the bus drives away for this long; the close commits
 * only when it has left the map, and until then the owner can still stop it.
 * Every entry has it, so an agent closes at the same moment in every view.
 */
export const BIN_DEPARTURE_MS = 6_000;

export function parseBinCountdown(value: unknown): BinCountdown {
  return BIN_COUNTDOWNS.includes(value as BinCountdown)
    ? (value as BinCountdown)
    : DEFAULT_BIN_COUNTDOWN;
}

/** The view an agent was staged from (reported back with its outcome). */
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

/**
 * The one pinned-tab rule, for the service's admission and both browser
 * pre-checks: a pinned tab keeps its last pane, and panes already staged in
 * the bin on the same connection generation count as gone. True when no
 * other pane of the target's pinned tab would survive closing it.
 */
export function binEmptiesPinnedTab(
  target: Pick<
    BinTarget,
    "connection_id" | "connection_generation" | "pane_id"
  >,
  /** Every pane of the target's tab. */
  tabPanes: readonly { pane_id: string; terminal_id: string }[],
  staged: readonly BinTarget[],
): boolean {
  const gone = (pane: { pane_id: string; terminal_id: string }) =>
    staged.some(
      (entry) =>
        entry.connection_id === target.connection_id &&
        entry.connection_generation === target.connection_generation &&
        entry.pane_id === pane.pane_id &&
        entry.terminal_id === pane.terminal_id,
    );
  return !tabPanes.some(
    (pane) => pane.pane_id !== target.pane_id && !gone(pane),
  );
}

export type BinEntry = BinTarget & {
  id: string;
  /** The agent's name, for the bin, the bus and the receipt. */
  label: string;
  view: BinView;
  /** The countdown it went in with (the wait at the stop), in milliseconds. */
  duration_ms: number;
  /** The drive away after the countdown, in milliseconds; the close commits when it ends. */
  departure_ms: number;
  /**
   * Time left until the close commits (the wait, then the drive) when the
   * state was read; it runs only while the bin isn't paused.
   */
  remaining_ms: number;
  /** Entries that share one departure (Town: everyone on one bus). */
  trip: string;
  /** Original trip countdown; boarding never changes its set-off clock. */
  trip_duration_ms?: number;
  /** Active trip time at this sample, excluding holds and independent of resets. */
  trip_elapsed_ms?: number;
  /** Active trip time when this entry joined, set once; older services imply 0. */
  trip_joined_ms?: number;
};

export type BinReservation = BinTarget & { id: string };

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

export type BinState = {
  /**
   * The service run. A restart starts revisions and IDs again, so a browser
   * takes a new run's state whatever its revision, and no stale ID can name
   * an agent added after the restart.
   */
  epoch: string;
  revision: number;
  /** Opening the bin, or holding the bus, pauses every countdown in it. */
  paused: boolean;
  entries: BinEntry[];
  /** IDs whose countdown ended and whose close is being carried out. */
  closing: string[];
  /** Qualified staged/closing/uncertain targets, retained until decisive release. */
  reservations?: BinReservation[];
  /** The most recent results, newest last, so every open World can show them. */
  outcomes: BinOutcome[];
  /** The owner's countdown setting, in seconds. */
  countdown_s: BinCountdown;
};

export const EMPTY_BIN: BinState = {
  epoch: "",
  revision: 0,
  paused: false,
  entries: [],
  closing: [],
  reservations: [],
  outcomes: [],
  countdown_s: DEFAULT_BIN_COUNTDOWN,
};
