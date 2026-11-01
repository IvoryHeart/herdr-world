import type { WorldLedgerStorage } from "../storage/world-protocol";

/** Server query contract for the substrate. No workflow authoring or new wire API. */
export function createWorldEffectQueries(
  storage: Pick<WorldLedgerStorage, "ledger" | "outbox" | "effects">,
) {
  return {
    ask: (id: string) => storage.ledger.ask(id) ?? null,
    notices: (
      kind: "ask.created" | "world.ask.deliver-answer",
      after?: string,
      limit = 60,
    ) => storage.outbox.notices(kind, after, limit),
    intent: (id: string) => storage.effects.get(id),
    async receipt(id: string) {
      const intent = await storage.effects.get(id);
      return intent
        ? {
            intent_id: intent.id,
            operation_id: intent.operation_id,
            version: intent.contract?.version ?? null,
            state: intent.state,
            receipt: intent.receipt,
            external_handle: intent.external_handle,
            ever_dispatched: intent.ever_dispatched,
            not_sent: intent.not_sent,
            attempt: intent.attempt,
            evidence: intent.evidence,
          }
        : null;
    },
  };
}
