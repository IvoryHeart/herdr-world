/**
 * The agent bin: an agent dropped in it is closed when its countdown ends,
 * unless the owner takes it back first. The service keeps the timers, so a
 * countdown survives leaving or reloading World. Nothing reaches Herdr before
 * the countdown ends or the owner chooses Close now.
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

/** Where the agent was dropped; Town draws the bus, other views the bin. */
export type BinView = "board" | "town" | "other";

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
  /** The agent's name, for the bin and the receipt. */
  label: string;
  view: BinView;
  /** The countdown it went in with. */
  duration_ms: number;
  /** Time left when the state was read; it only runs while the bin isn't paused. */
  remaining_ms: number;
};

export type BinOutcome = {
  id: string;
  label: string;
  view: BinView;
  /** closed: Herdr closed it. gone: it had already closed or changed. failed: Herdr refused. */
  result: "closed" | "gone" | "failed";
  /** The tab closed with it (it was the tab's last pane). */
  closed_tab: boolean;
  detail?: string;
};

export type BinState = {
  /**
   * This service run. A restart starts revisions and entries again, so a
   * browser takes the new run's state whatever its revision.
   */
  epoch: string;
  revision: number;
  /** Opening the bin, or holding the bus, pauses every timer in it. */
  paused: boolean;
  entries: BinEntry[];
  /** The most recent closes, newest last, so every open World can show them. */
  outcomes: BinOutcome[];
};

export const EMPTY_BIN: BinState = {
  epoch: "",
  revision: 0,
  paused: false,
  entries: [],
  outcomes: [],
};
