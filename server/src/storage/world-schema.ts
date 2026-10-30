import type { Database } from "bun:sqlite";
import { closeSync, constants, fsyncSync, openSync, rmSync } from "node:fs";
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
 target TEXT CHECK(target IS NULL OR json_valid(target)), recovery TEXT NOT NULL CHECK(recovery IN ('repeatable','opaque')),
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
export const worldMigrations = [migration1] as const;

/** A consistent private rollback copy before any noninitial migration. */
function backupMigration(db: Database, path: string, version: number) {
  const backup = `${path}.v${version}.bak`;
  assertSafeDataPath(backup);
  const fd = openSync(
    backup,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  closeSync(fd);
  try {
    db.query("VACUUM INTO ?").run(backup);
    const sync = openSync(backup, constants.O_RDWR);
    try {
      fsyncSync(sync);
    } finally {
      closeSync(sync);
    }
  } catch (error) {
    rmSync(backup, { force: true });
    throw error;
  }
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
      `world.sqlite schema ${version} is newer than this service supports; stop World, preserve the data directory, and restore its matching world.sqlite.v<version>.bak before downgrading`,
    );
  return version;
}

export function migrateWorldDatabase(
  db: Database,
  path: string,
  migrations: readonly string[] = worldMigrations,
) {
  const version = worldDatabaseVersion(db, migrations);
  if (version > 0 && version < migrations.length)
    backupMigration(db, path, version);
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
    throw error;
  }
}
