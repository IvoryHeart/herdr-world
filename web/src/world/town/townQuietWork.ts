/**
 * Quiet while working (#1130): an agent Herdr reports as working whose
 * session has not moved for a while. Its last activity is its session
 * file's modification time (`last_activity_at`); an agent without one is
 * never quiet, so nothing is guessed. Town keeps a quiet agent seated with
 * its working light on, stills its typing and marks it with an hourglass
 * and how long it has gone quiet, beside its step's running time; the Town
 * board counts them under Busy. The look clears the moment the
 * session moves again.
 */

const MINUTE = 60_000;

/** The thresholds the Quiet working agents setting offers, in minutes; 0 is off. */
export const TOWN_QUIET_MINUTES = [0, 5, 10, 20, 30, 60] as const;
/** Ten minutes: long enough for most test runs and builds to print. */
export const TOWN_QUIET_DEFAULT_MINUTES = 10;

/** A setting value as a threshold: one of the offered ones, else the default. */
export function townQuietMinutes(value: unknown): number {
  return TOWN_QUIET_MINUTES.includes(value as never)
    ? (value as number)
    : TOWN_QUIET_DEFAULT_MINUTES;
}

/**
 * When a working agent last moved, if it has been quiet for at least
 * `minutes` at `now`; null when it is not working, has no activity time,
 * moved recently, or the threshold is off (0).
 */
export function townQuietSince(
  status: string,
  lastActivityAt: number | undefined | null,
  now: number,
  minutes: number,
): number | null {
  if (minutes <= 0 || status !== "working") return null;
  if (typeof lastActivityAt !== "number" || !Number.isFinite(lastActivityAt))
    return null;
  if (lastActivityAt <= 0) return null;
  return now - lastActivityAt >= minutes * MINUTE ? lastActivityAt : null;
}

/**
 * How long a quiet agent has gone quiet, for the mark beside its hourglass:
 * "23m" or "1h 05m", as the step bubble writes its step's time.
 */
export function townQuietAge(since: number, now: number): string {
  const quiet = Math.max(0, Math.floor((now - since) / MINUTE));
  if (quiet < 60) return `${quiet}m`;
  return `${Math.floor(quiet / 60)}h ${String(quiet % 60).padStart(2, "0")}m`;
}

/** "No progress for 23 m (last 14:02)", with the hour in the reader's clock. */
export function townQuietText(since: number, now: number): string {
  const quiet = Math.max(0, Math.floor((now - since) / MINUTE));
  const span =
    quiet < 60
      ? `${quiet} m`
      : `${Math.floor(quiet / 60)} h${quiet % 60 ? ` ${quiet % 60} m` : ""}`;
  const at = new Date(since).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `No progress for ${span} (last ${at})`;
}

/**
 * The quiet working agents among `agents`, by key with when each last
 * moved, in roster order (the board's find walks them in this order).
 */
export function townQuietAgents<
  T extends { key: string; semanticStatus: string },
>(
  agents: readonly T[],
  activityAt: (agent: T) => number | undefined,
  now: number,
  minutes: number,
): ReadonlyMap<string, number> {
  const quiet = new Map<string, number>();
  if (minutes <= 0) return quiet;
  for (const agent of agents) {
    if (agent.semanticStatus !== "working") continue;
    const since = townQuietSince(
      agent.semanticStatus,
      activityAt(agent),
      now,
      minutes,
    );
    if (since !== null) quiet.set(agent.key, since);
  }
  return quiet;
}

/** Whether two quiet maps name the same agents since the same times. */
export function townQuietSame(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
) {
  if (a.size !== b.size) return false;
  for (const [key, since] of a) if (b.get(key) !== since) return false;
  return true;
}
