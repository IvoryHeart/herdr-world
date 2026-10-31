import type { Database } from "bun:sqlite";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  mkdtempSync,
  openSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { newWorldId } from "./world-identifiers";
import { worldIdsMigration } from "./world-ids";
import { assertSafeDataPath } from "../config/data-paths";

export const WORLD_APPLICATION_ID = 0x574f524c;
const migration1 = `
CREATE TABLE ledger_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0),
 replay_floor INTEGER NOT NULL DEFAULT 0 CHECK(replay_floor>=0)
);
INSERT INTO ledger_meta VALUES(1,0,0);
CREATE TABLE asks (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, resolved_at INTEGER, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE results (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE ledger_changes (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE outbox (
 id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL,
 target TEXT CHECK(target IS NULL OR json_valid(target)), recovery TEXT NOT NULL CHECK(recovery IN ('keyed','reconcilable','reattachable','repeatable','opaque')),
 state TEXT NOT NULL CHECK(state IN ('pending','dispatching','delivered','uncertain','refused','cancelled')),
 due_at INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
 evidence TEXT CHECK(evidence IS NULL OR json_valid(evidence)), created_at INTEGER NOT NULL, resolved_at INTEGER,
 CHECK((state IN ('delivered','refused','cancelled'))=(resolved_at IS NOT NULL)), UNIQUE(kind,record_id)
);
CREATE INDEX outbox_work ON outbox(state,due_at);
CREATE INDEX outbox_record ON outbox(record_id,state);
CREATE TABLE replay_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL, committed_at INTEGER NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL);
CREATE INDEX replay_age ON replay_changes(committed_at);
CREATE TABLE imports (name TEXT PRIMARY KEY,content_hash TEXT NOT NULL,completed_at INTEGER NOT NULL);
`;
const migration2 = `
ALTER TABLE outbox ADD COLUMN intent TEXT CHECK(intent IS NULL OR json_valid(intent));
ALTER TABLE outbox ADD COLUMN claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1));
ALTER TABLE outbox ADD COLUMN cli_received_at INTEGER;
CREATE INDEX outbox_dispatch ON outbox(kind,claimed,state,due_at);
CREATE TABLE answer_attempts (
 intent_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
 attempt INTEGER NOT NULL CHECK(attempt>0),
 state TEXT NOT NULL CHECK(state IN ('claimed','pending','dispatching','delivered','uncertain','refused','cancelled')),
 fence TEXT CHECK(fence IS NULL OR json_valid(fence)), created_at INTEGER NOT NULL, finished_at INTEGER,
 reason TEXT NOT NULL, PRIMARY KEY(intent_id,attempt)
);
CREATE INDEX answer_attempt_status ON answer_attempts(intent_id,state,attempt);
CREATE UNIQUE INDEX asks_answer_occurrence ON asks(json_extract(body,'$.answer.occurrence')) WHERE json_extract(body,'$.answer.occurrence') IS NOT NULL;
`;
const migration4 = `
ALTER TABLE outbox ADD COLUMN contract TEXT CHECK(contract IS NULL OR json_valid(contract));
ALTER TABLE outbox ADD COLUMN receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt));
ALTER TABLE outbox ADD COLUMN external_handle TEXT CHECK(external_handle IS NULL OR json_valid(external_handle));
ALTER TABLE outbox ADD COLUMN dispatch_targets TEXT CHECK(dispatch_targets IS NULL OR json_valid(dispatch_targets));
ALTER TABLE outbox ADD COLUMN ever_dispatched INTEGER NOT NULL DEFAULT 0 CHECK(ever_dispatched IN (0,1));
ALTER TABLE outbox ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1));
ALTER TABLE outbox ADD COLUMN needs_migration INTEGER NOT NULL DEFAULT 0 CHECK(needs_migration IN (0,1));
ALTER TABLE outbox ADD COLUMN owner_retry_attempt INTEGER;
ALTER TABLE outbox ADD COLUMN attempt_fence TEXT CHECK(attempt_fence IS NULL OR json_valid(attempt_fence));
UPDATE outbox SET ever_dispatched=1 WHERE state IN ('dispatching','uncertain','delivered') OR (kind<>'world.ask.deliver-answer' AND attempt>0) OR EXISTS(SELECT 1 FROM answer_attempts WHERE intent_id=outbox.id AND state IN ('dispatching','uncertain','delivered'));
ALTER TABLE answer_attempts ADD COLUMN receipt TEXT CHECK(receipt IS NULL OR json_valid(receipt));
ALTER TABLE answer_attempts ADD COLUMN external_handle TEXT CHECK(external_handle IS NULL OR json_valid(external_handle));
ALTER TABLE answer_attempts ADD COLUMN attempt_fence TEXT CHECK(attempt_fence IS NULL OR json_valid(attempt_fence));
CREATE TABLE effect_decisions (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, intent_id TEXT NOT NULL REFERENCES outbox(id) ON DELETE CASCADE,
 action TEXT NOT NULL, actor TEXT NOT NULL CHECK(json_valid(actor)), reason TEXT NOT NULL,
 created_at INTEGER NOT NULL, previous_version INTEGER, operation_version INTEGER
);
CREATE INDEX effect_decisions_intent ON effect_decisions(intent_id,seq);
CREATE INDEX effect_ready ON outbox(needs_migration,claimed,state,due_at);
`;
export const worldMigrations = [
  migration1,
  migration2,
  worldIdsMigration,
  migration4,
] as const;

