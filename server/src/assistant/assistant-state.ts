import { randomUUID } from "node:crypto";
import type {
  AssistantConfig,
  AssistantMessage,
  AssistantMention,
  AssistantMentionTarget,
  AssistantSessionSummary,
  AssistantQueuedMessage,
  AssistantChatSelection,
  AssistantWorkspace,
  AssistantWorkspaceRef,
} from "../../../shared/assistant";
import {
  ASSISTANT_MAX_THINKING,
  ASSISTANT_MAX_THINKING_STEPS,
  ASSISTANT_MAX_WORKSPACES,
  isAssistantQueue,
  isAssistantThinkingLevel,
} from "../../../shared/assistant";
import { type RecoveryTarget } from "./context";

export const MAX_CONTEXT_BYTES = 1_000_000;

// Keep the newest reasoning: drop whole early steps, then cut the start of
// the oldest step that still fits.
export function boundAssistantThinking(steps: string[]) {
  const kept: string[] = [];
  let remaining = ASSISTANT_MAX_THINKING;
  for (let index = steps.length - 1; index >= 0; index--) {
    if (remaining <= 0 || kept.length >= ASSISTANT_MAX_THINKING_STEPS) break;
    const step = steps[index]!;
    let value = step.length > remaining ? step.slice(-remaining) : step;
    // Do not start a cut step with the low half of a surrogate pair.
    if (value !== step && /^[\uDC00-\uDFFF]/.test(value))
      value = value.slice(1);
    // A step reduced to nothing by that repair counts as skipped.
    if (!value) break;
    kept.unshift(value);
    // A cut step fills the budget, even after dropping a half pair.
    remaining = value === step ? remaining - value.length : 0;
  }
  const skipped = steps.length - kept.length;
  return {
    steps: kept,
    skipped,
    truncated: skipped > 0 || kept[0] !== steps[skipped],
  };
}

export const refKey = (ref: AssistantWorkspaceRef) =>
  `${ref.connection_id}\0${ref.workspace_id}`;

export type SavedRun = {
  request_id: string;
  draft_id: string;
  config: AssistantConfig;
  text: string;
  recovery_targets: RecoveryTarget[];
  mentions?: AssistantMentionTarget[];
  /** Steers sent to this turn; a placed one has its question and reply. */
  steers?: SavedSteer[];
};

export type SavedSteer = {
  request_id: string;
  text: string;
  message_id?: string;
  draft_id?: string;
};

/** The scope stays on the bridge so a follow-up is admitted as it was sent. */
export type QueuedMessage = AssistantQueuedMessage & {
  scope?: AssistantWorkspaceRef[];
  selection?: Omit<AssistantChatSelection, "instance_id">;
};

export const MAX_STEERS = 8;

export function savedSteers(value: unknown): SavedSteer[] {
  if (!Array.isArray(value) || value.length > MAX_STEERS)
    throw new Error("Invalid saved steers");
  return value.map((steer) => {
    if (!steer || typeof steer !== "object")
      throw new Error("Invalid saved steers");
    const { message_id, draft_id } = steer as Record<string, unknown>;
    if ((message_id === undefined) !== (draft_id === undefined))
      throw new Error("Invalid saved steers");
    return {
      request_id: string(steer.request_id, "request identifier"),
      text: string(steer.text, "saved prompt", MAX_CONTEXT_BYTES),
      ...(message_id === undefined
        ? {}
        : {
            message_id: string(message_id, "message identifier"),
            draft_id: string(draft_id, "draft identifier"),
          }),
    };
  });
}

export function queuedSelection(value: unknown): QueuedMessage["selection"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid queued model selection");
  const selection = value as Record<string, unknown>;
  if (!["assistant", "pi"].includes(String(selection.credential_source)))
    throw new Error("Invalid queued credential source");
  const checked = config({ ...selection, allowed_workspaces: [] });
  return {
    provider: checked.provider,
    model: checked.model,
    credential_source: checked.credential_source,
    ...(checked.thinking_level
      ? { thinking_level: checked.thinking_level }
      : {}),
  };
}

export function savedQueue(value: unknown): QueuedMessage[] {
  if (value === undefined) return [];
  if (!isAssistantQueue(value)) throw new Error("Invalid saved queue");
  return value.map((item) => {
    const scope = (item as QueuedMessage).scope;
    return {
      ...item,
      ...(scope === undefined ? {} : { scope: refs(scope, true) }),
      selection: queuedSelection((item as QueuedMessage).selection),
    };
  });
}

