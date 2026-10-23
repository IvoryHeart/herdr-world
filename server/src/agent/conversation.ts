import type { ConversationDelivery } from "./conversation-delivery";
import type { PendingPrompt } from "./pending-prompt";
import type { ConversationIdentity } from "./conversation-watch";
import type { HistoryEntry } from "./session-history";

// The conversation read model is the one contract Chat and other consumers
// (briefings, docks) read. A source owns how it finds a conversation; Herdr
// is the first source, and another runtime (ACP, say) can implement the same
// interface without changing consumers.

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  /**
   * `activity` summarises a run of tool calls between two messages; `notice`
   * marks an event in the conversation, such as a compaction.
   */
  kind: "message" | "error" | "activity" | "notice";
  text: string;
  sent_at: string;
  tools?: { name: string; calls: number }[];
  failed?: number;
};

export type ConversationUnavailableReason =
  | "no_agent"
  | "unsupported_harness"
  | "unsupported_platform"
  | "remote_lookup"
  | "no_session"
  | "codex_unlinked"
  | "no_messages_yet"
  | "ambiguous"
  | "file_missing"
  | "read_failed";

/**
 * How the shown session is tied to the pane: `reported` by the harness's
 * Herdr integration, named in the pane's Codex `title`, or `guessed` from the
 * pane's directory. Only a reported or titled conversation can be sent to.
 */
export type ConversationBinding = "reported" | "title" | "guessed" | null;

export type Conversation = {
  conversation_version: 1;
  source: string;
  pane_id: string;
  agent: string | null;
  agent_status: string | null;
  session_binding: ConversationBinding;
  /** The bound session; null for a guess. Send refuses when it changes. */
  session_fingerprint: string | null;
  /** A plain name for the session shown, such as "claude session <id>". */
  session_label: string | null;
  updated_at: string | null;
  messages: ConversationMessage[];
  latest: ConversationMessage | null;
  /**
   * Messages Chat sent from this pane that are not yet settled: pending ones
   * belong to the conversation whose fingerprint they carry; misdelivered and
   * unverified ones are notices for the pane until dismissed.
   */
  deliveries: ConversationDelivery[];
  /**
   * The question the agent is waiting on, read from its screen while Herdr
   * reports it blocked; null otherwise.
   */
  pending_prompt: PendingPrompt | null;
} & (
  | { status: "ok"; unavailable: null }
  | {
      status: "unavailable";
      unavailable: {
        reason: ConversationUnavailableReason;
        detail: string;
        command?: string;
        issue?: string;
      };
    }
);

export type ConversationLatest = Omit<Conversation, "messages">;

export type ConversationSendResult =
  | { status: "sent"; delivery: ConversationDelivery }
  | {
      status: "refused";
      reason:
        | "changed"
        | "blocked"
        | "unavailable"
        | "empty"
        | "command"
        | "unsettled";
      message: string;
    };

export type ConversationTarget = { pane_id: string };

/**
 * What kept an answer from being acknowledged: Herdr no longer reports the
 * agent, the pane has another session, the screen could not be read, or the
 * same question still shows.
 */
export type AnswerUnconfirmedReason =
  | "agent_missing"
  | "session_changed"
  | "unreadable"
  | "still_showing";

export type ConversationAnswerResult =
  | {
      /** The key was pressed in the pane. */
      status: "sent";
      key: string;
      number: string;
      label: string;
      /**
       * Herdr showed this agent move on from this prompt after the key: the
       * same session, and a status other than blocked or a new question.
       */
      acknowledged: boolean;
      /** Why the answer is not acknowledged; null when it is. */
      unconfirmed_reason: AnswerUnconfirmedReason | null;
      prompt_fingerprint: string;
    }
  | {
      status: "refused";
      reason: "not_blocked" | "changed" | "unknown_option";
      message: string;
      pending_prompt: PendingPrompt | null;
    };

export interface ConversationSource {
  readonly id: string;
  read(target: ConversationTarget): Promise<Conversation>;
  latest(target: ConversationTarget): Promise<ConversationLatest>;
  /** A cheap key for change notification, without reading the transcript. */
  identity(target: ConversationTarget): Promise<ConversationIdentity>;
  /** Latest for the named panes, or for every agent the source sees. */
  latestAll(paneIds?: readonly string[]): Promise<ConversationLatest[]>;
  send(
    target: ConversationTarget & {
      text: string;
      session_fingerprint: string;
      /** IDs of the user messages Chat showed; saves a reread over SSH. */
      baseline?: readonly string[];
    },
  ): Promise<ConversationSendResult>;
  /** Forget a delivery notice the user has seen. */
  dismiss(target: ConversationTarget & { delivery_id: string }): boolean;
  /**
   * Answer the agent's pending prompt by pressing one option's key, only if
   * the agent is still blocked on that same prompt.
   */
  answer(
    target: ConversationTarget & { key: string; prompt_fingerprint: string },
  ): Promise<ConversationAnswerResult>;
}

function plural(name: string, calls: number) {
  return calls > 1 ? `${name} ×${calls}` : name;
}

/**
 * Turn History entries into conversation messages: user and assistant text
 * stays, errors stay, and each run of tool calls and results between them
 * becomes one activity line that names the tools.
 */
export function conversationMessages(
  entries: readonly HistoryEntry[],
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  let activity: ConversationMessage | null = null;
  const counts = new Map<string, number>();
  const close = () => {
    if (!activity) return;
    // Results without a recorded call (a cut window) still count as one.
    if (counts.size === 0) counts.set("tool", 1);
    activity.tools = [...counts].map(([name, calls]) => ({ name, calls }));
    activity.text = `Used ${[...counts].map(([name, calls]) => plural(name, calls)).join(", ")}`;
    messages.push(activity);
    activity = null;
    counts.clear();
  };
  for (const entry of entries) {
    if (entry.role === "tool") {
      activity ??= {
        id: entry.id,
        role: "tool",
        kind: "activity",
        text: "",
        sent_at: entry.sent_at,
        tools: [],
        failed: 0,
      };
      if (entry.kind === "tool_call") {
        const name = entry.tool_name || "tool";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      } else if (entry.is_error) {
        activity.failed = (activity.failed ?? 0) + 1;
      }
      continue;
    }
    close();
    messages.push({
      id: entry.id,
      role: entry.role,
      kind:
        entry.kind === "error" ? "error" : entry.notice ? "notice" : "message",
      text: entry.text,
      sent_at: entry.sent_at,
    });
  }
  close();
  return messages;
}

export function latestAssistantMessage(
  messages: readonly ConversationMessage[],
) {
  return (
    messages.findLast(
      (message) => message.role === "assistant" && message.kind === "message",
    ) ?? null
  );
}
