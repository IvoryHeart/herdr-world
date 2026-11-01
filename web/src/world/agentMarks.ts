/**
 * One set of agent marks for every view (Town, Board, Desk, Chat and the
 * phone): each state has one glyph, one colour (agentMarks.css) and one word.
 */
export type AgentMarkKind =
  | "working"
  | "needs"
  | "asks"
  | "done"
  | "reviewed"
  | "idle"
  | "no-signal"
  | "offline";

export const AGENT_MARKS: Record<
  AgentMarkKind,
  { glyph: string; word: string; means: string }
> = {
  working: { glyph: "•", word: "Working", means: "Running a turn" },
  needs: { glyph: "!", word: "Needs you", means: "Blocked on its question" },
  asks: { glyph: "?", word: "Asks you", means: "Asked you a question" },
  done: { glyph: "✓", word: "Done", means: "Finished, not reviewed yet" },
  reviewed: { glyph: "–", word: "Reviewed", means: "You reviewed its work" },
  idle: { glyph: "–", word: "Idle", means: "Nothing to do" },
  "no-signal": { glyph: "~", word: "No signal", means: "No status yet" },
  offline: { glyph: "×", word: "Offline", means: "Its host is unreachable" },
};

/**
 * The mark for an agent's Herdr status ("working", "blocked", "done",
 * "idle", anything else is no signal). An open owner question outranks the
 * status, and an unreachable host outranks both.
 */
export function agentMarkKind(
  status: string | null | undefined,
  {
    asking = false,
    offline = false,
    reviewed = false,
  }: { asking?: boolean; offline?: boolean; reviewed?: boolean } = {},
): AgentMarkKind {
  if (offline) return "offline";
  if (asking) return "asks";
  switch (status) {
    case "working":
      return "working";
    case "blocked":
      return "needs";
    case "done":
      return reviewed ? "reviewed" : "done";
    case "idle":
      return "idle";
    default:
      return "no-signal";
  }
}

/** The one word for an agent's state, as agentMarkKind decides it. */
export function agentStateWord(
  status: string | null | undefined,
  options?: Parameters<typeof agentMarkKind>[1],
) {
  return AGENT_MARKS[agentMarkKind(status, options)].word;
}
