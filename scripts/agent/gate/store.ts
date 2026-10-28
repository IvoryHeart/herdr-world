import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GateConfig, GateInput, Verdict, VerdictState } from "./predicate";

/**
 * The gate's local record: one transaction per pass, so a crash leaves the
 * previous pass intact. Observations keep the exact predicate input (comment
 * text is already reduced to RESULT lines), so any pass can be replayed.
 * A verdict row is written only when it differs from the PR's latest one;
 * rows are therefore transitions.
 */

export const PARSER_VERSION = 1;

export type StoredVerdict = Verdict & {
  id: number;
  passId: number;
  computedAt: number;
  lastSeenAt: number;
};

export type Decision = {
  id: number;
  pr: number;
  kind: "hold" | "release" | "waive";
  /** The unattributed RESULT post a waiver resolves. */
  sourceId?: string;
  reason: string;
  actor: string;
  createdAt: number;
};

export function openStore(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pass (
      id INTEGER PRIMARY KEY,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      parser_version INTEGER NOT NULL,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observation (
      id INTEGER PRIMARY KEY,
      pass_id INTEGER NOT NULL REFERENCES pass(id),
      pr INTEGER NOT NULL,
      kind TEXT NOT NULL,
      head_sha TEXT,
      fetched_at INTEGER NOT NULL,
      body_hash TEXT NOT NULL,
      body_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS observation_pr ON observation(pr, pass_id);
    CREATE TABLE IF NOT EXISTS claim (
      pr INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      reviewer TEXT,
      url TEXT NOT NULL,
      posted_at INTEGER NOT NULL,
      reviewed_commit TEXT,
      outcome TEXT NOT NULL,
      line TEXT NOT NULL,
      first_pass INTEGER NOT NULL,
      PRIMARY KEY (pr, source_id)
    );
    CREATE TABLE IF NOT EXISTS check_attempt (
      run_id INTEGER NOT NULL,
      attempt INTEGER NOT NULL,
      check_name TEXT NOT NULL,
      pr INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      conclusion TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, attempt, check_name)
    );
    CREATE TABLE IF NOT EXISTS decision (
      id INTEGER PRIMARY KEY,
      pr INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('hold', 'release', 'waive')),
      source_id TEXT,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verdict (
      id INTEGER PRIMARY KEY,
      pr INTEGER NOT NULL,
      head_sha TEXT,
      state TEXT NOT NULL,
      conditions_json TEXT NOT NULL,
      notes_json TEXT NOT NULL,
      digest TEXT NOT NULL,
      pass_id INTEGER NOT NULL REFERENCES pass(id),
      computed_at INTEGER NOT NULL,
      last_pass INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS verdict_pr ON verdict(pr, id);
  `);
  return db;
}

const hash = (value: unknown) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");

export const configHash = hash;

/** What makes two verdicts the same: head, state, conditions and notes. */
export const verdictDigest = (verdict: Verdict) =>
  hash([verdict.head, verdict.state, verdict.conditions, verdict.notes]);

/** Everything one pass learned, written atomically. */
export function recordPass(
  db: Database,
  pass: {
    trigger: string;
    config: GateConfig;
    startedAt: number;
    finishedAt: number;
    inputs: GateInput[];
    verdicts: Verdict[];
  },
) {
  return db.transaction(() => {
    const row = db
      .query(
        "INSERT INTO pass (started_at, finished_at, trigger, parser_version, config_hash, config_json) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get(
        pass.startedAt,
        pass.finishedAt,
        pass.trigger,
        PARSER_VERSION,
        configHash(pass.config),
        JSON.stringify(pass.config),
      ) as {
      id: number;
    };
    const passId = row.id;
    for (const input of pass.inputs) {
      const head = input.item?.headSha ?? null;
      db.query(
        "INSERT INTO observation (pass_id, pr, kind, head_sha, fetched_at, body_hash, body_json) VALUES (?, ?, 'input', ?, ?, ?, ?)",
      ).run(
        passId,
        input.number,
        head,
        input.readAt,
        hash(input),
        JSON.stringify(input),
      );
      for (const claim of input.item?.pr?.reviewers ?? [])
        db.query(
          "INSERT OR IGNORE INTO claim (pr, source_id, reviewer, url, posted_at, reviewed_commit, outcome, line, first_pass) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          input.number,
          claim.sourceId ?? claim.url,
          claim.reviewer,
          claim.url,
          claim.at,
          claim.commit,
          claim.outcome,
          claim.line,
          passId,
        );
      for (const attempt of input.attempts)
        db.query(
          "INSERT OR IGNORE INTO check_attempt (run_id, attempt, check_name, pr, head_sha, conclusion, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          attempt.runId,
          attempt.attempt,
          attempt.name,
          input.number,
          head ?? "",
          attempt.conclusion,
          attempt.completedAt,
        );
    }
    for (const verdict of pass.verdicts) {
      const digest = verdictDigest(verdict);
      const latest = db
        .query(
          "SELECT id, digest FROM verdict WHERE pr = ? ORDER BY id DESC LIMIT 1",
        )
        .get(verdict.number) as { id: number; digest: string } | null;
      if (latest?.digest === digest)
        db.query(
          "UPDATE verdict SET last_pass = ?, last_seen_at = ? WHERE id = ?",
        ).run(passId, pass.finishedAt, latest.id);
      else
        db.query(
          "INSERT INTO verdict (pr, head_sha, state, conditions_json, notes_json, digest, pass_id, computed_at, last_pass, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          verdict.number,
          verdict.head,
          verdict.state,
          JSON.stringify(verdict.conditions),
          JSON.stringify(verdict.notes),
          digest,
          passId,
          pass.finishedAt,
          passId,
          pass.finishedAt,
        );
    }
    return passId;
  })();
}

type VerdictRow = {
  id: number;
  pr: number;
  head_sha: string | null;
  state: string;
  conditions_json: string;
  notes_json: string;
  pass_id: number;
  computed_at: number;
  last_seen_at: number;
};

const toVerdict = (row: VerdictRow): StoredVerdict => ({
  id: row.id,
  number: row.pr,
  head: row.head_sha,
  state: row.state as VerdictState,
  conditions: JSON.parse(row.conditions_json),
  notes: JSON.parse(row.notes_json),
  passId: row.pass_id,
  computedAt: row.computed_at,
  lastSeenAt: row.last_seen_at,
});

export function latestVerdict(db: Database, pr: number): StoredVerdict | null {
  const row = db
    .query("SELECT * FROM verdict WHERE pr = ? ORDER BY id DESC LIMIT 1")
    .get(pr) as VerdictRow | null;
  return row ? toVerdict(row) : null;
}

/** Verdict changes written by passes after `since`. */
export function transitions(db: Database, since: number): StoredVerdict[] {
  return (
    db
      .query("SELECT * FROM verdict WHERE pass_id > ? ORDER BY id")
      .all(since) as VerdictRow[]
  ).map(toVerdict);
}

/** The config a pass evaluated with, so replay judges it the same way. */
export function passConfig(db: Database, passId: number): GateConfig | null {
  const row = db
    .query("SELECT config_json FROM pass WHERE id = ?")
    .get(passId) as { config_json: string } | null;
  return row ? JSON.parse(row.config_json) : null;
}

export function latestPass(db: Database) {
  return db.query("SELECT * FROM pass ORDER BY id DESC LIMIT 1").get() as {
    id: number;
    finished_at: number;
    config_hash: string;
  } | null;
}

export function latestInput(db: Database, pr: number): GateInput | null {
  const row = db
    .query(
      "SELECT body_json FROM observation WHERE pr = ? ORDER BY id DESC LIMIT 1",
    )
    .get(pr) as { body_json: string } | null;
  return row ? JSON.parse(row.body_json) : null;
}

export function passInputs(db: Database, passId: number): GateInput[] {
  return (
    db
      .query("SELECT body_json FROM observation WHERE pass_id = ? ORDER BY id")
      .all(passId) as { body_json: string }[]
  ).map((row) => JSON.parse(row.body_json));
}

/**
 * Each PR as last seen since the latest pass over every open PR: that pass's
 * PRs, updated by the scoped passes after it, which read only busy PRs; with
 * no such pass yet, every PR any scoped pass read. Null when no pass has been
 * recorded.
 */
export function currentInputs(db: Database): GateInput[] | null {
  if (!latestPass(db)) return null;
  const full = db
    .query(
      "SELECT id FROM pass WHERE trigger = 'open' ORDER BY id DESC LIMIT 1",
    )
    .get() as { id: number } | null;
  return (
    db
      .query(
        `SELECT body_json FROM observation o
         WHERE o.pass_id >= ?1
           AND o.id = (SELECT MAX(id) FROM observation WHERE pr = o.pr AND pass_id >= ?1)
         ORDER BY o.pr`,
      )
      .all(full?.id ?? 0) as { body_json: string }[]
  ).map((row) => JSON.parse(row.body_json));
}

/** The verdict each PR had as of `passId`. */
export function verdictsAt(db: Database, passId: number): StoredVerdict[] {
  return (
    db
      .query(
        "SELECT v.* FROM verdict v WHERE v.id = (SELECT MAX(id) FROM verdict WHERE pr = v.pr AND pass_id <= ?) ORDER BY v.pr",
      )
      .all(passId) as VerdictRow[]
  ).map(toVerdict);
}

export function addDecision(db: Database, decision: Omit<Decision, "id">) {
  db.query(
    "INSERT INTO decision (pr, kind, source_id, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    decision.pr,
    decision.kind,
    decision.sourceId ?? null,
    decision.reason,
    decision.actor,
    decision.createdAt,
  );
}

/** A hold lasts across heads until someone releases it. */
export function activeHold(db: Database, pr: number) {
  const row = db
    .query(
      "SELECT kind, reason, created_at FROM decision WHERE pr = ? AND kind IN ('hold', 'release') ORDER BY id DESC LIMIT 1",
    )
    .get(pr) as { kind: string; reason: string; created_at: number } | null;
  return row?.kind === "hold"
    ? { reason: row.reason, at: row.created_at }
    : null;
}

/** Unattributed RESULT posts explicitly resolved for this PR. */
export function waivedSources(db: Database, pr: number): string[] {
  return (
    db
      .query(
        "SELECT source_id FROM decision WHERE pr = ? AND kind = 'waive' AND source_id IS NOT NULL",
      )
      .all(pr) as { source_id: string }[]
  ).map((row) => row.source_id);
}
