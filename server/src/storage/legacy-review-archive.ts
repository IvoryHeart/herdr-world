import type { Database } from "bun:sqlite";
import type { MarkBody, TerminalMarkPut } from "./terminal-marks";

export const LEGACY_REVIEW_LIMIT = 4096;
export const LEGACY_REVIEW_MAX_BYTES = 64 * 1024 * 1024;
export const LEGACY_REVIEW_TTL_MS = 30 * 24 * 60 * 60_000;
export type LegacyReviewArchiveState = {
  count: number;
  expires_at: number | null;
};
export type LegacyReviewProof = {
  terminal_id: string;
  session: string | null;
  sequence: number | null;
  status: "working" | "idle" | "done" | "blocked" | "unknown";
  last_activity_at: number | null;
};
export type LegacyReviewOperation =
  | { type: "legacy-prune"; connection_id: string; terminals: string[] }
  | {
      type: "legacy-proof";
      connection_id: string;
      proofs: LegacyReviewProof[];
    };
export type LegacyReviewResult = {
  archive: LegacyReviewArchiveState;
  eligible: number;
  resolvable: string[];
};
type Receipt = {
  body: { stateChangeSeq?: number };
  binding: { evidence: { session?: string } };
};

/** Canonical serialized archive rows, including metadata; never wire state. */
export function legacyReviewArchiveBytes(db: Database): number {
  return (
    db
      .query(
        `SELECT coalesce(sum(length(CAST(json_object('id',id,'source_id',source_id,'terminal_id',terminal_id,'original_order',original_order,'migrated_at',migrated_at,'eligible',eligible,'receipt',json(receipt)) AS BLOB))),0) AS bytes FROM retired_completion_reviews`,
      )
      .get() as { bytes: number }
  ).bytes;
}

/** Private storage metadata only: receipts never enter any browser projection. */
export function readLegacyReviewArchiveState(
  db: Database,
): LegacyReviewArchiveState {
  const row = db
    .query(
      "SELECT count(*) AS count,min(migrated_at) AS oldest FROM retired_completion_reviews",
    )
    .get() as { count: number; oldest: number | null };
  return {
    count: row.count,
    expires_at: row.oldest === null ? null : row.oldest + LEGACY_REVIEW_TTL_MS,
  };
}

export function expireLegacyReviews(db: Database, at: number) {
  if (!Number.isFinite(at) || at < 0)
    throw new Error("invalid legacy review expiry time");
  db.query("DELETE FROM retired_completion_reviews WHERE migrated_at<=?").run(
    at - LEGACY_REVIEW_TTL_MS,
  );
}

function matchingReceipts(db: Database, source: string, terminal: string) {
  return db
    .query(
      "SELECT id,receipt FROM retired_completion_reviews WHERE source_id=? AND terminal_id=? AND eligible=1 ORDER BY original_order",
    )
    .all(source, terminal) as { id: string; receipt: string }[];
}

/** Fresh proofs can permanently disqualify a receipt, but never delete it early. */
export function observeLegacyReviews(
  db: Database,
  operation: LegacyReviewOperation,
  at: number,
): LegacyReviewResult {
  if (
    typeof operation.connection_id !== "string" ||
    !operation.connection_id ||
    operation.connection_id.length > 512
  )
    throw new Error("invalid legacy review source");
  expireLegacyReviews(db, at);
  const resolvable: string[] = [];
  if (operation.type === "legacy-prune") {
    if (
      !Array.isArray(operation.terminals) ||
      operation.terminals.some(
        (id) => typeof id !== "string" || !id || id.length > 512,
      )
    )
      throw new Error("invalid legacy terminal observation");
    db.query(
      "DELETE FROM retired_completion_reviews WHERE source_id=? AND terminal_id NOT IN (SELECT value FROM json_each(?))",
    ).run(operation.connection_id, JSON.stringify(operation.terminals));
  } else {
    if (!Array.isArray(operation.proofs) || operation.proofs.length > 32)
      throw new Error("invalid legacy proof batch");
    for (const proof of operation.proofs) {
      if (
        typeof proof.terminal_id !== "string" ||
        !proof.terminal_id ||
        proof.terminal_id.length > 512 ||
        (proof.session !== null && !/^[a-f0-9]{64}$/u.test(proof.session)) ||
        (proof.sequence !== null &&
          (!Number.isSafeInteger(proof.sequence) || proof.sequence < 0)) ||
        !["working", "idle", "done", "blocked", "unknown"].includes(
          proof.status,
        )
      )
        throw new Error("invalid legacy review proof");
      const rows = matchingReceipts(
        db,
        operation.connection_id,
        proof.terminal_id,
      );
      for (const row of rows) {
        const receipt = JSON.parse(row.receipt) as Receipt;
        if (
          rows.length !== 1 ||
          receipt.binding.evidence.session !== proof.session ||
          ["working", "blocked"].includes(proof.status) ||
          (proof.sequence !== null &&
            receipt.body.stateChangeSeq !== proof.sequence)
        )
          db.query(
            "UPDATE retired_completion_reviews SET eligible=0 WHERE id=?",
          ).run(row.id);
        else if (
          proof.sequence !== null &&
          ["done", "idle"].includes(proof.status)
        )
          resolvable.push(proof.terminal_id);
      }
    }
  }
  const eligible = (
    db
      .query(
        "SELECT count(*) AS count FROM retired_completion_reviews WHERE source_id=? AND eligible=1",
      )
      .get(operation.connection_id) as { count: number }
  ).count;
  return { archive: readLegacyReviewArchiveState(db), eligible, resolvable };
}

/** Called inside the exact Desk put savepoint: review and receipt removal commit together. */
export function resolveLegacyReview(
  db: Database,
  input: TerminalMarkPut,
  value: MarkBody,
): MarkBody {
  const proof = input.legacy_review;
  if (input.kind !== "desk" || !proof) return value;
  const terminal = input.target.evidence.terminals[0]!;
  const rows = matchingReceipts(db, input.target.instance, terminal);
  if (!rows.length) return value;
  const row = rows[0]!,
    receipt = JSON.parse(row.receipt) as Receipt;
  const session = input.target.evidence.session;
  const proven =
    rows.length === 1 &&
    session !== undefined &&
    session === receipt.binding.evidence.session &&
    session === proof.session &&
    proof.terminal_id === terminal &&
    proof.sequence !== null &&
    proof.sequence === receipt.body.stateChangeSeq &&
    value.stateChangeSeq === proof.sequence &&
    ["done", "idle"].includes(proof.status) &&
    typeof value.observed_stop_id === "string" &&
    value.observed_stop_id.length > 0;
  if (!proven) {
    if (
      proof.review_changed ||
      (proof.sequence !== null && value.stateChangeSeq !== proof.sequence)
    )
      for (const candidate of rows)
        db.query(
          "UPDATE retired_completion_reviews SET eligible=0 WHERE id=?",
        ).run(candidate.id);
    return value;
  }
  const activity =
    typeof proof.last_activity_at === "number" &&
    Number.isFinite(proof.last_activity_at)
      ? proof.last_activity_at
      : null;
  const stop = `stop:${JSON.stringify([value.observed_stop_id, activity])}`;
  if (
    (proof.review_changed && value.reviewed_stop !== stop) ||
    (value.reviewed_stop !== null && value.reviewed_stop !== stop)
  ) {
    db.query("UPDATE retired_completion_reviews SET eligible=0 WHERE id=?").run(
      row.id,
    );
    return value;
  }
  db.query("DELETE FROM retired_completion_reviews WHERE id=?").run(row.id);
  return { ...value, reviewed_stop: stop };
}
