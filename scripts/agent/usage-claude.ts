import type {
  ParsedSession,
  Seat,
  Turn,
  UsageEvent,
  UsageGap,
} from "./usage-records";
import {
  decodeRecords,
  isoTimestamp,
  prMentions,
  textContent,
} from "./usage-content";
import { reconcileEvents } from "./usage-reconcile";

function count(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error("Invalid recorded token count");
  return value as number;
}
export function parseClaudeSession(seat: Seat, lines: string): ParsedSession {
  const events = new Map<string, UsageEvent>();
  const turns: Turn[] = [];
  const gaps: UsageGap[] = [];
  const claimedPrs = new Set<number>();
  let incompleteRecords = 0,
    estimateBlocked = false;
  let lastKnown: string | undefined, openGap: UsageGap | undefined;
  let model = "unknown",
    effort = "unknown";
  const remember = (at: string) => {
    if (!lastKnown || at > lastKnown) lastKnown = at;
  };
  const quarantine = () => {
    incompleteRecords++;
    estimateBlocked = true;
    if (!openGap && lastKnown) {
      openGap = { from: new Date(Date.parse(lastKnown) + 1).toISOString() };
      gaps.push(openGap);
      turns.push({ at: openGap.from, text: "" });
    }
  };
  for (const record of decodeRecords(lines, "claude")) {
    if (record === null) {
      quarantine();
      continue;
    }
    const payload = record.payload ?? {};
    if (record.type === "turn_context" || record.type === "session_meta") {
      model = payload.model ?? model;
      effort =
        payload.effort ??
        payload.reasoning_effort ??
        payload.reasoning?.effort ??
        effort;
    }
    const message = record.message;
    if (record.type === "user" && !record.isMeta) {
      const text = textContent(message?.content);
      for (const pr of prMentions(text)) claimedPrs.add(pr);
      try {
        if (
          !message ||
          (typeof message.content !== "string" &&
            !Array.isArray(message.content))
        )
          throw new Error("Invalid Claude prompt");
        if (
          Array.isArray(message.content) &&
          message.content.some(
            (part: any) =>
              (part?.type === "text" || part?.type === "input_text") &&
              typeof part.text !== "string",
          )
        )
          throw new Error("Invalid Claude prompt text");
        const at = isoTimestamp(record.timestamp);
        if (text) {
          if (openGap) openGap.until = at;
          openGap = undefined;
          estimateBlocked = false;
          turns.push({ at, text });
        }
        remember(at);
      } catch {
        quarantine();
      }
      continue;
    }
    if (record.type === "assistant") {
      try {
        if (!message || typeof message !== "object" || Array.isArray(message))
          throw new Error("Invalid Claude assistant message");
        const at = isoTimestamp(record.timestamp);
        if (message.usage === undefined || message.usage === null) {
          remember(at);
          continue;
        }
        if (
          typeof message.id !== "string" ||
          !message.id ||
          !message.usage ||
          typeof message.usage !== "object" ||
          Array.isArray(message.usage)
        )
          throw new Error("Invalid Claude assistant usage");
        const usage = message.usage;
        const event: UsageEvent = {
          ...seat,
          id: message.id,
          at,
          model: message.model ?? payload.model ?? model,
          effort: payload.effort ?? payload.reasoning_effort ?? effort,
          input: count(usage.input_tokens),
          cacheRead: count(usage.cache_read_input_tokens),
          cacheWrite: count(usage.cache_creation_input_tokens),
          output: count(usage.output_tokens),
          responses: 1,
          estimateBlocked,
        };
        if (typeof event.model !== "string" || typeof event.effort !== "string")
          throw new Error("Invalid Claude usage metadata");
        const previous = events.get(event.id);
        if (previous) {
          for (const field of [
            "input",
            "cacheRead",
            "cacheWrite",
            "output",
          ] as const)
            previous[field] = Math.max(previous[field], event[field]);
          if (event.at < previous.at) {
            previous.at = event.at;
            previous.estimateBlocked = event.estimateBlocked;
          }
          if (event.model !== "unknown") previous.model = event.model;
        } else events.set(event.id, event);
        remember(at);
      } catch {
        quarantine();
      }
      continue;
    }
    // Unconsumed metadata can advance the last known time, but malformed
    // metadata fields do not masquerade as a new user prompt or measured call.
    if (
      typeof record.timestamp === "string" &&
      Number.isFinite(Date.parse(record.timestamp))
    )
      remember(new Date(record.timestamp).toISOString());
  }
  return {
    events: reconcileEvents([...events.values()]),
    turns: turns.sort((a, b) => a.at.localeCompare(b.at)),
    incompleteRecords,
    gaps,
    claimedPrs: [...claimedPrs],
  };
}
