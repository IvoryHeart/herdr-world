import type { AtifStep, SessionFile } from "./session-types";
import {
  cleanMessageText,
  isRecord,
  messageTime,
  stringValue,
  textFromContent,
} from "./session-utils";
import { tokenUsageForRecord, tokenUsageToMetrics } from "./token-usage";
import {
  modelNameFromRecord,
  createTrajectory,
  toolOutputText,
  toolArguments,
} from "./trajectory-common";

export const CLAUDE_COMPACTED = "Conversation compacted";

export const CLAUDE_TASK_NOTIFICATION = "Background task update";

export function isClaudePrompt(record: Record<string, unknown>) {
  if (record.type !== "user" || record.isMeta === true) return false;
  const message = isRecord(record.message) ? record.message : record;
  return !(
    Array.isArray(message.content) &&
    message.content.some(
      (part) => isRecord(part) && part.type === "tool_result",
    )
  );
}

/**
 * Records on branches the user abandoned. Rewinding to edit a prompt writes
 * the new prompt as another child of the same parent, so every earlier
 * sibling prompt and everything after it is dead. Parallel tool calls also
 * fork the tree, but never into two prompts, so they are kept.
 */
export function abandonedClaudeRecords(records: Record<string, unknown>[]) {
  const children = new Map<string, Record<string, unknown>[]>();
  for (const record of records) {
    const parent = stringValue(record.parentUuid);
    if (!parent || !stringValue(record.uuid)) continue;
    const list = children.get(parent);
    if (list) list.push(record);
    else children.set(parent, [record]);
  }
  const abandoned = new Set<string>();
  for (const siblings of children.values()) {
    const stack = siblings.filter(isClaudePrompt).slice(0, -1);
    while (stack.length) {
      const record = stack.pop()!;
      const id = stringValue(record.uuid);
      if (abandoned.has(id)) continue;
      abandoned.add(id);
      stack.push(...(children.get(id) ?? []));
    }
  }
  return abandoned;
}

export type ClaudeQueued = { content: string };

/**
 * A queued message as Claude Code may write it again when it takes it out:
 * another session's message loses attributes of its tag (hop-chain).
 */
export function queuedKey(content: string) {
  const tag = /^\s*<([a-z-]+)[\s>]/i.exec(content);
  return tag
    ? `${tag[1]}\u0000${content.slice(content.indexOf(">") + 1)}`
    : content;
}

/** Takes the queued message written as `content` out; false if none is. */
export function takeQueued(queue: ClaudeQueued[], content: string): boolean {
  let at = queue.findIndex((queued) => queued.content === content);
  if (at < 0) {
    const key = queuedKey(content);
    at = queue.findIndex((queued) => queuedKey(queued.content) === key);
  }
  if (at < 0) return false;
  queue.splice(at, 1);
  return true;
}

/**
 * A user record ends the wait of the queued message it shows, with or
 * without a dequeue before it, so a message is never both the user's and
 * queued. The dequeues before it take what it shows (several messages may
 * go as one turn), else the oldest, as a guess.
 */
export function dequeueQueued(
  queue: ClaudeQueued[],
  dequeued: number,
  text: string,
) {
  let left = takeQueued(queue, text) ? dequeued - 1 : dequeued;
  const words = text.replace(/\s+/g, " ").trim();
  for (; left > 0; left--) {
    const at = queue.findIndex((queued) => {
      const content = queued.content.replace(/\s+/g, " ").trim();
      return !!content && words.includes(content);
    });
    queue.splice(Math.max(at, 0), 1);
  }
}

