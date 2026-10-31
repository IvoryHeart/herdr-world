import { Type } from "typebox";
import { Value } from "typebox/value";
import { ACTORS, type Verb } from "../verbs/types";
import { registeredVerb } from "../verbs/registry";
import type { LedgerAsk } from "../world/world-ledger";
import { ANSWER_DELIVERY_VERB } from "../world/ask-delivery-types";
import type { AttentionTarget, OutboxEffect } from "../storage/world-protocol";
import type { EffectContract } from "./types";

const text = Type.String({ minLength: 1, maxLength: 512 });
const object = Type.Record(Type.String(), Type.Unknown());
const target = Type.Union([
  Type.Object({ connection_id: text }, { additionalProperties: false }),
  Type.Object(
    {
      adapter: text,
      connection_id: text,
      kind: text,
      native_id: text,
      evidence: Type.Object(
        {
          terminal_id: Type.Optional(text),
          session_fingerprint: Type.Optional(text),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);
const contractSchema = Type.Object(
  {
    verb: text,
    version: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
    params: object,
    targets: Type.Array(target, { maxItems: 8 }),
    actor: Type.Object(
      {
        kind: Type.Union(ACTORS.map((actor) => Type.Literal(actor))),
        subject: text,
        evidence: object,
      },
      { additionalProperties: false },
    ),
    authorization: object,
    idempotency_key: text,
    preconditions: object,
    origin: text,
  },
  { additionalProperties: false },
);

export type EffectVerbLookup = (name: string) => Verb | undefined;
export const productionEffectVerb: EffectVerbLookup = (name) =>
  registeredVerb("effect", name);

export function validateEffectContract(
  value: unknown,
  recovery: string,
  lookup = productionEffectVerb,
): asserts value is EffectContract {
  if (!Value.Check(contractSchema, value))
    throw new Error("invalid durable effect contract");
  const contract = value as EffectContract;
  const verb = lookup(contract.verb);
  if (!verb || !verb.queueable || verb.recovery === "read")
    throw new Error("unregistered or nonqueueable durable verb");
  if (verb.recovery !== recovery)
    throw new Error("effect recovery differs from its registered contract");
  if (verb.policy[contract.actor.kind] !== "allow")
    throw new Error("durable actor is not allowed by the registered verb");
  // Unsupported versions are retained for explicit migration, not decoded as
  // though the running binary's parameter contract were the same version.
  if (
    verb.version === contract.version &&
    !Value.Check(verb.input, contract.params)
  )
    throw new Error("invalid durable verb parameters");
}

export function sameTarget(
  left: AttentionTarget,
  right: AttentionTarget | null,
) {
  if (!right || left.connection_id !== right.connection_id) return false;
  if (!("native_id" in left)) return !("native_id" in right);
  return (
    "native_id" in right &&
    left.adapter === right.adapter &&
    left.kind === right.kind &&
    left.native_id === right.native_id &&
    left.evidence.terminal_id === right.evidence.terminal_id &&
    left.evidence.session_fingerprint === right.evidence.session_fingerprint
  );
}

/** Legacy producers are normalized within the same domain/outbox transaction. */
export function effectContract(
  effect: OutboxEffect,
  id: string,
  ask: LedgerAsk | null,
  lookup = productionEffectVerb,
): EffectContract | null {
  let contract = effect.contract;
  if (!contract && effect.kind === "ask.created" && ask) {
    contract = {
      verb: "notification.show",
      version: 1,
      params: { ask_id: ask.id },
      targets: effect.target ? [effect.target] : [],
      actor: {
        kind: ask.actor.verified ? "cli_verified" : "cli_unverified",
        subject: ask.actor.label,
        evidence: { ...ask.actor },
      },
      authorization: { policy: "owner-alert" },
      idempotency_key: id,
      preconditions: { ask_open: ask.id },
      origin: "world.ask",
    };
  }
  if (!contract && effect.kind === ANSWER_DELIVERY_VERB.name && effect.intent) {
    const intent = effect.intent;
    contract = {
      verb: intent.verb,
      version: intent.version,
      params: intent.params,
      targets: effect.target ? [effect.target] : [],
      actor: {
        kind: intent.actor.kind === "owner" ? "browser" : "cli_verified",
        subject:
          intent.actor.kind === "owner" ? "owner" : intent.actor.actor.label,
        evidence:
          intent.actor.kind === "owner" ? {} : { ...intent.actor.actor },
      },
      authorization: { policy: "stored-answer", actor: intent.actor },
      idempotency_key: id,
      preconditions: { ...intent.condition },
      origin: intent.origin,
    };
  }
  if (!contract) return null;
  validateEffectContract(contract, effect.recovery, lookup);
  if (
    contract.verb === "notification.show" &&
    contract.targets.some((target) => "native_id" in target)
  )
    throw new Error("owner alerts capture only their original connection");
  if (
    contract.targets.length
      ? !sameTarget(contract.targets[0]!, effect.target)
      : effect.target !== null
  )
    throw new Error("intent target differs from its captured outbox target");
  if (
    (effect.kind === "ask.created" ||
      effect.kind === ANSWER_DELIVERY_VERB.name) &&
    contract.params.ask_id !== effect.record_id
  )
    throw new Error("durable intent does not reference its domain record");
  return contract;
}
