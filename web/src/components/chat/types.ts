import type { Quest } from "../../../../server/src/agent/quest";

// Mirrors the server's conversation read model (server/src/agent/conversation.ts).
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  kind: "message" | "error" | "activity" | "notice";
  text: string;
  sent_at: string;
  tools?: { name: string; calls: number }[];
  failed?: number;
};

export type Conversation = {
  conversation_version: 1;
  pane_id: string;
  agent: string | null;
  agent_status: string | null;
  session_binding: "reported" | "title" | "guessed" | null;
  session_fingerprint: string | null;
  session_label: string | null;
  /** The harness's terminal title, such as the task it is on. */
  terminal_title?: string | null;
  /** The tool call started and not yet finished, from the transcript. */
  running_tool?: {
    id: string;
    name: string;
    summary: string | null;
    started_at: string;
  } | null;
  status: "ok" | "unavailable";
  unavailable: {
    reason: string;
    detail: string;
    command?: string;
    issue?: string;
  } | null;
  /** Only in a full read; Chat reads the summary and History's window. */
  messages?: ConversationMessage[];
  latest: ConversationMessage | null;
  /** The agent's quest: its todos, plan, goal or loop. */
  quest?: Quest | null;
  /**
   * Sends not yet seen in this conversation, sends with evidence they went
   * elsewhere, and sends Chat can no longer check.
   */
  deliveries?: ConversationDelivery[];
  /** The question a blocked agent is waiting on, read from its screen. */
  pending_prompt?: PendingPrompt | null;
};

export type PendingPrompt = {
  question: string[];
  /** The complete request asked about: a command, or a file and its edit. */
  request: string[];
  options: {
    number: string;
    label: string;
    key: string;
    description?: string;
    input?: "text" | "chat";
    active?: boolean;
  }[];
  /**
   * A multi-question form's questions by their headers, in order: the agent
   * shows one at a time, then a review that submits them all.
   */
  steps?: { label: string; answered: boolean }[];
  fingerprint: string;
};

export type AnswerResult =
  | {
      status: "sent";
      number: string;
      label: string;
      text?: string;
      acknowledged: boolean;
      unconfirmed_reason: UnconfirmedReason | null;
      prompt_fingerprint: string;
    }
  | { status: "refused"; reason: string; message: string };

// Mirrors AnswerUnconfirmedReason in server/src/agent/conversation.ts.
export type UnconfirmedReason =
  | "agent_missing"
  | "session_changed"
  | "unknown_status"
  | "unreadable"
  | "still_showing"
  | "no_progress";

export type ConversationDelivery = {
  kind?: "command";
  queued?: boolean;
  id: string;
  text: string;
  sent_at: string;
  transcript_at?: string;
  state: "pending" | "matched" | "misdelivered" | "uncertain" | "unverified";
  expected: string;
  fingerprint: string;
  matched_id?: string;
  /** How the transcript turn was matched: its words, or its order. */
  matched_by?: "words" | "order";
  delivered_to?: string;
  evidence?: "herdr" | "transcript";
  detail?: string;
};

export type SendResult =
  | { status: "sent" }
  | { status: "refused"; reason: string; message: string };
