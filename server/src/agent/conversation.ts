import type { ConversationDelivery } from "./conversation-delivery";
import type { ConversationIdentity } from "./conversation-watch";
import { stepsFromEntries, type ConversationStep } from "./conversation-steps";
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
  kind: "message" | "error" | "activity" | "notice" | "step";
  text: string;
  sent_at: string;
  tools?: { name: string; calls: number }[];
  /** For a `step`: one tool call with its evidence. */
  step?: ConversationStep;
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
  /**
   * What the harness shows as its terminal title, such as the task it is on.
   * Null when Herdr reports none.
   */
  terminal_title: string | null;
  /**
   * The tool call the agent has started and not finished: a call in the
   * transcript with no result yet. Null when none is open.
   */
  running_tool: RunningTool | null;
  updated_at: string | null;
  messages: ConversationMessage[];
  latest: ConversationMessage | null;
  /**
   * Messages Chat sent from this pane that are not yet settled: pending ones
   * belong to the conversation whose fingerprint they carry; misdelivered and
   * unverified ones are notices for the pane until dismissed.
   */
  deliveries: ConversationDelivery[];
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

export type RunningTool = {
  /** The harness's tool-call ID. */
  id: string;
  name: string;
  /** Its description, command or path, when the call names one. */
  summary: string | null;
  started_at: string;
};

const SUMMARY_FIELDS = [
  "description",
  "command",
  "file_path",
  "path",
  "pattern",
  "url",
  "query",
];

/**
 * The newest tool call with no result after it. A harness writes the call
 * when it starts and the result when it ends, so this is the step running
 * now. Reads the whole projection, not the visible window.
 */
export function runningTool(
  entries: readonly HistoryEntry[],
): RunningTool | null {
  const finished = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (!entry.source_call_id) continue;
    if (entry.kind === "tool_result") {
      finished.add(entry.source_call_id);
      continue;
    }
    if (entry.kind !== "tool_call" || finished.has(entry.source_call_id))
      continue;
    let summary: string | null = null;
    try {
      const input = JSON.parse(entry.text) as Record<string, unknown>;
      const field = SUMMARY_FIELDS.find(
        (name) => typeof input?.[name] === "string" && input[name],
      );
      if (field) summary = String(input[field]).split("\n")[0]!.slice(0, 160);
    } catch {
      // Arguments that are not JSON name nothing.
    }
    return {
      id: entry.source_call_id,
      name: entry.tool_name || "tool",
      summary,
      started_at: entry.sent_at,
    };
  }
  return null;
}

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
  /** One `step` per tool call instead of one activity line per run. */
  options: { steps?: boolean } = {},
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  if (options.steps) {
    const steps = new Map(
      stepsFromEntries(entries).map((step) => [step.id, step] as const),
    );
    for (const entry of entries) {
      if (entry.role === "tool") {
        if (entry.kind !== "tool_call") continue;
        const step = steps.get(entry.source_call_id ?? `entry:${entry.id}`);
        if (step)
          messages.push({
            id: step.id,
            role: "tool",
            kind: "step",
            text: step.label,
            sent_at: step.started_at,
            step,
          });
        continue;
      }
      messages.push({
        id: entry.id,
        role: entry.role,
        kind:
          entry.kind === "error"
            ? "error"
            : entry.notice
              ? "notice"
              : "message",
        text: entry.text,
        sent_at: entry.sent_at,
      });
    }
    return messages;
  }
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
