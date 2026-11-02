import type {
  AssistantMentionTarget,
  AssistantTaskInput,
  AssistantTaskProposal,
} from "../../../shared/assistant";
import {
  ASSISTANT_MAX_MENTIONS,
  ASSISTANT_MAX_WORKSPACES,
  isAssistantMentionTarget,
  isAssistantThinkingLevel,
} from "../../../shared/assistant";
import { AssistantUserError } from "./errors";
import { validateTaskSchedule } from "./task-schedule";
import type { PreparedTask } from "./tasks";
export const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;

export const MAX_NOTIFICATIONS = 100;

export const key = (ref: { connection_id: string; workspace_id: string }) =>
  `${ref.connection_id}\0${ref.workspace_id}`;

export type SavedProposal = {
  proposal: AssistantTaskProposal;
  prepared: PreparedTask;
};

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown, limit: number) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new AssistantUserError("Invalid task input");
  return value;
}

export function validateTaskInput(value: unknown): AssistantTaskInput {
  if (
    !record(value) ||
    Object.keys(value).some(
      (field) =>
        ![
          "title",
          "prompt",
          "scope",
          "schedule",
          "notification_mode",
          "mentions",
          "all_workspaces",
        ].includes(field),
    ) ||
    (value.all_workspaces !== undefined && value.all_workspaces !== true) ||
    (value.notification_mode !== undefined &&
      value.notification_mode !== "status" &&
      value.notification_mode !== "agent") ||
    !Array.isArray(value.scope) ||
    !value.scope.length ||
    value.scope.length > ASSISTANT_MAX_WORKSPACES
  )
    throw new AssistantUserError("Invalid task input");
  const scope = value.scope.map((ref) => {
    if (
      !record(ref) ||
      Object.keys(ref).some(
        (field) =>
          !["connection_id", "workspace_id", "runtime_generation"].includes(
            field,
          ),
      )
    )
      throw new AssistantUserError("Invalid task scope");
    return {
      connection_id: text(ref.connection_id, 500),
      workspace_id: text(ref.workspace_id, 500),
    };
  });
  if (new Set(scope.map(key)).size !== scope.length)
    throw new AssistantUserError("Duplicate task scope");
  let mentions: AssistantMentionTarget[] | undefined;
  if (value.mentions !== undefined) {
    if (
      !Array.isArray(value.mentions) ||
      value.mentions.length > ASSISTANT_MAX_MENTIONS ||
      !value.mentions.every(isAssistantMentionTarget)
    )
      throw new AssistantUserError("Invalid task mentions");
    mentions = value.mentions;
    const allowed = new Set(scope.map(key));
    if (mentions.some((mention) => !allowed.has(key(mention))))
      throw new AssistantUserError("Task mention outside task scope");
    const identities = mentions.map((mention) =>
      JSON.stringify([
        mention.kind,
        mention.connection_id,
        mention.workspace_id,
        ...(mention.kind === "agent"
          ? [mention.pane_id, mention.terminal_id]
          : []),
      ]),
    );
    if (new Set(identities).size !== identities.length)
      throw new AssistantUserError("Duplicate task mention");
  }
  return {
    title: text(value.title, 100),
    prompt: text(value.prompt, 32_000),
    scope,
    schedule: validateTaskSchedule(value.schedule),
    ...(value.notification_mode !== undefined
      ? { notification_mode: value.notification_mode }
      : {}),
    ...(mentions !== undefined ? { mentions } : {}),
    ...(value.all_workspaces ? { all_workspaces: true as const } : {}),
  };
}

export function validNotificationInput(value: unknown) {
  return (
    record(value) &&
    (value.kind === "completed" || value.kind === "attention") &&
    (
      [
        [value.event_key, 200],
        [value.title, 200],
        [value.body, 400],
      ] as const
    ).every(
      ([content, limit]) =>
        typeof content === "string" &&
        !!content.trim() &&
        content.length <= limit,
    )
  );
}

