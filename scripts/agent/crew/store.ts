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
  /** Its round's tab: one per PR head, kept until the PR closes. */
  tab: string | null;
  round: number | null;
  /** The harness, model and session, for reopening the run as a chat. */
  harness: string | null;
  model: string | null;
  session: string | null;
  /** The RESULT line the reviewer printed. */
  result: string | null;
  log: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  usage: string | null;
};

/** `busyMs`: how long a pass waits for another process's pass to finish acting. */
export function openCrewStore(path: string, busyMs = 120_000) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyMs))}`);
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
  for (const [name, type] of [
    ["pane", "TEXT"],
    ["tab", "TEXT"],
    ["round", "INTEGER"],
    ["harness", "TEXT"],
    ["model", "TEXT"],
    ["session", "TEXT"],
    ["result", "TEXT"],
  ])
    if (!columns.includes(name))
      db.exec(`ALTER TABLE run ADD COLUMN ${name} ${type}`);
  // A pod's rounds: each head reviewed on a PR gets one Herdr tab, which
  // stays until the PR merges or closes.
  db.exec(`
    CREATE TABLE IF NOT EXISTS round (
      pr INTEGER NOT NULL,
      round INTEGER NOT NULL,
      head TEXT NOT NULL,
      tab TEXT,
      created_at INTEGER NOT NULL,
      closed_at INTEGER,
      PRIMARY KEY (pr, round)
    );
    CREATE TABLE IF NOT EXISTS check_seen (
      url TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat (
      tab TEXT PRIMARY KEY,
      run_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
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

/**
 * Records a planned action the first time its key is seen, and re-arms one a
 * close superseded when a reopened PR plans it again; true if it is new.
 */
export function addAction(db: Database, planned: Action, now: number) {
  const result = db
    .query(
      `INSERT INTO action
        (key, pr, head, kind, target, text, since, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(key) DO UPDATE SET state = 'pending', attempts = 0,
         detail = NULL, updated_at = excluded.updated_at
       WHERE action.state = 'superseded'`,
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
  tab: string | null;
  round: number | null;
  harness: string | null;
  model: string | null;
  session: string | null;
  result: string | null;
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
    tab: row.tab,
    round: row.round,
    harness: row.harness,
    model: row.model,
    session: row.session,
    result: row.result,
    log: row.log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    usage: row.usage,
  };
}

export function addRun(
  db: Database,
  entry: Pick<StoredRun, "actionKey" | "reviewer" | "pr" | "head" | "log"> & {
    round?: number;
  },
  now: number,
) {
  return Number(
    db
      .query(
        `INSERT INTO run (action_key, reviewer, pr, head, log, round, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.actionKey,
        entry.reviewer,
        entry.pr,
        entry.head,
        entry.log,
        entry.round ?? null,
        now,
      ).lastInsertRowid,
  );
}

export function setRunPid(db: Database, id: number, pid: number) {
  db.query("UPDATE run SET pid = ? WHERE id = ?").run(pid, id);
}

export function setRunPane(
  db: Database,
  id: number,
  pane: string,
  tab: string | null = null,
) {
  db.query("UPDATE run SET pane = ?, tab = ? WHERE id = ?").run(pane, tab, id);
}

export function setRunSession(
  db: Database,
  id: number,
  harness: string,
  model: string,
  session: string | null,
) {
  db.query(
    "UPDATE run SET harness = ?, model = ?, session = ? WHERE id = ?",
  ).run(harness, model, session, id);
}

/**
 * When the watcher first saw each of these checks running. `record` notes
 * any seen for the first time now; `forget` drops the checks no longer
 * running, which only a pass over every PR may do. A dry run does neither.
 */
export function runningSince(
  db: Database,
  urls: string[],
  now: number,
  options: { record: boolean; forget: boolean },
) {
  const since = new Map<string, number>();
  if (options.forget)
    db.query(
      `DELETE FROM check_seen WHERE url NOT IN (${urls.map(() => "?").join(", ")})`,
    ).run(...urls);
  for (const url of urls) {
    if (options.record)
      db.query(
        "INSERT OR IGNORE INTO check_seen (url, first_seen) VALUES (?, ?)",
      ).run(url, now);
    const row = db
      .query<{ first_seen: number }, [string]>(
        "SELECT first_seen FROM check_seen WHERE url = ?",
      )
      .get(url);
    since.set(url, row?.first_seen ?? now);
  }
  return since;
}

/** A chat tab `open` started for a run; it closes with the run's round. */
export function addChat(db: Database, tab: string, runId: number) {
  db.query("INSERT OR REPLACE INTO chat (tab, run_id) VALUES (?, ?)").run(
    tab,
    runId,
  );
}

/**
 * Every tab a round has used: its reviewers' tabs (a replacement tab when
 * the owner closed one) and the chat tabs reopened from its runs.
 */
export function roundTabs(db: Database, pr: number, round: number) {
  return db
    .query<{ tab: string }, [number, number, number, number]>(
      `SELECT tab FROM run WHERE pr = ? AND round = ? AND tab IS NOT NULL
       UNION
       SELECT chat.tab FROM chat JOIN run ON run.id = chat.run_id
       WHERE run.pr = ? AND run.round = ?`,
    )
    .all(pr, round, pr, round)
    .map((row) => row.tab);
}

export function roundClosed(db: Database, pr: number, round: number | null) {
  const row = db
    .query<{ closed_at: number | null }, [number, number]>(
      "SELECT closed_at FROM round WHERE pr = ? AND round = ?",
    )
    .get(pr, round ?? -1);
  return row ? row.closed_at !== null : true;
}

export function setRunResult(db: Database, id: number, result: string) {
  db.query("UPDATE run SET result = ? WHERE id = ?").run(result, id);
}

/** The panes a round's reviewers run in, oldest first. */
export function roundPanes(db: Database, pr: number, round: number) {
  return db
    .query<{ pane: string }, [number, number]>(
      `SELECT pane FROM run WHERE pr = ? AND round = ? AND pane IS NOT NULL
       ORDER BY id`,
    )
    .all(pr, round)
    .map((row) => row.pane);
}

export type Round = {
  pr: number;
  round: number;
  head: string;
  tab: string | null;
};

/** A PR head's open round, numbering a new one after the PR's last. */
export function roundFor(db: Database, pr: number, head: string, now: number) {
  const found = db
    .query<Round, [number, string]>(
      `SELECT pr, round, head, tab FROM round
       WHERE pr = ? AND head = ? AND closed_at IS NULL`,
    )
    .get(pr, head);
  if (found) return found;
  const last = db
    .query<{ round: number | null }, [number]>(
      "SELECT MAX(round) AS round FROM round WHERE pr = ?",
    )
    .get(pr);
  const round = (last?.round ?? 0) + 1;
  db.query(
    "INSERT INTO round (pr, round, head, created_at) VALUES (?, ?, ?, ?)",
  ).run(pr, round, head, now);
  return { pr, round, head, tab: null };
}

export function setRoundTab(
  db: Database,
  pr: number,
  round: number,
  tab: string,
) {
  db.query("UPDATE round SET tab = ? WHERE pr = ? AND round = ?").run(
    tab,
    pr,
    round,
  );
}

export function openRounds(db: Database) {
  return db
    .query<Round, []>(
      "SELECT pr, round, head, tab FROM round WHERE closed_at IS NULL ORDER BY pr, round",
    )
    .all();
}

export function closeRound(
  db: Database,
  pr: number,
  round: number,
  now: number,
) {
  db.query("UPDATE round SET closed_at = ? WHERE pr = ? AND round = ?").run(
    now,
    pr,
    round,
  );
}

/** A PR's runs, or one reviewer's; newest first. */
export function runsOf(db: Database, pr: number, reviewer?: string) {
  return db
    .query<RunRow, [number, string, string]>(
      `SELECT * FROM run WHERE pr = ? AND (? = '' OR reviewer = ?)
       ORDER BY id DESC`,
    )
    .all(pr, reviewer ?? "", reviewer ?? "")
    .map(run);
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

/** Reviewer runs started at or after `since`. */
export function runsSince(db: Database, since: number) {
  return db
    .query<RunRow, [number]>(
      "SELECT * FROM run WHERE started_at >= ? ORDER BY id",
    )
    .all(since)
    .map(run);
}

/** A small value the watcher keeps, such as the last mark it set on a PR. */
export function getMeta(db: Database, key: string) {
  return (
    db
      .query<{ value: string }, [string]>(
        "SELECT value FROM meta WHERE key = ?",
      )
      .get(key)?.value ?? null
  );
}

/** The values kept under keys that start with `prefix`. */
export function metaWithPrefix(db: Database, prefix: string) {
  return db
    .query<{ key: string; value: string }, [string]>(
      "SELECT key, value FROM meta WHERE substr(key, 1, length(?1)) = ?1 ORDER BY key",
    )
    .all(prefix);
}

export function setMeta(db: Database, key: string, value: string) {
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
}

export function recentRuns(db: Database, limit: number) {
  return db
    .query<RunRow, [number]>("SELECT * FROM run ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map(run);
}

/**
 * The crew's pass lock: a write transaction held on its own small database
 * while a pass acts. The OS drops it if the process dies, and the action
 * store itself commits every step as it happens.
 */
export function openLock(path: string, busyMs = 120_000) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyMs))}`);
  return db;
}

export function holdLock<T>(lock: Database, act: () => T): T {
  lock.exec("BEGIN IMMEDIATE");
  try {
    return act();
  } finally {
    lock.exec("ROLLBACK");
  }
}

/** One line per event, for the owner to read; agents never pay to read it. */
export function feed(path: string, now: number, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${new Date(now).toISOString()}  ${text}\n`);
}