export function projectClaudeTrajectory(
  file: SessionFile,
  records: Record<string, unknown>[],
) {
  const steps: Omit<AtifStep, "step_id">[] = [];
  const abandoned = abandonedClaudeRecords(records);
  // Claude's queue of messages sent while it works: enqueue adds, remove
  // takes one it absorbed mid-turn (shown below as a queued command),
  // dequeue takes one for a new turn (a user record), popAll (one record
  // per message) gives them back to the prompt, on Up. What is left still
  // waits. Task notifications and other sessions' messages queue too: kept,
  // not shown. A dequeue does not say which it takes, nor always the
  // oldest: the turn's user record that follows does (dequeueQueued).
  const queue: { content: string; timestamp: string; shown: boolean }[] = [];
  let dequeued = 0;
  records.forEach((record, index) => {
    const timestamp = messageTime(record, file.mtimeMs, index);
    const type = stringValue(record.type);
    if (type === "queue-operation") {
      const content = stringValue(record.content);
      switch (stringValue(record.operation)) {
        case "enqueue":
          queue.push({
            content,
            timestamp,
            shown: !!content.trim() && !/^\s*<[a-z-]+[\s>]/i.test(content),
          });
          break;
        case "remove":
        case "popAll":
          takeQueued(queue, content);
          break;
        case "dequeue":
          dequeued += 1;
          break;
      }
      return;
    }
    // What the user sends while the agent works reaches it as a queued
    // command, not a user record. Task notifications and other sessions'
    // messages come the same way; only the user's own are shown.
    if (type === "attachment") {
      const attachment = isRecord(record.attachment) ? record.attachment : {};
      const origin = isRecord(attachment.origin) ? attachment.origin : {};
      if (attachment.type !== "queued_command" || origin.kind !== "human")
        return;
      const text = cleanMessageText(textFromContent(attachment.prompt));
      if (text)
        steps.push({
          timestamp,
          source: "user",
          message: text,
          extra: { record_type: "queued_command" },
        });
      return;
    }
    if (type !== "user" && type !== "assistant" && type !== "system") return;
    // Caveats for local commands, subagent sidechains and rewound branches
    // are not the conversation the user sees.
    if (
      record.isMeta === true ||
      record.isSidechain === true ||
      abandoned.has(stringValue(record.uuid))
    )
      return;
    // Claude Code reports background task updates as user turns.
    if (
      type === "user" &&
      /^\s*<task-notification>/.test(
        textFromContent(
          (isRecord(record.message) ? record.message : record).content,
        ),
      )
    ) {
      steps.push({
        timestamp,
        source: "agent",
        message: CLAUDE_TASK_NOTIFICATION,
        extra: { notice: "task_notification", record_type: type },
      });
      return;
    }
    if (record.isCompactSummary === true) {
      steps.push({
        timestamp,
        source: "agent",
        message: CLAUDE_COMPACTED,
        extra: { notice: "compaction", record_type: type },
      });
      return;
    }
    const message = isRecord(record.message) ? record.message : record;
    const role = stringValue(message.role) || type;
    const text = cleanMessageText(
      textFromContent(message.content ?? record.content),
    );
    const usage = tokenUsageForRecord(record).usage;
    const parts = Array.isArray(message.content)
      ? message.content.filter(isRecord)
      : [];
    if (
      type === "user" &&
      record.isMeta !== true &&
      !parts.some(
        (part) => part.type === "tool_use" || part.type === "tool_result",
      )
    ) {
      dequeueQueued(
        queue,
        dequeued,
        textFromContent(message.content ?? record.content),
      );
      dequeued = 0;
    }
    // Turns Claude Code writes itself (notes on an image a tool read, and the
    // like) are flagged meta: not the user's words.
    if (
      record.isMeta === true &&
      !parts.some(
        (part) => part.type === "tool_use" || part.type === "tool_result",
      )
    )
      return;
    if (
      parts.some(
        (part) => part.type === "tool_use" || part.type === "tool_result",
      )
    ) {
      const start = steps.length;
      for (const part of parts) {
        if (part.type === "tool_use") {
          const name = stringValue(part.name) || "tool";
          steps.push({
            timestamp,
            source: "agent",
            message: `Tool call: ${name}`,
            tool_calls: [
              {
                tool_call_id:
                  stringValue(part.id) || `${index}:${steps.length}`,
                function_name: name,
                arguments: toolArguments(part.input),
              },
            ],
          });
        } else if (part.type === "tool_result") {
          const content = toolOutputText(part.content);
          steps.push({
            timestamp,
            source: "system",
            message: content || "Tool result",
            observation: {
              results: [
                {
                  source_call_id: stringValue(part.tool_use_id),
                  content:
                    content || (part.is_error ? "Tool failed" : "Tool result"),
                  extra: { is_error: part.is_error === true || undefined },
                },
              ],
            },
          });
        } else if (
          part.type === "text" &&
          cleanMessageText(stringValue(part.text)) &&
          // Claude Code's note on an image a tool read, not the user's words.
          !/^\[Image: original \d+x\d+/.test(stringValue(part.text))
        ) {
          steps.push({
            timestamp,
            source: role === "user" ? "user" : "agent",
            message: cleanMessageText(stringValue(part.text)),
          });
        } else if (
          part.type === "thinking" &&
          stringValue(part.thinking).trim()
        ) {
          steps.push({
            timestamp,
            source: "agent",
            message: "Reasoning",
            reasoning_content: stringValue(part.thinking),
          });
        }
      }
      if (steps.length > start) {
        const lastStep = steps[steps.length - 1];
        lastStep.metrics = tokenUsageToMetrics(usage);
        lastStep.extra = {
          ...lastStep.extra,
          record_type: type,
          model: modelNameFromRecord(record) || undefined,
        };
      }
      return;
    }
    if (!text && !usage) return;
    steps.push({
      timestamp,
      source:
        role === "user" ? "user" : role === "assistant" ? "agent" : "system",
      message: text || "Token usage",
      metrics: tokenUsageToMetrics(usage),
      extra: {
        record_type: type,
        model: modelNameFromRecord(record) || undefined,
        // The summary Claude Code writes when it compacts the conversation.
        compact_summary: record.isCompactSummary === true || undefined,
      },
    });
  });
  // Taken for a turn not written yet: the oldest, as a guess, until it is.
  queue.splice(0, dequeued);
  for (const { content, timestamp, shown } of queue) {
    const text = shown ? cleanMessageText(content) : "";
    if (text)
      steps.push({
        timestamp,
        source: "user",
        message: text,
        extra: { record_type: "queue-operation", queued: true },
      });
  }
  return createTrajectory("claude", file, records, steps);
}
