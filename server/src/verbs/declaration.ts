import { Type, type TProperties, type TSchema } from "typebox";
import type { Actor, Policy, Recovery, Verb, Acknowledgement } from "./types";

// Legacy RPCs deliberately allow extension fields and retain their owner-specific
// decoders (including coercion and filtering). Admission validates the envelope
// and declared fields; it must not silently tighten those existing contracts.
export const object = (fields: TProperties = {}) => Type.Object(fields);
export const result = Type.Union([
  Type.Record(Type.String(), Type.Unknown()),
  Type.Array(Type.Unknown()),
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
  Type.Undefined(),
]);
export const text = Type.String({ minLength: 1 });
export const optionalText = Type.Optional(Type.String());

export function policies(
  allowed: Partial<Record<Actor, Policy>>,
): Verb["policy"] {
  return Object.freeze({
    browser: "deny",
    cli_verified: "deny",
    cli_unverified: "deny",
    assistant: "deny",
    reconciler: "deny",
    automation: "deny",
    ...allowed,
  });
}

export function declare(
  channel: Verb["channel"],
  name: string,
  input: TSchema,
  output: TSchema,
  recovery: Recovery,
  policy: Verb["policy"],
  capabilities: readonly string[],
  preconditions: readonly string[],
  acknowledgements: readonly Acknowledgement[] = [],
  options: { queueable?: boolean; version?: number } = {},
): Verb {
  return Object.freeze({
    name,
    channel,
    version: options.version ?? 1,
    input,
    output,
    recovery,
    policy,
    capabilities: Object.freeze([...capabilities]),
    preconditions: Object.freeze([...preconditions]),
    acknowledgements: Object.freeze(
      acknowledgements.map((ack) => Object.freeze(ack)),
    ),
    queueable: options.queueable ?? false,
    stages: Object.freeze([
      "accepted",
      "stored",
      "sent",
      "observed",
      "refused",
      "failed",
      "uncertain",
    ] as const),
  });
}
