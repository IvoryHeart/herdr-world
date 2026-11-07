import type { AgentUsageStop } from "../../../shared/usageStop";
import { isRecord } from "./session-utils";

type RecordValue = Record<string, unknown>;

const object = (value: unknown): RecordValue => (isRecord(value) ? value : {});
const time = (value: unknown) =>
  typeof value === "number"
    ? value
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
/** A reset given in epoch seconds, as both harnesses record it, in ms. */
const resetSeconds = (value: unknown) =>
  Number.isSafeInteger(value) &&
  (value as number) > 0 &&
  (value as number) <= 1e11
    ? (value as number) * 1000
    : null;

/** The text of a record's message content, string or text blocks. */
function messageText(message: RecordValue) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      isRecord(block) && typeof block.text === "string" ? block.text : "",
    )
    .join("\n");
}

/**
 * Codex: when a window is used up, its rate-limit snapshot names it in
 * `rate_limit_reached_type`. The reset is that window's, or the latest reset
 * of any window at 100 %, or none.
 */
function codexReset(limits: RecordValue, at: number, reached: string) {
  const windows: { name: string; used: number; resets: number | null }[] = [];
  for (const name of ["primary", "secondary"]) {
    const window = object(limits[name]);
    if (!Object.keys(window).length) continue;
    const seconds = window.resets_in_seconds;
    windows.push({
      name,
      used: typeof window.used_percent === "number" ? window.used_percent : 0,
      resets:
        resetSeconds(window.resets_at) ??
        (Number.isFinite(at) &&
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds >= 0
          ? at + seconds * 1000
          : null),
    });
  }
  const named = windows.find((window) => reached.includes(window.name));
  if (named?.resets) return named.resets;
  const full = windows
    .filter((window) => window.used >= 100 && window.resets !== null)
    .map((window) => window.resets!);
  return full.length ? Math.max(...full) : null;
}

const CODEX_ACTIVITY_EVENTS = new Set(["agent_message", "agent_reasoning"]);

function codexUsageStop(records: readonly RecordValue[]) {
  let stop: AgentUsageStop | null = null;
  let limits: RecordValue = {};
  for (const record of records) {
    const payload = object(record.payload);
    const at = time(record.timestamp);
    if (record.type === "event_msg" && payload.type === "token_count") {
      if (!isRecord(payload.rate_limits)) continue;
      limits = payload.rate_limits;
      const reached = limits.rate_limit_reached_type;
      // A newer snapshot that names no reached limit ends the stop.
      stop =
        typeof reached === "string" && reached && Number.isFinite(at)
          ? { harness: "codex", at, resets_at: codexReset(limits, at, reached) }
          : null;
    } else if (record.type === "event_msg" && payload.type === "error") {
      // The turn's own error: Codex names a used-up limit in its error info.
      const info = payload.codex_error_info;
      const limited =
        info === "usage_limit_exceeded" ||
        (isRecord(info) && "usage_limit_exceeded" in info);
      if (limited && Number.isFinite(at))
        stop = {
          harness: "codex",
          at,
          resets_at:
            (stop as AgentUsageStop | null)?.resets_at ??
            codexReset(limits, at, ""),
        };
    } else if (
      (record.type === "event_msg" &&
        CODEX_ACTIVITY_EVENTS.has(String(payload.type))) ||
      (record.type === "response_item" &&
        !(payload.type === "message" && payload.role !== "assistant"))
    )
      // The agent answered or acted again: it has fuel.
      stop = null;
  }
  return stop;
}

/** Claude Code's older refusal text carries its reset in epoch seconds. */
const CLAUDE_LEGACY = /^Claude AI usage limit reached\|(\d{1,11})\s*$/;
const CLAUDE_LIMIT_TEXT =
  /\b(?:usage limit reached|limit reached|hit your (?:usage )?limit)\b/i;