export function validNotifications(value: unknown) {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= MAX_NOTIFICATIONS &&
      value.every(
        (notification) =>
          record(notification) &&
          validNotificationInput(notification) &&
          typeof notification.run_id === "string" &&
          UUID.test(notification.run_id) &&
          typeof notification.created_at === "string" &&
          Number.isFinite(Date.parse(notification.created_at)) &&
          typeof notification.scope_key === "string" &&
          /^[a-f0-9]{64}$/.test(notification.scope_key),
      ) &&
      new Set(
        value.map((notification) =>
          JSON.stringify([notification.scope_key, notification.event_key]),
        ),
      ).size === value.length)
  );
}

export function validPrepared(value: unknown): value is PreparedTask {
  if (!record(value) || !record(value.config)) return false;
  try {
    const input = validateTaskInput(value.input);
    const refs = new Set(input.scope.map(key));
    return (
      typeof value.config.provider === "string" &&
      !!value.config.provider &&
      typeof value.config.model === "string" &&
      !!value.config.model &&
      (value.config.thinking_level === undefined ||
        isAssistantThinkingLevel(value.config.thinking_level)) &&
      ["assistant", "pi"].includes(String(value.config.credential_source)) &&
      (value.config.approval_mode === undefined ||
        value.config.approval_mode === "manual" ||
        value.config.approval_mode === "auto") &&
      Array.isArray(value.config.allowed_workspaces) &&
      value.config.allowed_workspaces.length === refs.size &&
      new Set(value.config.allowed_workspaces.map((ref) => key(ref as never)))
        .size === refs.size &&
      value.config.allowed_workspaces.every(
        (ref) => record(ref) && refs.has(key(ref as never)),
      ) &&
      Array.isArray(value.workspaces) &&
      value.workspaces.length === refs.size &&
      new Set(value.workspaces.map((ref) => key(ref as never))).size ===
        refs.size &&
      value.workspaces.every(
        (ref) =>
          record(ref) &&
          refs.has(key(ref as never)) &&
          typeof ref.label === "string" &&
          typeof ref.connection_label === "string" &&
          Number.isSafeInteger(ref.runtime_generation) &&
          Number(ref.runtime_generation) >= 0,
      ) &&
      Array.isArray(value.targets) &&
      value.targets.length === refs.size &&
      new Set(value.targets.map((target) => key(target as never))).size ===
        refs.size &&
      value.targets.every(
        (target) =>
          record(target) &&
          refs.has(key(target as never)) &&
          typeof target.endpoint_fingerprint === "string" &&
          /^[a-f0-9]{64}$/.test(target.endpoint_fingerprint) &&
          typeof target.workspace_identity === "string" &&
          /^[a-f0-9]{64}$/.test(target.workspace_identity) &&
          typeof target.herdr_boot_id === "string" &&
          !!target.herdr_boot_id &&
          target.herdr_boot_id.length <= 500,
      )
    );
  } catch {
    return false;
  }
}

export function validSavedProposal(entry: SavedProposal) {
  try {
    const proposal = entry.proposal;
    if (
      proposal.detail !== undefined &&
      (typeof proposal.detail !== "string" || proposal.detail.length > 2000)
    )
      return false;
    if (
      proposal.operation !== undefined &&
      (!["create", "update", "pause", "resume", "cancel", "delete"].includes(
        proposal.operation,
      ) ||
        (proposal.operation !== "create" && !UUID.test(proposal.task_id ?? "")))
    )
      return false;
    const input = validateTaskInput({
      title: proposal.title,
      prompt: proposal.prompt,
      scope: proposal.scope,
      schedule: proposal.schedule,
      ...(proposal.notification_mode !== undefined
        ? { notification_mode: proposal.notification_mode }
        : {}),
      ...(proposal.mentions !== undefined
        ? { mentions: proposal.mentions }
        : {}),
    });
    const expected = validateTaskInput(entry.prepared.input);
    return (
      JSON.stringify({
        ...input,
        notification_mode: input.notification_mode ?? "status",
      }) ===
      JSON.stringify({
        ...expected,
        notification_mode: expected.notification_mode ?? "status",
      })
    );
  } catch {
    return false;
  }
}
