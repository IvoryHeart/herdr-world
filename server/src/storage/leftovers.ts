import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeDataPath, publishDataFile } from "../config/data-paths";

/** Schema 17: version 16 is already the immutable Board elements migration. */
export function migrateLeftovers(db: Database, _at: number, database: string) {
  const reviews = db
    .query("SELECT * FROM retired_completion_reviews ORDER BY original_order")
    .all();
  if (reviews.length) {
    const contents = JSON.stringify(reviews) + "\n";
    const hash = createHash("sha256").update(contents).digest("hex");
    const path = join(
      dirname(database),
      "legacy",
      `retired-completion-reviews.${hash}.json`,
    );
    assertSafeDataPath(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Atomic, private, no-overwrite publication; retry verifies the same bytes.
    publishDataFile(path, contents);
    if (lstatSync(path).nlink !== 1 || readFileSync(path, "utf8") !== contents)
      throw new Error("Legacy review export differs from the source rows");
    chmodSync(path, 0o600);
  }
  db.exec(`CREATE TABLE meta (name TEXT PRIMARY KEY, body TEXT NOT NULL CHECK(json_valid(body)));
    INSERT INTO meta SELECT name,json_object('content_hash',content_hash,'completed_at',completed_at) FROM imports;
    INSERT INTO meta VALUES('profiles.assignments',
      (SELECT json_group_array(json_object('connection_id',connection_id,'terminal_id',terminal_id,'profile_id',profile_id))
        FROM (SELECT * FROM profile_legacy_assignments ORDER BY position)));
    INSERT INTO meta VALUES('profiles.imported-connections',
      (SELECT json_group_array(connection_id) FROM (SELECT * FROM profile_imported_connections ORDER BY position)));
    CREATE TABLE command_changes (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
    INSERT INTO command_changes(rowid,id,created_at,body) SELECT rowid,id,created_at,body FROM ledger_changes;`);
  const count = (table: string) =>
    (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  if (count("command_changes") !== count("ledger_changes"))
    throw new Error("Command history migration row count differs");
  if (count("imports") !== count("meta") - 2)
    throw new Error("Import marker migration row count differs");
  for (const [table, key] of [
    ["profile_legacy_assignments", "profiles.assignments"],
    ["profile_imported_connections", "profiles.imported-connections"],
  ]) {
    const row = db
      .query("SELECT json_array_length(body) AS n FROM meta WHERE name=?")
      .get(key!) as { n: number };
    if (row.n !== count(table!))
      throw new Error("Profile metadata migration row count differs");
  }
  db.exec(`DROP TRIGGER ledger_changes_reserve_ids;
    CREATE TRIGGER command_changes_reserve_ids AFTER INSERT ON command_changes BEGIN
      INSERT INTO world_ids(id) SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM world_ids WHERE id=NEW.id);
    END;
    ALTER TABLE ledger_changes RENAME TO retired_ledger_changes;
    DROP TABLE profile_legacy_assignments;
    DROP TABLE profile_imported_connections;
    DROP TABLE imports;
    DROP TABLE retired_completion_reviews;`);
}
