import type { Database } from "bun:sqlite";
import type { AttemptFence } from "../effects/types";
import { ANSWER_DELIVERY_VERB } from "../world/ask-delivery-types";
import {
  attentionRetryDelay,
  type AnswerAttempt,
  type AttentionEntry,
  type DispatchFence,
} from "./world-protocol";

export function recordAnswerAttempt(
  db: Database,
  id: string,
  attempt: number,
  state: AnswerAttempt["state"],
  fence: DispatchFence | null | undefined,
  at: number,
  reason: string,
  attemptFence?: AttemptFence,
) {
  const storedFence = attemptFence
    ? null
    : (db.query("SELECT attempt_fence FROM outbox WHERE id=?").get(id) as {
        attempt_fence: string | null;
      } | null);
  const auditFence =
    attemptFence ??
    (storedFence?.attempt_fence
      ? (JSON.parse(storedFence.attempt_fence) as AttemptFence)
      : fence
        ? { service_incarnation: fence.service_incarnation, attempt }
        : null);
  db.query(
    "INSERT INTO answer_attempts(intent_id,attempt,state,fence,created_at,finished_at,reason,attempt_fence) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(intent_id,attempt) DO UPDATE SET state=excluded.state,fence=coalesce(excluded.fence,answer_attempts.fence),finished_at=excluded.finished_at,reason=excluded.reason,attempt_fence=coalesce(excluded.attempt_fence,answer_attempts.attempt_fence)",
  ).run(
    id,
    attempt,
    state,
    fence ? JSON.stringify(fence) : null,
    at,
    ["claimed", "dispatching"].includes(state) ? null : at,
    reason,
    JSON.stringify(auditFence),
  );
  // Bound offline retry history without forgetting that an older send may have
  // happened: retain the newest eight attempts plus the newest uncertainty.
  db.query(
    "DELETE FROM answer_attempts WHERE intent_id=? AND attempt NOT IN (SELECT attempt FROM answer_attempts WHERE intent_id=? ORDER BY attempt DESC LIMIT 8) AND attempt<>coalesce((SELECT max(attempt) FROM answer_attempts WHERE intent_id=? AND state='uncertain'),-1)",
  ).run(id, id, id);
}
export function answerAttemptEvidence(
  db: Database,
  id: string,
  attempt: number,
) {
  const attempts = (
    db
      .query(
        "SELECT attempt,state,fence,created_at,finished_at,reason FROM answer_attempts WHERE intent_id=? ORDER BY attempt DESC LIMIT 8",
      )
      .all(id) as (Omit<AnswerAttempt, "fence"> & { fence: string | null })[]
  ).map((row) => ({
    ...row,
    fence: row.fence ? (JSON.parse(row.fence) as DispatchFence) : null,
  }));
  const prior_uncertainty = Boolean(
    db
      .query(
        "SELECT 1 FROM answer_attempts WHERE intent_id=? AND state='uncertain' AND attempt<? LIMIT 1",
      )
      .get(id, attempt),
  );
  return { attempts, prior_uncertainty };
}
export function recoverAttention(db: Database, at: number) {
  const rows = db
    .query(
      "SELECT id,kind,attempt,state,evidence,cli_received_at,contract,attempt_fence FROM outbox WHERE state='dispatching' OR (state='pending' AND claimed=1)",
    )
    .all() as {
    id: string;
    kind: string;
    attempt: number;
    state: string;
    evidence: string | null;
    cli_received_at: number | null;
    contract: string | null;
    attempt_fence: string | null;
  }[];
  if (!rows.length) return;
  db.transaction(() => {
    for (const row of rows) {
      const evidence = row.evidence
        ? (JSON.parse(row.evidence) as AttentionEntry["evidence"])
        : null;
      const unsent = row.state === "pending";
      const reason = unsent
        ? "Service stopped after claim; no submission began"
        : "Service stopped before the dispatch receipt; pane delivery is uncertain";
      if (row.kind === ANSWER_DELIVERY_VERB.name || row.contract)
        recordAnswerAttempt(
          db,
          row.id,
          row.attempt,
          unsent ? "cancelled" : "uncertain",
          evidence?.fence,
          at,
          reason,
          row.attempt_fence
            ? (JSON.parse(row.attempt_fence) as AttemptFence)
            : undefined,
        );
      const received = row.cli_received_at !== null;
      db.query(
        "UPDATE outbox SET state=?,claimed=0,resolved_at=?,due_at=?,evidence=?,ever_dispatched=CASE WHEN ? THEN ever_dispatched ELSE 1 END WHERE id=?",
      ).run(
        received ? "delivered" : unsent ? "pending" : "uncertain",
        row.cli_received_at,
        unsent ? at : at + attentionRetryDelay(row.attempt),
        JSON.stringify({
          ...evidence,
          reason: received
            ? "Answer received by asker CLI before restart; pane submission may also have happened"
            : reason,
        }),
        unsent ? 1 : 0,
        row.id,
      );
    }
  })();
}
