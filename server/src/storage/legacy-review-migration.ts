import type { Database } from "bun:sqlite";
import {
  LEGACY_REVIEW_LIMIT,
  LEGACY_REVIEW_MAX_BYTES,
  legacyReviewArchiveBytes,
} from "./legacy-review-archive";

/** Migration 10 runs inside the schema transaction; migration 9 stays historical. */
export function migrateLegacyCompletionReviews(db: Database, at: number) {
  if (!Number.isSafeInteger(at) || at < 0)
    throw new Error("Legacy review migration refused: invalid migration time");
  db.exec(`CREATE TABLE retired_completion_reviews (
    id TEXT PRIMARY KEY REFERENCES world_ids(id), source_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL, original_order INTEGER NOT NULL UNIQUE,
    migrated_at INTEGER NOT NULL CHECK(migrated_at>=0),
    eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
    receipt TEXT NOT NULL CHECK(json_valid(receipt))
  );
  CREATE INDEX retired_completion_source ON retired_completion_reviews(source_id,terminal_id);
  CREATE INDEX retired_completion_expiry ON retired_completion_reviews(migrated_at);`);
  db.query(`INSERT INTO retired_completion_reviews(id,source_id,terminal_id,original_order,migrated_at,eligible,receipt)
    SELECT m.id,json_extract(b.body,'$.instance'),json_extract(b.body,'$.evidence.terminals[0]'),m.rowid,?,
      CASE WHEN json_type(b.body,'$.evidence.session')='text'
        AND length(json_extract(b.body,'$.evidence.session'))=64
        AND json_extract(b.body,'$.evidence.session') NOT GLOB '*[^a-f0-9]*'
        AND json_type(m.body,'$.stateChangeSeq')='integer'
        AND json_extract(m.body,'$.stateChangeSeq') BETWEEN 0 AND 9007199254740991
        AND json_extract(b.body,'$.state')!='ended' THEN 1 ELSE 0 END,
      json_object('id',m.id,'kind',m.kind,'revision',m.revision,'body',json(m.body),'binding',json(b.body))
    FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id
    WHERE m.kind='completion-seen' ORDER BY m.rowid DESC LIMIT ?`).run(
    at,
    LEGACY_REVIEW_LIMIT,
  );
  const bytes = legacyReviewArchiveBytes(db);
  if (bytes > LEGACY_REVIEW_MAX_BYTES)
    throw new Error(
      "Legacy review migration refused: archive exceeds 64 MiB byte budget",
    );
  // Preserve all Desk/watch values and row ordering exactly. Old binding bodies
  // survive in the receipt; their retired policy no longer enters live binding APIs.
  db.exec(`CREATE TEMP TABLE retired_completion_binding_ids AS SELECT binding_id AS id FROM terminal_marks WHERE kind='completion-seen';
    CREATE TABLE terminal_marks_next (
      id TEXT PRIMARY KEY REFERENCES world_ids(id),
      kind TEXT NOT NULL CHECK(kind IN ('desk','watchlist')),
      binding_id TEXT NOT NULL UNIQUE REFERENCES world_bindings(id),
      revision INTEGER NOT NULL CHECK(revision>=0), body TEXT NOT NULL CHECK(json_valid(body)), open_order INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO terminal_marks_next(rowid,id,kind,binding_id,revision,body,open_order)
      SELECT rowid,id,kind,binding_id,revision,body,open_order FROM terminal_marks WHERE kind IN ('desk','watchlist');
    DROP TABLE terminal_marks;
    ALTER TABLE terminal_marks_next RENAME TO terminal_marks;
    DELETE FROM world_bindings WHERE id IN (SELECT id FROM retired_completion_binding_ids);
    DROP TABLE retired_completion_binding_ids;`);
}
