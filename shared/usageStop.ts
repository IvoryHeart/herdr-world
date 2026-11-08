/**
 * An agent that stopped because its harness hit a subscription or usage
 * limit ("out of fuel"), read from the harness's own session records. The
 * service reads it per agent; Town and Chat show it with the same words.
 */
export type AgentUsageStop = {
  harness: "codex" | "claude";
  /** When the harness recorded the stop, in milliseconds since the epoch. */
  at: number;
  /** When the limit resets, in milliseconds, or null when the record has none. */
  resets_at: number | null;
};

const HARNESS_NAMES: Record<AgentUsageStop["harness"], string> = {
  codex: "Codex",
  claude: "Claude",
};

/** True while the stop holds: its reset, when it names one, is still ahead. */
export function usageStopCurrent(
  stop: AgentUsageStop | null | undefined,
  now: number,
): stop is AgentUsageStop {
  return Boolean(stop && (stop.resets_at === null || stop.resets_at > now));
}

const pad = (value: number) => String(value).padStart(2, "0");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "15:00" in the viewer's local time, with the weekday ("Tue 15:00") when
 * the reset is not today.
 */
export function usageStopResetTime(resetsAt: number, now: number): string {
  const at = new Date(resetsAt);
  const today = new Date(now);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.toDateString() === today.toDateString()
    ? time
    : `${WEEKDAYS[at.getDay()]} ${time}`;
}

/**
 * The words Town's hover card and Chat's Now status both show:
 * "Usage limit reached · resets 15:00 (Codex)", or without a reset time
 * when the harness recorded none.
 */
export function usageStopText(stop: AgentUsageStop, now: number): string {
  const harness = HARNESS_NAMES[stop.harness];
  return stop.resets_at === null
    ? `Usage limit reached (${harness})`
    : `Usage limit reached · resets ${usageStopResetTime(stop.resets_at, now)} (${harness})`;
}
