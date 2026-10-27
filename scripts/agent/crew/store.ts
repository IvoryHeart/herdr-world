import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Action } from "./plan";

/**
 * The crew watcher's own ledger: each planned action once under its key,
 * and each fresh reviewer run. The gate's verdict store stays read-only here.
 */

export type ActionState =
  /** Waiting for its seat to be idle, or for a reviewer run slot. */
  | "pending"
  /** Prompted, notified or written to the feed. */
  | "sent"
  /** A reviewer run is going. */
  | "running"
  /** A reviewer run finished. */
  | "done"
  /** A reviewer run failed or timed out, past its retry. */
  | "failed"
  /** A newer head made it moot. */
  | "superseded";

export type StoredAction = Action & {
  state: ActionState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  detail: string | null;
};

export type StoredRun = {
  id: number;
  actionKey: string;
  reviewer: string;
  pr: number;
  head: string;
  pid: number | null;
  /** The Herdr pane the run is shown in, when it has one. */
  pane: string | null;
  log: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  usage: string | null;
};

export function openCrewStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS action (
      key TEXT PRIMARY KEY,
      pr INTEGER NOT NULL,
      head TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL,
      text TEXT NOT NULL,
      since TEXT,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS action_state ON action(state);
    CREATE TABLE IF NOT EXISTS run (
      id INTEGER PRIMARY KEY,
      action_key TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      pr INTEGER NOT NULL,
      head TEXT NOT NULL,
      pid INTEGER,
      log TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      exit_code INTEGER,
      usage TEXT
    );
  `);
  // Stores created before runs were shown in Herdr panes.
  const columns = db
    .query<{ name: string }, []>("PRAGMA table_info(run)")
    .all()
    .map((column) => column.name);
  if (!columns.includes("pane"))
    db.exec("ALTER TABLE run ADD COLUMN pane TEXT");
  return db;
}

type ActionRow = {
  key: string;
  pr: number;
  head: string;
  kind: Action["kind"];
  target: string;
  text: string;
  since: string | null;
  state: ActionState;
  attempts: number;
  created_at: number;
  updated_at: number;
  detail: string | null;
};

function action(row: ActionRow): StoredAction {
  return {
    key: row.key,
    pr: row.pr,
    head: row.head,
    kind: row.kind,
    target: row.target,
    text: row.text,
    ...(row.since ? { since: row.since } : {}),
    state: row.state,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    detail: row.detail,
  };
}

export function getAction(db: Database, key: string) {
  const row = db
    .query<ActionRow, [string]>("SELECT * FROM action WHERE key = ?")
    .get(key);
  return row ? action(row) : null;
}

/** Records a planned action the first time its key is seen; true if new. */
export function addAction(db: Database, planned: Action, now: number) {
  const result = db
    .query(
      `INSERT OR IGNORE INTO action
        (key, pr, head, kind, target, text, since, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      planned.key,
      planned.pr,
      planned.head,
      planned.kind,
      planned.target,
      planned.text,
      planned.since ?? null,
      now,
      now,
    );
  return result.changes > 0;
}

export function setAction(
  db: Database,
  key: string,
  state: ActionState,
  now: number,
  detail: string | null = null,
  attempted = false,
) {
  db.query(
    `UPDATE action SET state = ?, updated_at = ?, detail = ?,
       attempts = attempts + ? WHERE key = ?`,
  ).run(state, now, detail, attempted ? 1 : 0, key);
}

export function actionsIn(db: Database, states: ActionState[]) {
  return db
    .query<ActionRow, string[]>(
      `SELECT * FROM action WHERE state IN (${states.map(() => "?").join(", ")})
       ORDER BY created_at, rowid`,
    )
    .all(...states)
    .map(action);
}

export function recentActions(db: Database, limit: number) {
  return db
    .query<ActionRow, [number]>(
      "SELECT * FROM action ORDER BY updated_at DESC, key LIMIT ?",
    )
    .all(limit)
    .map(action);
}

type RunRow = {
  id: number;
  action_key: string;
  reviewer: string;
  pr: number;
  head: string;
  pid: number | null;
  pane: string | null;
  log: string;
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
  usage: string | null;
};

function run(row: RunRow): StoredRun {
  return {
    id: row.id,
    actionKey: row.action_key,
    reviewer: row.reviewer,
    pr: row.pr,
    head: row.head,
    pid: row.pid,
    pane: row.pane,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    usage: row.usage,
  };
}

export function addRun(
  db: Database,
  entry: Pick<StoredRun, "actionKey" | "reviewer" | "pr" | "head" | "log">,
  now: number,
) {
  return Number(
    db
      .query(
        `INSERT INTO run (action_key, reviewer, pr, head, log, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.actionKey,
        entry.reviewer,
        entry.pr,
        entry.head,
        entry.log,
        now,
      ).lastInsertRowid,
  );
}

export function setRunPid(db: Database, id: number, pid: number) {
  db.query("UPDATE run SET pid = ? WHERE id = ?").run(pid, id);
}

export function setRunPane(db: Database, id: number, pane: string) {
  db.query("UPDATE run SET pane = ? WHERE id = ?").run(pane, id);
}

export function finishRun(
  db: Database,
  id: number,
  exitCode: number,
  usage: string | null,
  now: number,
) {
  db.query(
    `UPDATE run SET finished_at = ?, exit_code = ?, usage = ?
     WHERE id = ? AND finished_at IS NULL`,
  ).run(now, exitCode, usage, id);
}

export function getRun(db: Database, id: number) {
  const row = db
    .query<RunRow, [number]>("SELECT * FROM run WHERE id = ?")
    .get(id);
  return row ? run(row) : null;
}

export function activeRuns(db: Database) {
  return db
    .query<RunRow, []>(
      "SELECT * FROM run WHERE finished_at IS NULL ORDER BY id",
    )
    .all()
    .map(run);
}

export function latestRun(db: Database, actionKey: string) {
  const row = db
    .query<RunRow, [string]>(
      "SELECT * FROM run WHERE action_key = ? ORDER BY id DESC LIMIT 1",
    )
    .get(actionKey);
  return row ? run(row) : null;
}

export function recentRuns(db: Database, limit: number) {
  return db
    .query<RunRow, [number]>("SELECT * FROM run ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map(run);
}

/** One line per event, for the owner to read; agents never pay to read it. */
export function feed(path: string, now: number, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${new Date(now).toISOString()}  ${text}\n`);
}
