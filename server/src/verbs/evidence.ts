import type { Evidence, Verb } from "./types";

/** Only explicit receipts advance evidence; a successful handler alone cannot. */
export function commandEvidence(verb: Verb) {
  let current: Evidence = { stage: "accepted" };
  const record = (next: Evidence) => {
    if (!verb.stages.includes(next.stage))
      throw new Error(`${verb.name} does not report ${next.stage}`);
    if (next.stage === "stored" && !next.receipt)
      throw new Error("stored evidence needs a durable receipt");
    if (next.stage === "observed" && !next.observation)
      throw new Error("observed evidence needs an observation");
    if (
      (next.stage === "sent" || next.stage === "uncertain") &&
      (!next.connection_id ||
        !Number.isSafeInteger(next.connection_generation) ||
        next.connection_generation < 0)
    )
      throw new Error("dispatch evidence needs its owning runtime");
    current = next;
  };
  return { get: () => current, record };
}
