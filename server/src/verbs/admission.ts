import { Value } from "typebox/value";
import type { Admission, Verb } from "./types";

export class VerbRefusal extends Error {}

/** Synchronous: no acquisition, adapter call or queued work before admission. */
export function admitVerb(
  verb: Verb | undefined,
  params: unknown,
  admission: Admission,
): asserts verb is Verb {
  if (!verb) throw new VerbRefusal("unregistered verb");
  const policy = verb.policy[admission.actor];
  if (policy === "deny") throw new VerbRefusal("actor is denied this verb");
  if (!admission.authorized())
    throw new VerbRefusal("verb authorization was revoked");
  if (!Value.Check(verb.input, params))
    throw new VerbRefusal(`invalid parameters for ${verb.name}`);
  if (
    policy === "confirm" &&
    (admission.actor !== "browser" || !admission.browserConfirmed)
  )
    throw new VerbRefusal("owner browser confirmation is required");
  if (policy === "acknowledge") {
    const fields = params as Record<string, unknown>;
    for (const ack of verb.acknowledgements)
      if (
        (!ack.when || fields[ack.when] === true) &&
        fields[ack.field] !== true
      )
        throw new VerbRefusal(`add ${ack.flag} to acknowledge this effect`);
  }
  const capabilities = admission.capabilities();
  if (verb.capabilities.some((capability) => !capabilities.has(capability)))
    throw new VerbRefusal("required verb capability is unavailable");
  if (!admission.preconditions())
    throw new VerbRefusal("verb precondition is no longer satisfied");
}

/** Invoke at the dispatch boundary too, after any asynchronous preparation. */
export function checkVerbResult(verb: Verb, result: unknown): void {
  if (!Value.Check(verb.output, result))
    throw new Error(`invalid result for ${verb.name}`);
}
