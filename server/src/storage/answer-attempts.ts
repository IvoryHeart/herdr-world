import type { Database } from "bun:sqlite";
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
) {
  db.query(
    "INSERT INTO answer_attempts(intent_id,attempt,state,fence,created_at,finished_at,reason) VALUES(?,?,?,?,?,?,?) ON CONFLICT(intent_id,attempt) DO UPDATE SET state=excluded.state,fence=coalesce(excluded.fence,answer_attempts.fence),finished_at=excluded.finished_at,reason=excluded.reason",
  ).run(
    id,
    attempt,
    state,
    fence ? JSON.stringify(fence) : null,
    at,
    ["claimed", "dispatching"].includes(state) ? null : at,
    reason,
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
      "SELECT id,kind,attempt,state,evidence,cli_received_at FROM outbox WHERE state='dispatching' OR (state='pending' AND claimed=1)",
    )
    .all() as {
    id: string;
    kind: string;
    attempt: number;
    state: string;
    evidence: string | null;
    cli_received_at: number | null;
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
      if (row.kind === ANSWER_DELIVERY_VERB.name)
        recordAnswerAttempt(
          db,
          row.id,
          row.attempt,
          unsent ? "cancelled" : "uncertain",
          evidence?.fence,
          at,
          reason,
        );
      const received = row.cli_received_at !== null;
      db.query(
        "UPDATE outbox SET state=?,claimed=0,resolved_at=?,due_at=?,evidence=? WHERE id=?",
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
        row.id,
      );
    }
  })();
}
