/**
 * The agent bin. An agent dropped in it waits out a countdown and is then
 * closed, unless the owner takes it back first. The countdown is reversible
 * staging held in the service's memory: a reload keeps it and a service
 * restart cancels it without closing anything. Only when the countdown ends
 * (or the owner chooses Close now) does World record a durable close intent,
 * which the effect runner dispatches under its recovery rules.
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

export function parseBinCountdown(value: unknown): BinCountdown {
  return BIN_COUNTDOWNS.includes(value as BinCountdown)
    ? (value as BinCountdown)
    : DEFAULT_BIN_COUNTDOWN;
}

/** Where the agent was dropped: Town shows the bus, other views the bin. */
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
  /** The countdown it went in with, in milliseconds. */
  duration_ms: number;
  /** Time left when the state was read; it runs only while the bin isn't paused. */
  remaining_ms: number;
  /** Entries that share one departure (Town: everyone on one bus). */
  trip: string;
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
  outcomes: [],
  countdown_s: DEFAULT_BIN_COUNTDOWN,
};