/** A consistent private rollback copy before any noninitial migration. */
function backupMigration(db: Database, path: string, version: number) {
  const snapshotPath = (id: string) => `${path}.v${version}.${id.slice(2)}.bak`;
  const backup = snapshotPath(
    newWorldId("b", (id) => existsSync(snapshotPath(id))),
  );
  assertSafeDataPath(backup);
  // Native macOS SQLite requires VACUUM's destination not to exist. A private
  // staging directory keeps it private until chmod/fsync and atomic publication.
  const staging = mkdtempSync(join(dirname(path), ".world-snapshot-"));
  const staged = join(staging, "snapshot.sqlite");
  try {
    db.query("VACUUM INTO ?").run(staged);
    chmodSync(staged, 0o600);
    const sync = openSync(staged, constants.O_RDWR);
    try {
      fsyncSync(sync);
    } finally {
      closeSync(sync);
    }
    // Hard-link publication never replaces an earlier snapshot or a racer.
    linkSync(staged, backup);
  } catch (error) {
    throw new Error(
      `Cannot preserve World schema ${version} snapshot at ${backup}: ${(error as Error).message}`,
      { cause: error },
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  if (process.platform !== "win32") {
    try {
      const directory = openSync(
        dirname(path),
        constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
      );
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      /* Directory fsync is best effort, as for other private data files. */
    }
  }
  return backup;
}

/** Validate ownership/version before changing journaling or file permissions. */
export function worldDatabaseVersion(
  db: Database,
  migrations: readonly string[] = worldMigrations,
) {
  const application = (
    db.query("PRAGMA application_id").get() as { application_id: number }
  ).application_id;
  if (application !== 0 && application !== WORLD_APPLICATION_ID)
    throw new Error("world.sqlite belongs to another application");
  const version = (
    db.query("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version > migrations.length)
    throw new Error(
      `world.sqlite schema ${version} is newer than this service supports; stop World, preserve the data directory, and restore its matching world.sqlite.v<version>.<snapshot>.bak before downgrading`,
    );
  return version;
}

export function migrateWorldDatabase(
  db: Database,
  path: string,
  migrations: readonly string[] = worldMigrations,
) {
  const version = worldDatabaseVersion(db, migrations);
  const backup =
    version > 0 && version < migrations.length
      ? backupMigration(db, path, version)
      : undefined;
  db.exec("BEGIN EXCLUSIVE");
  try {
    for (let index = version; index < migrations.length; index++)
      db.exec(migrations[index]!);
    db.exec(
      `PRAGMA application_id=${WORLD_APPLICATION_ID}; PRAGMA user_version=${migrations.length}`,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (backup)
      throw new Error(
        `World schema upgrade failed; snapshot preserved at ${backup}: ${(error as Error).message}`,
        { cause: error },
      );
    throw error;
  }
  return backup;
}
