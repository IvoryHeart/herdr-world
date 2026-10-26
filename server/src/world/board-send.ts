/**
 * Send a Board note to the agent in one exact pane. Only ever on the user's
 * Send. Before anything is sent the pane must still hold the terminal the
 * string witnessed and the agent the string was made for (its recipient),
 * and the runtime must be the one the request was made against. A different
 * agent in the same pane is sent the note only when the user confirms that
 * agent. The prompt is sent once and never retried.
 */

import { readPaneRecipient, matchesRecipient } from "./board-recipient";
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
  /** The agent the string was made for; absent for an older string. */
  recipient?: string;
  /** A replacement agent the user confirmed sending to instead. */
  confirm_recipient?: string;
  isCurrent: () => boolean;
};

export type SendNoteOutcome =
  | {
      status: "sent";
      agent: string;
      /** Record this on the string: a confirmed new agent, or a newer token. */
      recipient?: string;
    }
  | {
      status: "refused";
      reason: "stale" | "changed" | "no_agent" | "blocked" | "empty";
      message: string;
    }
  | {
      /** Another agent (or one Board never identified) is in the pane. */
      status: "refused";
      reason: "replaced" | "unbound";
      message: string;
      /** Confirm this agent to send to it. */
      recipient: string;
      agent: string;
    }
  | { status: "failed"; message: string };

const MAX_TEXT = 4_000;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const refuse = (
  reason: "stale" | "changed" | "no_agent" | "blocked" | "empty",
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
  // Which agent is there now. Herdr cannot hold the pane between this check
  // and the prompt, so the recipient is read again after the prompt too.
  let before: Awaited<ReturnType<typeof readPaneRecipient>>;
  try {
    before = await readPaneRecipient(call, request.pane_id);
  } catch {
    before = { none: "unverified" };
  }
  if ("none" in before)
    return before.none === "no_agent"
      ? refuse("no_agent", "No agent is running in that pane.")
      : refuse(
          "changed",
          "That pane is no longer the one this note is strung to.",
        );
  if (before.terminal_id !== request.terminal_id)
    return refuse(
      "changed",
      "That pane is no longer the one this note is strung to.",
    );
  const intended = matchesRecipient(request.recipient, before.token);
  if (!intended && !matchesRecipient(request.confirm_recipient, before.token))
    return {
      status: "refused",
      reason: request.recipient ? "replaced" : "unbound",
      message: request.recipient
        ? `${before.label} is now in that pane, not the agent this note was strung to. Nothing was sent.`
        : `Board has not confirmed which agent this note is for. Nothing was sent.`,
      recipient: before.token,
      agent: before.label,
    };
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
    let after: Awaited<ReturnType<typeof readPaneRecipient>> | null;
    try {
      after = await readPaneRecipient(call, request.pane_id);
    } catch {
      after = null;
    }
    if (
      !after ||
      "none" in after ||
      !matchesRecipient(before.token, after.token)
    )
      return {
        status: "failed",
        message:
          "The agent in that pane changed while the note was being sent, so it may have reached another agent. Check the pane before sending again.",
      };
    // A confirmed replacement becomes the string's recipient; the same agent
    // keeps its newest token (it may have reported a session since).
    const latest = after.token;
    return {
      status: "sent",
      agent: before.label,
      ...(intended && latest === request.recipient
        ? {}
        : { recipient: latest }),
    };
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
): { text: string; end: "from" | "to"; recipient?: string } | SendNoteOutcome {
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
  const index = ends.findIndex(
    (end) =>
      "anchor" in end &&
      end.anchor.kind === "pane" &&
      end.anchor.connection_id === link.connection_id &&
      end.anchor.native_id === link.pane_id &&
      end.anchor.witness.includes(link.terminal_id),
  );
  const pane = ends[index];
  if (!noted || !pane || !("anchor" in pane))
    return refuse(
      "changed",
      "The note is no longer strung to that agent; nothing was sent.",
    );
  return {
    text: note.text,
    end: index === 0 ? "from" : "to",
    ...(pane.anchor.recipient ? { recipient: pane.anchor.recipient } : {}),
  };
}
