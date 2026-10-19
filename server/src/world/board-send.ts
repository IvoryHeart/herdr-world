/**
 * Send a Board note to the agent in one exact pane. Only ever on the user's
 * Send. Before anything is sent the pane must still hold the terminal the
 * string witnessed and a detected agent, and the runtime must be the one the
 * request was made against. The prompt is sent once and never retried.
 */

import type { BoardDocument } from "./board-store";

export type HerdrCall = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export type SendNoteRequest = {
  pane_id: string;
  /** A terminal the string witnessed; it changes when Herdr restarts. */
  terminal_id: string;
  text: string;
  isCurrent: () => boolean;
};

export type SendNoteOutcome =
  | { status: "sent"; agent: string }
  | {
      status: "refused";
      reason: "stale" | "changed" | "no_agent" | "blocked" | "empty";
      message: string;
    }
  | { status: "failed"; message: string };

const MAX_TEXT = 4_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const refuse = (
  reason: Extract<SendNoteOutcome, { status: "refused" }>["reason"],
  message: string,
): SendNoteOutcome => ({ status: "refused", reason, message });

export async function sendNote(
  call: HerdrCall,
  request: SendNoteRequest,
): Promise<SendNoteOutcome> {
  const text = request.text.trim();
  if (!text) return refuse("empty", "The note is empty.");
  if (text.length > MAX_TEXT)
    return refuse("empty", "The note is too long to send.");
  if (!request.isCurrent())
    return refuse(
      "stale",
      "The host reconnected. Check the string, then send again.",
    );
  let pane: Record<string, unknown> | undefined;
  try {
    const result = await call("pane.get", { pane_id: request.pane_id });
    pane = isRecord(result) && isRecord(result.pane) ? result.pane : undefined;
  } catch {
    pane = undefined;
  }
  if (
    !pane ||
    pane.pane_id !== request.pane_id ||
    pane.terminal_id !== request.terminal_id
  )
    return refuse(
      "changed",
      "That pane is no longer the one this note is strung to.",
    );
  if (!pane.agent)
    return refuse("no_agent", "No agent is running in that pane.");
  const agentResult = await call("agent.get", { target: request.pane_id });
  const agent =
    isRecord(agentResult) && isRecord(agentResult.agent)
      ? agentResult.agent
      : undefined;
  if (
    !agent ||
    agent.pane_id !== request.pane_id ||
    agent.terminal_id !== request.terminal_id
  )
    return refuse(
      "changed",
      "That pane is no longer the one this note is strung to.",
    );
  if (!request.isCurrent())
    return refuse(
      "stale",
      "The host reconnected. Check the string, then send again.",
    );
  try {
    const result = await call("agent.prompt", {
      target: request.pane_id,
      text,
    });
    const sent =
      isRecord(result) && isRecord(result.agent) ? result.agent : undefined;
    if (!sent || sent.pane_id !== request.pane_id)
      return {
        status: "failed",
        message:
          "Herdr did not confirm the prompt; check the agent before sending again.",
      };
    return { status: "sent", agent: String(agent.agent ?? "agent") };
  } catch (error) {
    // Herdr rejects a blocked agent before submitting any input.
    if (error instanceof Error && /^agent_blocked:/.test(error.message))
      return refuse(
        "blocked",
        "The agent is waiting on a question; answer it first. Nothing was sent.",
      );
    return {
      status: "failed",
      message: `The prompt may not have been sent: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The note's current text, provided the saved board still strings that note
 * to exactly this pane and the note is the revision the user sent. Another
 * client may have cut the string, or edited or deleted the note, since this
 * one drew its Send button.
 */
export function linkedNoteText(
  doc: BoardDocument,
  link: {
    connection_id: string;
    pane_id: string;
    terminal_id: string;
    note_id: string;
    string_id: string;
    note_rev: number;
  },
): { text: string } | SendNoteOutcome {
  const note = doc.notes.find((entry) => entry.id === link.note_id);
  if (!note)
    return refuse("changed", "The note was deleted; nothing was sent.");
  if (note.rev !== link.note_rev)
    return refuse(
      "changed",
      "The note changed since it was shown; check it and send again.",
    );
  const string = doc.strings.find((entry) => entry.id === link.string_id);
  const ends = string && !string.detached ? [string.from, string.to] : [];
  const noted = ends.some((end) => "note" in end && end.note === note.id);
  const pane = ends.some(
    (end) =>
      "anchor" in end &&
      end.anchor.kind === "pane" &&
      end.anchor.connection_id === link.connection_id &&
      end.anchor.native_id === link.pane_id &&
      end.anchor.witness.includes(link.terminal_id),
  );
  if (!noted || !pane)
    return refuse(
      "changed",
      "The note is no longer strung to that agent; nothing was sent.",
    );
  return { text: note.text };
}