/**
 * Claude Code's newer refusal names its reset as a wall-clock time, with an
 * optional date and time zone: "resets 3pm (UTC)", "will reset at 3:30pm",
 * "resets Nov 8, 9am (Europe/Paris)". A time needs am/pm or minutes.
 */
const CLAUDE_RESET_TEXT =
  /\bresets?\s+(?:at\s+)?(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,|\s+at)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b\s*(?:\(([^)]+)\))?/i;
const MONTHS = "janfebmaraprmayjunjulaugsepoctnovdec";

/** The wall-clock fields of an instant in a zone (the service's own if none). */
function wallClock(ms: number, zone: string | undefined) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(ms);
  const field = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: field("year"),
    month: field("month") - 1,
    day: field("day"),
    asUtc: Date.UTC(
      field("year"),
      field("month") - 1,
      field("day"),
      field("hour"),
      field("minute"),
      field("second"),
    ),
  };
}

/** The instant a zone's wall clock shows the given fields. */
function zonedTime(
  fields: [number, number, number, number, number],
  zone: string | undefined,
) {
  const guess = Date.UTC(...fields);
  const offset = (ms: number) =>
    wallClock(ms, zone).asUtc - Math.floor(ms / 1000) * 1000;
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** The first instant after the refusal that matches its stated reset. */
function claudeTextReset(text: string, at: number) {
  const match = CLAUDE_RESET_TEXT.exec(text);
  if (!match || !Number.isFinite(at)) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] =
    match;
  if (!meridiem && minuteText === undefined) return null;
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return null;
  const zone = zoneText?.trim();
  try {
    const now = wallClock(at, zone);
    if (monthName) {
      const month = MONTHS.indexOf(monthName.toLowerCase()) / 3;
      const day = Number(dayText);
      const on = (year: number) =>
        zonedTime([year, month, day, hour, minute], zone);
      const reset = on(now.year);
      return reset > at ? reset : on(now.year + 1);
    }
    const on = (day: number) =>
      zonedTime([now.year, now.month, day, hour, minute], zone);
    const reset = on(now.day);
    return reset > at ? reset : on(now.day + 1);
  } catch {
    return null; // A zone Intl does not know: the reset cannot be placed.
  }
}

function claudeUsageStop(records: readonly RecordValue[]) {
  let stop: AgentUsageStop | null = null;
  for (const record of records) {
    if (record.type !== "assistant") continue;
    const message = object(record.message);
    const at = time(record.timestamp);
    const refusal =
      record.isApiErrorMessage === true || message.model === "<synthetic>";
    const text = refusal ? messageText(message).trim() : "";
    const legacy = CLAUDE_LEGACY.exec(text);
    let resets: number | null | undefined;
    if (record.apiError === "usage_limit_reached")
      resets = resetSeconds(
        object(object(record.apiErrorParams).rate_limit_info).resetsAt,
      );
    else if (legacy) resets = resetSeconds(Number(legacy[1]));
    else if (
      refusal &&
      record.error === "rate_limit" &&
      CLAUDE_LIMIT_TEXT.test(text)
    )
      resets = claudeTextReset(text, at);
    if (resets !== undefined) {
      if (Number.isFinite(at))
        stop = { harness: "claude", at, resets_at: resets };
    } else if (!refusal) stop = null; // A later answer: it has fuel again.
  }
  return stop;
}

/**
 * The usage-limit stop a session's own records end with, or null. Only the
 * harness's records count, never terminal text: Codex's rate-limit snapshot
 * or limit error in its rollout, and Claude Code's limit refusal in its
 * transcript. New activity from the agent after the stop ends it; the
 * reset time, when the record has one, is the caller's to compare.
 */
export function usageStopFromRecords(
  agent: string,
  records: readonly RecordValue[],
): AgentUsageStop | null {
  if (agent === "codex") return codexUsageStop(records);
  if (agent === "claude") return claudeUsageStop(records);
  return null;
}
