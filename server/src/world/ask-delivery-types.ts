import type { CliActor } from "./world-ledger";

/** Only this record-delivery verb is queueable; generic Chat/terminal sends are not. */
export const ANSWER_DELIVERY_VERB = {
  name: "world.ask.deliver-answer",
  version: 1,
  queueable: true,
  recovery: "opaque",
} as const;
export const ANSWER_DELIVERY_DELAY_MS = 3000;
export type ChatAnswerRecipient = {
  adapter: "herdr" | "herdr-core";
  connection_id: string;
  pane_id: string;
  terminal_id: string;
  reported: {
    scheme: "herdr-reported-v1" | "core-occupant-v1";
    fingerprint: string;
  };
  conversation: {
    scheme: "reported-v1" | "codex-title-v1" | "core-recipient-v1";
    fingerprint: string;
  };
  captured_at: number;
  service_incarnation: string;
  connection_generation: number;
};
/**
 * A herdr-core asker (P4, M5): bound to its program, not a transcript.
 * `reported` holds the occupant fingerprint the verified caller had
 * (`coreOccupantFingerprint`: core, address, pid, argv, template and occupancy), so a kept
 * terminal's replacement shell, even one reusing the pid, is another asker.
 * World sends saved answers only to this original program and foreground;
 * `ask get`/`--wait` remain available when delivery cannot be established.
 */
export type CoreAnswerRecipient = {
  adapter: "herdr-core";
  connection_id: string;
  pane_id: string;
  terminal_id: string;
  core_id: string;
  pid: number;
  foreground: { pid: number; name: string };
  reported: { scheme: "herdr-core-occupant-v1"; fingerprint: string };
  captured_at: number;
  service_incarnation: string;
  connection_generation: number;
};
export type AnswerRecipient = ChatAnswerRecipient | CoreAnswerRecipient;
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
const HEX64 = /^[a-f0-9]{64}$/;
const CORE_ADDRESS = /^t[1-9][0-9]{0,9}$/;
function validCoreRecipient(
  value: AnswerRecipient | null | undefined,
): value is CoreAnswerRecipient {
  return Boolean(
    value &&
      value.adapter === "herdr-core" &&
      "core_id" in value &&
      typeof value.connection_id === "string" &&
      value.connection_id.length > 0 &&
      typeof value.pane_id === "string" &&
      CORE_ADDRESS.test(value.pane_id) &&
      value.terminal_id === value.pane_id &&
      typeof value.core_id === "string" &&
      value.core_id.length > 0 &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 0 &&
      Number.isSafeInteger(value.foreground?.pid) &&
      typeof value.foreground?.name === "string" &&
      value.reported?.scheme === "herdr-core-occupant-v1" &&
      typeof value.reported.fingerprint === "string" &&
      HEX64.test(value.reported.fingerprint),
  );
}
export function herdrRecipient(
  value: AnswerRecipient | null | undefined,
): value is ChatAnswerRecipient {
  return Boolean(
    value &&
      "conversation" in value &&
      ["herdr", "herdr-core"].includes(value.adapter) &&
      [value.connection_id, value.pane_id, value.terminal_id].every(
        (part) => typeof part === "string" && part.length > 0,
      ) &&
      value.reported?.scheme ===
        (value.adapter === "herdr-core"
          ? "core-occupant-v1"
          : "herdr-reported-v1") &&
      typeof value.reported.fingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(value.reported.fingerprint) &&
      (value.adapter === "herdr-core"
        ? value.conversation?.scheme === "core-recipient-v1"
        : ["reported-v1", "codex-title-v1"].includes(
            value.conversation?.scheme,
          )) &&
      typeof value.conversation.fingerprint === "string" &&
      (value.adapter === "herdr-core"
        ? /^[a-f0-9]{64}\.[a-f0-9]{32}$/
        : /^[a-f0-9]{64}$/
      ).test(value.conversation.fingerprint),
  );
}
export function validRecipient(
  value: AnswerRecipient | null | undefined,
): value is AnswerRecipient {
  return herdrRecipient(value) || validCoreRecipient(value);
}
export function sameRecipient(
  left: AnswerRecipient | null | undefined,
  right: AnswerRecipient | null | undefined,
) {
  return Boolean(
    validRecipient(left) &&
      validRecipient(right) &&
      left.adapter === right.adapter &&
      left.connection_id === right.connection_id &&
      left.pane_id === right.pane_id &&
      left.terminal_id === right.terminal_id &&
      left.reported.fingerprint === right.reported.fingerprint &&
      ("conversation" in left && "conversation" in right
        ? left.conversation.scheme === right.conversation.scheme &&
          left.conversation.fingerprint === right.conversation.fingerprint
        : "core_id" in left &&
          "core_id" in right &&
          left.core_id === right.core_id &&
          left.pid === right.pid),
  );
}
export function originalAsker(
  recipient: AnswerRecipient | null | undefined,
  actor: CliActor,
) {
  return Boolean(
    validRecipient(recipient) &&
      actor.verified &&
      (recipient.adapter !== "herdr-core" ||
        actor.connection_generation === recipient.connection_generation) &&
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
  if (
    recipient &&
    typeof recipient === "object" &&
    (recipient as { reported?: { scheme?: unknown } }).reported?.scheme ===
      "herdr-core-occupant-v1"
  )
    return (
      fields(recipient, [
        "adapter",
        "connection_id",
        "pane_id",
        "terminal_id",
        "core_id",
        "pid",
        "foreground",
        "reported",
        "captured_at",
        "service_incarnation",
        "connection_generation",
      ]) &&
      fields(recipient.reported, ["scheme", "fingerprint"]) &&
      fields(recipient.foreground, ["pid", "name"]) &&
      validCoreRecipient(recipient as AnswerRecipient) &&
      Number.isSafeInteger(recipient.captured_at) &&
      Number.isSafeInteger(recipient.connection_generation) &&
      typeof recipient.service_incarnation === "string" &&
      Boolean(recipient.service_incarnation)
    );
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
