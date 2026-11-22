/**
 * A focus session (#1131): for a while World holds what would interrupt the
 * owner (chimes, notifications, the count on the tab and app icon) on every
 * device, then ends with one chime and a recap. The service keeps it, so
 * every browser shows the same session; agents never see it.
 */

/** The lengths the controls offer, in minutes; null runs until ended. */
export const FOCUS_CHOICES = [25, 45, 90, null] as const;

/** The longest timed session, in minutes (12 hours). */
export const FOCUS_MAX_MINUTES = 720;

export type FocusSession = {
  id: string;
  /** Epoch ms, by the service's clock. */
  started_at: number;
  /** When it ends on its own; null until the owner ends it. */
  ends_at: number | null;
};

export type FocusEnded = FocusSession & {
  ended_at: number;
  /** "expired": it reached its time; "ended": End now. */
  reason: "expired" | "ended";
};

export type FocusState = {
  /** Rises with every change; kept across service restarts. */
  revision: number;
  /** The service's clock when it answered, so browsers count down by it. */
  now: number;
  session: FocusSession | null;
  /** The latest session that ended, for its recap. */
  last: FocusEnded | null;
};

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function parseSession(value: unknown): FocusSession | null {
  const v = value as Partial<FocusSession> | null;
  if (!v || typeof v !== "object") return null;
  if (typeof v.id !== "string" || !v.id || !isTime(v.started_at)) return null;
  if (v.ends_at !== null && !isTime(v.ends_at)) return null;
  return { id: v.id, started_at: v.started_at, ends_at: v.ends_at };
}

function parseEnded(value: unknown): FocusEnded | null {
  const session = parseSession(value);
  const v = value as Partial<FocusEnded> | null;
  if (!session || !v || !isTime(v.ended_at)) return null;
  if (v.reason !== "expired" && v.reason !== "ended") return null;
  return { ...session, ended_at: v.ended_at, reason: v.reason };
}

/** A focus state from the service or the settings file; null if malformed. */
export function parseFocusState(value: unknown): FocusState | null {
  const v = value as Partial<FocusState> | null;
  if (!v || typeof v !== "object") return null;
  if (!Number.isSafeInteger(v.revision) || (v.revision as number) < 0)
    return null;
  return {
    revision: v.revision as number,
    now: isTime(v.now) ? v.now : 0,
    session: parseSession(v.session),
    last: parseEnded(v.last),
  };
}

/** A start request's length: whole minutes 1–720, or null for open-ended. */
export function parseFocusMinutes(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > FOCUS_MAX_MINUTES
  )
    throw new Error(
      `Focus length must be whole minutes from 1 to ${FOCUS_MAX_MINUTES}`,
    );
  return value as number;
}

/** "25 m", "1 h 30 m", "2 h". */
export function focusLength(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

/** A choice's label: "25 m", "90 m", "Until I stop". */
export const focusChoiceLabel = (minutes: number | null) =>
  minutes === null ? "Until I stop" : `${minutes} m`;
