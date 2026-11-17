import {
  ANSWER_DELIVERY_VERB,
  originalAsker,
  sameRecipient,
} from "./ask-delivery-types";
import type { LedgerAsk, LedgerStore } from "./world-ledger";
import type { createAskRecipients, RecipientResolution } from "./ask-recipient";
import {
  attentionRetryDelay,
  type StoragePorts,
} from "../storage/world-protocol";
import type { EffectEntry, EffectStore } from "../effects/types";
import { createEffectRunner, type EffectDriver } from "../effects/runner";

export function answerPrompt(ask: LedgerAsk) {
  const text = `Answer to ${ask.id}:\nQuestion: ${ask.question}\nAnswer from ${ask.answer?.by ?? "owner"}: ${ask.answer?.text ?? ""}`;
  const pointer = text.length > 12_000;
  return {
    pointer,
    text: pointer
      ? `Answer to ${ask.id} is stored in World. Run herdr-world ask get ${ask.id} to read it.`
      : text,
  };
}

/** Chat retains its late input boundary; the shared runner owns durable attempts. */
export function createAnswerDispatcher(deps: {
  ledger(): LedgerStore;
  effects(): EffectStore;
  incarnation: string;
  recipients: ReturnType<typeof createAskRecipients>;
  clock: StoragePorts["clock"];
  scheduler: StoragePorts["scheduler"];
  changed(): void;
  log(message: string): void;
}) {
  const bindings = new Map<string, RecipientResolution>();
  const sameAnswer = (entry: EffectEntry) => {
    const ask = deps.ledger().ask(entry.record_id);
    return ask &&
      ask.answer?.occurrence === entry.intent?.params.answer_occurrence &&
      !ask.withdrawn &&
      sameRecipient(ask.recipient, entry.intent?.condition.recipient)
      ? ask
      : null;
  };
  const actorAllowed = (entry: EffectEntry) => {
    const ask = sameAnswer(entry),
      actor = entry.intent?.actor;
    return Boolean(
      ask &&
        actor &&
        (actor.kind === "owner" ||
          (!ask.owner_only &&
            actor.actor.verified &&
            !originalAsker(ask.recipient, actor.actor))),
    );
  };
  const driver: EffectDriver = {
    async authorize(entry) {
      const ask = sameAnswer(entry);
      if (!ask || !entry.intent) return "refused";
      const result = await deps.recipients.authorize(entry.intent.actor, ask);
      return result === "pending" ? "wait" : result;
    },
    preconditions: (entry) => (sameAnswer(entry) ? "allowed" : "refused"),
    async resolve(entry) {
      const binding = await deps.recipients.resolve(
        entry.intent?.condition.recipient,
      );
      bindings.set(entry.id, binding);
      if (binding.state !== "attached") return binding;
      const fence = deps.recipients.fence(entry.intent?.condition.recipient);
      if (
        !fence ||
        fence.generation !== binding.lease.generation ||
        !entry.target
      )
        return {
          state: "unresolved",
          reason: "The original runtime retired during preparation",
        };
      return { state: "attached", targets: [{ capture: entry.target, fence }] };
    },
    guard(entry, targets) {
      const binding = bindings.get(entry.id);
      return Boolean(
        actorAllowed(entry) &&
          binding?.state === "attached" &&
          binding.lease.isCurrent() &&
          targets[0]?.fence.generation === binding.lease.generation,
      );
    },
    async invoke(entry, context) {
      const resolution = await driver.resolve(entry);
      if (resolution.state !== "attached")
        return {
          state: resolution.state === "unresolved" ? "wait" : "refused",
          reason: resolution.reason,
        };
      const binding = bindings.get(entry.id)!;
      const ask = sameAnswer(entry),
        recipient = entry.intent?.condition.recipient;
      if (binding.state !== "attached" || !ask || !recipient)
        return {
          state: "refused",
          reason: "Original answer binding is unavailable",
        };
      const prompt = answerPrompt(ask);
      let marked = false,
        confirmed = false;
      try {
        const result =
          await binding.lease.runtime.agentSessions!.conversation.send({
            pane_id: recipient.pane_id,
            text: prompt.text,
            session_fingerprint: recipient.conversation.fingerprint,
            baseline: binding.conversation.messages
              .filter((message) => message.role === "user")
              .map((message) => message.id),
            beforeSubmit: async () => {
              marked = await context.beforeSubmit();
              return marked && binding.lease.isCurrent();
            },
            guard: (info) =>
              actorAllowed(entry) &&
              (!marked || context.guard()) &&
              deps.recipients.guard(recipient, binding.lease, info),
            submitted: (fingerprint) => {
              confirmed = fingerprint === recipient.conversation.fingerprint;
            },
          });
        if (result.status === "sent")
          return marked && confirmed
            ? {
                state: "delivered",
                receipt: {
                  source: "herdr-chat",
                  delivery_id: result.delivery.id,
                  fingerprint: recipient.conversation.fingerprint,
                  pointer: prompt.pointer,
                },
              }
            : {
                state: "uncertain",
                reason:
                  "Pane submission could not be confirmed for the original session; use ask get",
              };
        const retry =
          !binding.lease.isCurrent() ||
          ["blocked", "unsettled", "unavailable"].includes(result.reason);
        return {
          state: retry ? "wait" : "refused",
          reason: retry
            ? "Chat submitted nothing; waiting for admission on the original binding"
            : "Chat refused the original recipient or state; nothing sent, use ask get",
          not_submitted: true,
        };
      } finally {
        bindings.delete(entry.id);
      }
    },
  };
  return createEffectRunner({
    ...deps,
    store: deps.effects(),
    verb: ANSWER_DELIVERY_VERB.name,
    retryDelay: (attempt) => Math.min(60_000, attentionRetryDelay(attempt)),
    driver: (verb) => (verb === ANSWER_DELIVERY_VERB.name ? driver : undefined),
    log: (error) => deps.log(`Answer delivery failed: ${String(error)}`),
  });
}
