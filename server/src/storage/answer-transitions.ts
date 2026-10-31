import { recordAnswerAttempt } from "./answer-attempts";
import type { Database } from "bun:sqlite";
import {
  ANSWER_DELIVERY_VERB,
  originalAsker,
  sameRecipient,
  validRecipient,
} from "../world/ask-delivery-types";
import type { CliActor, LedgerAsk } from "../world/world-ledger";
import type { AttentionEntry, DispatchFence } from "./world-protocol";

/** Only durable reference/state transitions: native authority and binding stay at dispatch. */
export function answerTransitions(
  db: Database,
  attention: (id: string) => AttentionEntry | null,
) {
  const askFor = (entry: AttentionEntry) => {
    const row = db
      .query("SELECT body FROM asks WHERE id=?")
      .get(entry.record_id) as { body: string } | null;
    return row && (JSON.parse(row.body) as LedgerAsk | null);
  };
  const matches = (entry: AttentionEntry, ask: LedgerAsk | null) =>
    Boolean(
      ask?.answer?.occurrence &&
        entry.intent?.params.ask_id === ask.id &&
        entry.intent.params.answer_occurrence === ask.answer.occurrence,
    );
  const finishUnsent = (
    entry: AttentionEntry,
    state: "refused" | "cancelled",
    reason: string,
    at: number,
  ) => {
    db.query(
      "UPDATE outbox SET state=?,claimed=0,resolved_at=?,evidence=? WHERE id=?",
    ).run(state, at, JSON.stringify({ ...entry.evidence, reason }), entry.id);
    if (entry.claimed)
      recordAnswerAttempt(
        db,
        entry.id,
        entry.attempt,
        state,
        entry.evidence?.fence,
        at,
        reason,
      );
    return attention(entry.id);
  };
  return {
    begin(id: string, attempt: number, fence: DispatchFence, at: number) {
      const entry = attention(id);
      if (
        !entry ||
        entry.kind !== ANSWER_DELIVERY_VERB.name ||
        entry.state !== "pending" ||
        !entry.claimed ||
        entry.attempt !== attempt ||
        entry.evidence?.fence?.connection_id !== fence.connection_id ||
        entry.evidence.fence.generation !== fence.generation ||
        entry.evidence.fence.service_incarnation !== fence.service_incarnation
      )
        return null;
      const ask = askFor(entry);
      if (!matches(entry, ask) || ask?.withdrawn)
        return finishUnsent(
          entry,
          "cancelled",
          "The ask no longer awaits this answer delivery",
          at,
        );
      if (entry.intent?.version !== ANSWER_DELIVERY_VERB.version)
        return finishUnsent(
          entry,
          "refused",
          "Unsupported answer delivery operation version",
          at,
        );
      if (
        !sameRecipient(entry.intent.condition.recipient, ask?.recipient) ||
        !entry.target ||
        !("native_id" in entry.target) ||
        entry.target.connection_id !== ask?.recipient?.connection_id ||
        entry.target.native_id !== ask.recipient?.pane_id ||
        entry.target.adapter !== "herdr" ||
        entry.target.kind !== "pane" ||
        entry.target.evidence.terminal_id !== ask.recipient?.terminal_id ||
        entry.target.evidence.session_fingerprint !==
          ask.recipient?.reported.fingerprint
      )
        return finishUnsent(
          entry,
          "refused",
          "The original recipient binding changed",
          at,
        );
      if (
        entry.intent.actor.kind === "agent" &&
        (ask?.owner_only ||
          !entry.intent.actor.actor.verified ||
          originalAsker(ask?.recipient, entry.intent.actor.actor))
      )
        return finishUnsent(
          entry,
          "refused",
          "The answering actor is no longer authorized for this ask",
          at,
        );
      db.query(
        "UPDATE outbox SET state='dispatching',claimed=0,ever_dispatched=1,dispatch_targets=?,evidence=? WHERE id=? AND claimed=1 AND attempt=?",
      ).run(
        JSON.stringify([{ capture: entry.target, fence }]),
        JSON.stringify({ ...entry.evidence, reason: "Dispatch checks passed" }),
        id,
        attempt,
      );
      recordAnswerAttempt(
        db,
        id,
        attempt,
        "dispatching",
        fence,
        at,
        "Submission admitted after current checks",
      );
      return attention(id);
    },
    acknowledge(
      id: string,
      occurrence: string,
      attempt: number,
      actor: CliActor,
      at: number,
    ) {
      const entry = attention(id);
      if (
        !entry ||
        entry.kind !== ANSWER_DELIVERY_VERB.name ||
        entry.intent?.params.answer_occurrence !== occurrence ||
        entry.attempt !== attempt ||
        !matches(entry, askFor(entry)) ||
        !originalAsker(entry.intent.condition.recipient, actor)
      )
        return null;
      if (entry.cli_received_at !== null) return entry;
      const active = entry.state === "dispatching";
      const closed = entry.state === "cancelled";
      if (entry.claimed)
        recordAnswerAttempt(
          db,
          id,
          entry.attempt,
          "cancelled",
          entry.evidence?.fence,
          at,
          "Asker CLI received the answer before submission",
        );
      db.query(
        "UPDATE outbox SET cli_received_at=?,state=?,claimed=0,resolved_at=?,evidence=? WHERE id=?",
      ).run(
        at,
        active || closed ? entry.state : "delivered",
        active ? null : closed ? entry.resolved_at : at,
        JSON.stringify({
          ...entry.evidence,
          reason: active
            ? "Asker CLI received the answer while a pane send was active"
            : closed
              ? "Delivery closed by owner; answer later received by asker CLI"
              : "Answer received by asker CLI",
        }),
        id,
      );
      return attention(id);
    },
    decide(
      id: string,
      occurrence: string,
      attempt: number,
      action: "resend" | "close",
      at: number,
    ) {
      const entry = attention(id);
      if (
        !entry ||
        entry.kind !== ANSWER_DELIVERY_VERB.name ||
        entry.intent?.params.answer_occurrence !== occurrence ||
        entry.attempt !== attempt
      )
        return null;
      if (!["pending", "uncertain", "refused"].includes(entry.state))
        return null;
      const ask = askFor(entry);
      if (
        action === "resend" &&
        (!matches(entry, ask) ||
          ask?.withdrawn ||
          !validRecipient(entry.intent.condition.recipient))
      )
        throw new Error(
          "This answer has no eligible original recipient; it remains available through ask get",
        );
      if (action === "resend" && entry.state === "pending") return null;
      if (entry.claimed)
        recordAnswerAttempt(
          db,
          id,
          entry.attempt,
          "cancelled",
          entry.evidence?.fence,
          at,
          "Owner closed the claimed delivery before submission",
        );
      db.query(
        "UPDATE outbox SET state=?,claimed=0,attempt=attempt+1,resolved_at=?,due_at=?,evidence=?,owner_retry_attempt=?,cancel_requested=? WHERE id=? AND attempt=?",
      ).run(
        action === "resend" ? "pending" : "cancelled",
        action === "resend" ? null : at,
        at,
        JSON.stringify({
          reason:
            action === "resend"
              ? "Owner authorized a possible duplicate to the original recipient"
              : "Owner closed delivery; the answer remains readable",
        }),
        action === "resend" ? attempt : null,
        action === "close" ? 1 : 0,
        id,
        attempt,
      );
      db.query(
        "INSERT INTO effect_decisions(intent_id,action,actor,reason,created_at,previous_version,operation_version) VALUES(?,?,?,?,?,NULL,NULL)",
      ).run(
        id,
        action,
        JSON.stringify({
          kind: "browser",
          subject: "owner",
          evidence: { source: "world.ask.delivery.decide" },
        }),
        action === "resend"
          ? "Owner authorized possible duplicate delivery"
          : "Owner closed delivery",
        at,
      );
      return attention(id);
    },
  };
}
