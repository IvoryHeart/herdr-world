import type { LedgerStore } from "./world-ledger";
import type { AnswerActor } from "./ask-delivery-types";
import {
  ANSWER_DELIVERY_VERB,
  ANSWER_DELIVERY_DELAY_MS,
  originalAsker,
  sameRecipient,
} from "./ask-delivery-types";
import type { createAskRecipients } from "./ask-recipient";
import type { OutboxEffect } from "../storage/world-protocol";
import { CliError } from "./world-cli-errors";

/** Commit exactly one reference-only answer intent with its immutable answer. */
export function createAnswerRecorder(deps: {
  ledger(): LedgerStore;
  recipients: ReturnType<typeof createAskRecipients>;
  now(): number;
}) {
  return async (id: string, text: string, actor: AnswerActor) => {
    const original = deps.ledger().ask(id);
    if (!original) throw new CliError("not_found", `no question ${id}`);
    if (original.answer || original.withdrawn || original.dismissed)
      throw new CliError("refused", `${id} is already closed`);
    const resolution = await deps.recipients.resolve(original.recipient);
    if (
      actor.kind === "agent" &&
      (await deps.recipients.authorize(actor, original)) !== "allowed"
    )
      throw new CliError(
        "refused",
        "The answering agent could not be verified for this ask",
      );
    const occurrence = await deps.ledger().nextId("a");
    let effects: OutboxEffect[] = [];
    return deps.ledger().update(
      (document) => {
        const ask = document.asks.find((entry) => entry.id === id);
        if (!ask) throw new CliError("not_found", `no question ${id}`);
        if (ask.answer || ask.withdrawn || ask.dismissed)
          throw new CliError("refused", `${id} is already closed`);
        if (
          actor.kind === "agent" &&
          (ask.owner_only ||
            !actor.actor.verified ||
            originalAsker(ask.recipient, actor.actor))
        )
          throw new CliError(
            "refused",
            "The answering actor is not authorized for this ask",
          );
        const at = deps.now();
        ask.answer = {
          text,
          at,
          by: actor.kind === "owner" ? "owner" : actor.actor.label,
          occurrence,
        };
        const recipient = original.recipient ?? null;
        const changed = recipient
          ? !sameRecipient(recipient, ask.recipient)
          : Boolean(ask.recipient);
        const refused =
          changed ||
          resolution.state === "ended" ||
          resolution.state === "unconfirmed";
        effects = [
          {
            kind: ANSWER_DELIVERY_VERB.name,
            record_id: id,
            recovery: "opaque",
            due_at: at + ANSWER_DELIVERY_DELAY_MS,
            initial_state: refused ? "refused" : "pending",
            reason: changed
              ? "The original recipient binding changed; use ask get"
              : resolution.state === "attached"
                ? "Answer stored; waiting for the asker CLI before pane delivery"
                : resolution.reason,
            target: recipient
              ? {
                  adapter: recipient.adapter,
                  connection_id: recipient.connection_id,
                  kind: "pane",
                  native_id: recipient.pane_id,
                  evidence: {
                    terminal_id: recipient.terminal_id,
                    session_fingerprint: recipient.reported.fingerprint,
                  },
                }
              : null,
            intent: {
              verb: ANSWER_DELIVERY_VERB.name,
              version: ANSWER_DELIVERY_VERB.version,
              origin: "world.ask.answer",
              params: { ask_id: id, answer_occurrence: occurrence },
              actor,
              condition: { awaiting_delivery: true, recipient },
            },
          },
        ];
      },
      () => effects,
    );
  };
}