export function mentionTargetKey(target: AssistantMentionTarget) {
  return JSON.stringify([
    target.kind,
    refKey(target),
    ...(target.kind === "agent"
      ? [target.pane_id, target.terminal_id, target.agent_identity]
      : []),
  ]);
}

export function mentionTargets(
  mentions: AssistantMention[],
): AssistantMentionTarget[] {
  const targets = mentions.map((mention) => {
    const target: AssistantMentionTarget & { start?: number; end?: number } = {
      ...mention,
    };
    delete target.start;
    delete target.end;
    return target;
  });
  return [
    ...new Map(
      targets.map((target) => [
        JSON.stringify([mentionTargetKey(target), target.runtime_generation]),
        target,
      ]),
    ).values(),
  ];
}

export function restoredMentions(
  targets: AssistantMentionTarget[],
  captured: AssistantWorkspace[],
): AssistantMentionTarget[] {
  return targets.map((target) => {
    const workspace = captured.find((ref) => refKey(ref) === refKey(target));
    if (!workspace)
      throw new Error("A referenced object is outside the Ranger scope.");
    return { ...target, runtime_generation: workspace.runtime_generation };
  });
}

/**
 * Whether two Ranger configurations are the same, whatever the order of
 * their fields: a configuration saved after a permission change keeps its
 * fields in another order than one read back from disk.
 */
export function sameAssistantConfig(a: AssistantConfig, b: AssistantConfig) {
  try {
    return (
      JSON.stringify(config(a as Record<string, unknown>)) ===
      JSON.stringify(config(b as Record<string, unknown>))
    );
  } catch {
    return false;
  }
}

export function sessionSummary(
  id: string = randomUUID(),
  messages: AssistantMessage[] = [],
): AssistantSessionSummary {
  const first = messages.find((message) => message.role === "user");
  const now = new Date().toISOString();
  return {
    id,
    title:
      first?.text.trim().split(/\r?\n/, 1)[0]?.trim().slice(0, 72) ||
      "New chat",
    created_at:
      first && Number.isFinite(Date.parse(first.sent_at)) ? first.sent_at : now,
    updated_at: now,
    message_count: messages.length,
  };
}

export function string(value: unknown, name: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`Invalid ${name}`);
  return value;
}

export function refs(
  value: unknown,
  transient = false,
): AssistantWorkspaceRef[] {
  if (!Array.isArray(value) || value.length > ASSISTANT_MAX_WORKSPACES)
    throw new Error("Invalid workspace scope");
  const result = value.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new Error("Invalid workspace scope");
    if (
      transient &&
      (!Number.isSafeInteger(entry.runtime_generation) ||
        entry.runtime_generation < 0)
    )
      throw new Error("Refresh the Ranger workspace scope before sending");
    return {
      ...(transient ? { runtime_generation: entry.runtime_generation } : {}),
      connection_id: string(entry.connection_id, "connection identifier"),
      workspace_id: string(entry.workspace_id, "workspace identifier"),
    };
  });
  if (new Set(result.map(refKey)).size !== result.length)
    throw new Error("Duplicate workspace scope");
  return result;
}

export function config(value: Record<string, unknown>): AssistantConfig {
  if (
    value.credential_source !== "assistant" &&
    value.credential_source !== "pi"
  )
    throw new Error("Invalid credential source");
  if (
    value.approval_mode !== undefined &&
    value.approval_mode !== "manual" &&
    value.approval_mode !== "auto"
  )
    throw new Error("Invalid approval mode");
  if (value.workspace_scope !== undefined && value.workspace_scope !== "all")
    throw new Error("Invalid workspace permission mode");
  if (
    value.thinking_level !== undefined &&
    !isAssistantThinkingLevel(value.thinking_level)
  )
    throw new Error("Invalid thinking effort");
  return {
    ...(value.thinking_level !== undefined
      ? { thinking_level: value.thinking_level }
      : {}),
    provider: value.provider === "" ? "" : string(value.provider, "provider"),
    model: value.model === "" ? "" : string(value.model, "model"),
    credential_source: value.credential_source,
    allowed_workspaces: refs(value.allowed_workspaces),
    ...(value.workspace_scope === "all"
      ? { workspace_scope: "all" as const }
      : {}),
    ...(value.approval_mode !== undefined
      ? { approval_mode: value.approval_mode }
      : {}),
  };
}
