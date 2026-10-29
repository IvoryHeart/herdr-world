import type { Database } from "bun:sqlite";

export type Finding = {
  id: string;
  reviewer: string;
  file: string | null;
  line: number | null;
  text: string;
  at: number;
  url: string;
  source?: string;
  reply?: string;
};

export type ReviewCycle = {
  pr: number;
  round: number;
  ordinal: number;
  head: string;
  since?: string;
  reviewers: string[];
  ignoredSources?: string[];
  trigger: { replies: string[]; quietSince: number; reason: string };
  /** Set by a go verdict; an empty list means no mandatory findings. */
  scope?: string[];
};

export type Evaluation = {
  pr: number;
  checkpoint: number;
  head: string;
  round: number;
  findings: Finding[];
  status: "evaluating" | "go" | "process" | "reported";
  verdict?: string;
  required?: string[];
  followups?: string[];
  process?: "splitter" | "fresh-fixer" | "visionary" | "restart" | "owner";
  seat?: string;
  next?: string;
  source?: string;
  report?: string;
};

export function initRoundPolicy(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_cycle (
      pr INTEGER NOT NULL, ordinal INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (pr, ordinal)
    );
    CREATE TABLE IF NOT EXISTS review_push (
      pr INTEGER NOT NULL, head TEXT NOT NULL, observed_at INTEGER NOT NULL,
      reason TEXT, PRIMARY KEY (pr, head)
    );
    CREATE TABLE IF NOT EXISTS review_evaluation (
      pr INTEGER NOT NULL, checkpoint INTEGER NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (pr, checkpoint)
    );
    CREATE TABLE IF NOT EXISTS review_skip (
      pr INTEGER NOT NULL, head TEXT NOT NULL, reason TEXT NOT NULL,
      observed_at INTEGER NOT NULL, PRIMARY KEY (pr, head, reason)
    );
  `);
}

export function reviewCycles(db: Database, pr: number): ReviewCycle[] {
  return db
    .query<{ data: string }, [number]>(
      "SELECT data FROM review_cycle WHERE pr = ? ORDER BY ordinal",
    )
    .all(pr)
    .map((row) => JSON.parse(row.data) as ReviewCycle);
}

export function saveCycle(db: Database, cycle: ReviewCycle) {
  db.query("INSERT OR REPLACE INTO review_cycle VALUES (?, ?, ?)").run(
    cycle.pr,
    cycle.ordinal,
    JSON.stringify(cycle),
  );
}

/** A repeated head can have several rounds with different evaluator scopes. */
export function cycleForRun(
  db: Database,
  pr: number,
  head: string,
  round: number | null,
) {
  const cycles = reviewCycles(db, pr);
  return round === null
    ? cycles.findLast((cycle) => cycle.head === head)
    : cycles.find((cycle) => cycle.round === round);
}

export function evaluations(db: Database, pr: number): Evaluation[] {
  return db
    .query<{ data: string }, [number]>(
      "SELECT data FROM review_evaluation WHERE pr = ? ORDER BY checkpoint",
    )
    .all(pr)
    .map((row) => JSON.parse(row.data) as Evaluation);
}

export function saveEvaluation(db: Database, value: Evaluation) {
  db.query("INSERT OR REPLACE INTO review_evaluation VALUES (?, ?, ?)").run(
    value.pr,
    value.checkpoint,
    JSON.stringify(value),
  );
}

/** Every observed push is durable, including pushes skipped while CI settles. */
export function recordPush(
  db: Database,
  pr: number,
  head: string,
  now: number,
  reason: string | null,
) {
  db.query(`INSERT INTO review_push VALUES (?, ?, ?, ?)
    ON CONFLICT(pr, head) DO UPDATE SET reason = excluded.reason`).run(
    pr,
    head,
    now,
    reason,
  );
  if (reason)
    db.query("INSERT OR IGNORE INTO review_skip VALUES (?, ?, ?, ?)").run(
      pr,
      head,
      reason,
      now,
    );
}

export function skippedPushes(db: Database, pr: number) {
  return db
    .query<{ head: string; reason: string; observed_at: number }, [number]>(
      "SELECT head, reason, observed_at FROM review_skip WHERE pr = ? ORDER BY observed_at, rowid",
    )
    .all(pr);
}
