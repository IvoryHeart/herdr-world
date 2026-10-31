import type { CliActor } from "./world-ledger";

/** Only this record-delivery verb is queueable; generic Chat/terminal sends are not. */
export const ANSWER_DELIVERY_VERB = {
  name: "world.ask.deliver-answer",
  version: 1,
  queueable: true,
  recovery: "opaque",
} as const;
export const ANSWER_DELIVERY_DELAY_MS = 3000;
export type AnswerRecipient = {
  adapter: "herdr";
  connection_id: string;
  pane_id: string;
  terminal_id: string;
  reported: { scheme: "herdr-reported-v1"; fingerprint: string };
  conversation: {
    scheme: "reported-v1" | "codex-title-v1";
    fingerprint: string;
  };
  captured_at: number;
  service_incarnation: string;
  connection_generation: number;
};
export type AnsweringAgent = Pick<
  CliActor,
  | "label"
  | "verified"
  | "connection_id"
  | "connection_generation"
  | "pane_id"
  | "terminal_id"
  | "agent_session_fingerprint"
>;
export type AnswerActor =
  | { kind: "owner" }
  | { kind: "agent"; actor: AnsweringAgent };
export function answeringAgent(actor: CliActor): AnswerActor {
  const {
    label,
    verified,
    connection_id,
    connection_generation,
    pane_id,
    terminal_id,
    agent_session_fingerprint,
  } = actor;
  return {
    kind: "agent",
    actor: {
      label,
      verified,
      connection_id,
      connection_generation,
      pane_id,
      terminal_id,
      agent_session_fingerprint,
    },
  };
}
export type AnswerIntent = {
  verb: typeof ANSWER_DELIVERY_VERB.name;
  version: number;
  origin: "world.ask.answer";
  params: { ask_id: string; answer_occurrence: string };
  actor: AnswerActor;
  condition: { awaiting_delivery: true; recipient: AnswerRecipient | null };
};
export function validRecipient(
  value: AnswerRecipient | null | undefined,
): value is AnswerRecipient {
  return Boolean(
    value &&
      value.adapter === "herdr" &&
      [value.connection_id, value.pane_id, value.terminal_id].every(
        (part) => typeof part === "string" && part.length > 0,
      ) &&
      value.reported?.scheme === "herdr-reported-v1" &&
      typeof value.reported.fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(value.reported.fingerprint) &&
      ["reported-v1", "codex-title-v1"].includes(value.conversation?.scheme) &&
      typeof value.conversation.fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(value.conversation.fingerprint),
  );
}
export function sameRecipient(
  left: AnswerRecipient | null | undefined,
  right: AnswerRecipient | null | undefined,
) {
  return Boolean(
    validRecipient(left) &&
      validRecipient(right) &&
      left.connection_id === right.connection_id &&
      left.pane_id === right.pane_id &&
      left.terminal_id === right.terminal_id &&
      left.reported.fingerprint === right.reported.fingerprint &&
      left.conversation.scheme === right.conversation.scheme &&
      left.conversation.fingerprint === right.conversation.fingerprint,
  );
}
export function originalAsker(
  recipient: AnswerRecipient | null | undefined,
  actor: CliActor,
) {
  return Boolean(
    validRecipient(recipient) &&
      actor.verified &&
      actor.connection_id === recipient.connection_id &&
      actor.pane_id === recipient.pane_id &&
      actor.terminal_id === recipient.terminal_id &&
      actor.agent_session_fingerprint === recipient.reported.fingerprint,
  );
}

const fields = (
  value: unknown,
  allowed: readonly string[],
): value is Record<string, unknown> =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => allowed.includes(key)),
  );
/** Closed payload shapes keep arbitrary message text, paths and authority out of the intent. */
export function isAnswerIntent(value: unknown): value is AnswerIntent {
  if (
    !fields(value, [
      "verb",
      "version",
      "origin",
      "params",
      "actor",
      "condition",
    ]) ||
    value.verb !== ANSWER_DELIVERY_VERB.name ||
    value.origin !== "world.ask.answer" ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !fields(value.params, ["ask_id", "answer_occurrence"]) ||
    typeof value.params.ask_id !== "string" ||
    !value.params.ask_id ||
    typeof value.params.answer_occurrence !== "string" ||
    !value.params.answer_occurrence ||
    !fields(value.condition, ["awaiting_delivery", "recipient"]) ||
    value.condition.awaiting_delivery !== true ||
    !fields(value.actor, ["kind", "actor"])
  )
    return false;
  const actor = value.actor;
  if (
    actor.kind === "owner"
      ? Object.keys(actor).length !== 1
      : actor.kind !== "agent" ||
        !fields(actor.actor, [
          "label",
          "verified",
          "connection_id",
          "connection_generation",
          "pane_id",
          "terminal_id",
          "agent_session_fingerprint",
        ]) ||
        typeof actor.actor.label !== "string" ||
        typeof actor.actor.verified !== "boolean"
  )
    return false;
  if (actor.kind === "agent") {
    const by = actor.actor as Record<string, unknown>;
    if (
      [
        by.connection_id,
        by.pane_id,
        by.terminal_id,
        by.agent_session_fingerprint,
      ].some((part) => part !== undefined && typeof part !== "string") ||
      (by.connection_generation !== undefined &&
        !Number.isSafeInteger(by.connection_generation))
    )
      return false;
  }
  const recipient = value.condition.recipient;
  if (recipient === null) return true;
  return (
    fields(recipient, [
      "adapter",
      "connection_id",
      "pane_id",
      "terminal_id",
      "reported",
      "conversation",
      "captured_at",
      "service_incarnation",
      "connection_generation",
    ]) &&
    fields(recipient.reported, ["scheme", "fingerprint"]) &&
    fields(recipient.conversation, ["scheme", "fingerprint"]) &&
    validRecipient(recipient as AnswerRecipient) &&
    Number.isSafeInteger(recipient.captured_at) &&
    Number.isSafeInteger(recipient.connection_generation) &&
    typeof recipient.service_incarnation === "string" &&
    Boolean(recipient.service_incarnation)
  );
}
