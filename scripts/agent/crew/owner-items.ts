import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type OwnerTarget = {
  kind: "url" | "seat" | "tab";
  value: string;
  fallbackUrl?: string;
};
export type OwnerCause = {
  source: "crew" | "dispatch";
  /** A producer-owned identity for one cause, stable across repeated passes. */
  key: string;
  reason: string;
  pr?: number;
  seat?: string;
  target: OwnerTarget;
};
export type OwnerItem = OwnerCause & {
  id: number;
  createdAt: number;
  dismissedAt: number | null;
  resolvedAt: number | null;
  notifiedAt: number | null;
};

/** Shared by every checkout and producer; never cleared by a failed Herdr nudge. */
export function openOwnerStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA busy_timeout = 30000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS owner_item (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      key TEXT NOT NULL,
      reason TEXT NOT NULL,
      pr INTEGER,
      seat TEXT,
      target TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      dismissed_at INTEGER,
      resolved_at INTEGER,
      notified_at INTEGER,
      UNIQUE(source, key)
    );
    CREATE TABLE IF NOT EXISTS inbox_tab (id INTEGER PRIMARY KEY CHECK(id = 1), tab TEXT NOT NULL);
  `);
  return db;
}

type Row = {
  id: number;
  source: OwnerCause["source"];
  key: string;
  reason: string;
  pr: number | null;
  seat: string | null;
  target: string;
  created_at: number;
  dismissed_at: number | null;
  resolved_at: number | null;
  notified_at: number | null;
};
function item(row: Row): OwnerItem {
  return {
    id: row.id,
    source: row.source,
    key: row.key,
    reason: row.reason,
    ...(row.pr === null ? {} : { pr: row.pr }),
    ...(row.seat === null ? {} : { seat: row.seat }),
    target: JSON.parse(row.target) as OwnerTarget,
    createdAt: row.created_at,
    dismissedAt: row.dismissed_at,
    resolvedAt: row.resolved_at,
    notifiedAt: row.notified_at,
  };
}

export function listItems(db: Database, history = false): OwnerItem[] {
  return db
    .query<Row, []>(`SELECT * FROM owner_item
    ${history ? "" : "WHERE dismissed_at IS NULL AND resolved_at IS NULL"}
    ORDER BY created_at DESC, id DESC`)
    .all()
    .map(item);
}

/** Repeats preserve age and dismissal. A cleared cause can open afresh. */
export function putItem(
  db: Database,
  cause: OwnerCause,
  now: number,
): OwnerItem {
  const row = db
    .query<
      Row,
      [string, string, string, number | null, string | null, string, number]
    >(`
    INSERT INTO owner_item (source, key, reason, pr, seat, target, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, key) DO UPDATE SET
      reason = excluded.reason, pr = excluded.pr, seat = excluded.seat, target = excluded.target,
      created_at = CASE WHEN resolved_at IS NULL THEN created_at ELSE excluded.created_at END,
      dismissed_at = CASE WHEN resolved_at IS NULL THEN dismissed_at ELSE NULL END,
      notified_at = CASE WHEN resolved_at IS NULL THEN notified_at ELSE NULL END,
      resolved_at = NULL
    RETURNING *`)
    .get(
      cause.source,
      cause.key,
      cause.reason,
      cause.pr ?? null,
      cause.seat ?? null,
      JSON.stringify(cause.target),
      now,
    )!;
  return item(row);
}

export function dismissItem(db: Database, id: number, now: number) {
  return (
    db
      .query(`UPDATE owner_item SET dismissed_at = ?
    WHERE id = ? AND dismissed_at IS NULL AND resolved_at IS NULL`)
      .run(now, id).changes > 0
  );
}

export function resolveItem(
  db: Database,
  source: OwnerCause["source"],
  key: string,
  now: number,
) {
  db.query(`UPDATE owner_item SET resolved_at = ?
    WHERE source = ? AND key = ? AND resolved_at IS NULL`).run(
    now,
    source,
    key,
  );
}

export function markNotified(db: Database, id: number, now: number) {
  db.query("UPDATE owner_item SET notified_at = ? WHERE id = ?").run(now, id);
}
