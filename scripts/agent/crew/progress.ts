import type { StoredRun } from "./store";
import { readTranscript, type SessionRoots } from "./worker";

/** Timestamped conversation/tool work renews a finite inactivity window.
 * Heartbeats, token counters, file writes and PID liveness do not. */
export function lastProgress(
  text: string,
  harness: string | null,
  since: number,
  now: number,
): number | null {
  if (harness !== "claude" && harness !== "codex") return null;
  let latest: number | null = null;
  for (const line of text.split("\n")) {
    try {
      const entry = JSON.parse(line);
      const at = Date.parse(entry.timestamp);
      if (!Number.isFinite(at) || at < since || at > now) continue;
      const work =
        harness === "claude"
          ? ["user", "assistant"].includes(entry.type) &&
            (typeof entry.message?.content === "string"
              ? entry.message.content.length > 0
              : Array.isArray(entry.message?.content) &&
                entry.message.content.length > 0)
          : (entry.type === "response_item" &&
              [
                "message",
                "function_call",
                "function_call_output",
                "custom_tool_call",
                "custom_tool_call_output",
                "reasoning",
              ].includes(entry.payload?.type)) ||
            (entry.type === "event_msg" &&
              ["user_message", "agent_message", "agent_reasoning"].includes(
                entry.payload?.type,
              ) &&
              typeof entry.payload?.message === "string" &&
              entry.payload.message.length > 0);
      if (work) latest = Math.max(latest ?? since, at);
    } catch {
      // Partial or unsupported records cannot renew a run.
    }
  }
  return latest;
}

export function readProgress(
  run: StoredRun,
  cwd: string,
  now: number,
  roots?: SessionRoots,
) {
  const text = readTranscript({ ...run, cwd }, roots);
  return text === null
    ? null
    : lastProgress(text, run.harness, run.startedAt, now);
}
