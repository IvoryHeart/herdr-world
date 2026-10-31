import type { Database } from "bun:sqlite";
import {
  ProfileStore,
  type ProfilesDocument,
  type ProfileAssignment,
} from "../agent/profile-store";

export const worldProfilesMigration = `
CREATE TABLE profile_store_meta (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>=0),
 highest_master_revision INTEGER NOT NULL CHECK(highest_master_revision>=0),
 legacy_master_connection TEXT, legacy_master_terminal TEXT,
 CHECK((legacy_master_connection IS NULL)=(legacy_master_terminal IS NULL))
);
CREATE TABLE agent_profiles (
 id TEXT PRIMARY KEY REFERENCES world_ids(id), position INTEGER NOT NULL CHECK(position>=0),
 body TEXT NOT NULL CHECK(json_valid(body) AND json_type(body,'$.id') IS 'text' AND json_extract(body,'$.id')=id)
);
CREATE TABLE profile_chimes (singleton INTEGER PRIMARY KEY CHECK(singleton=1), body TEXT NOT NULL CHECK(json_valid(body)));
CREATE TABLE profile_legacy_assignments (
 position INTEGER PRIMARY KEY CHECK(position>=0), connection_id TEXT NOT NULL, terminal_id TEXT NOT NULL, profile_id TEXT NOT NULL
);
CREATE TABLE profile_imported_connections (
 connection_id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0)
);
`;
export type ProfileOperation =
  | { type: "save"; profile: unknown }
  | { type: "chimes"; chimes: unknown }
  | { type: "delete"; id: string }
  | { type: "assign"; assignment: ProfileAssignment }
  | { type: "legacy-master"; terminal: unknown; replace?: boolean }
  | { type: "remember-master"; revision: number }
  | { type: "next-master"; minimum: number }
  | { type: "finish-import"; connectionId: string };

export function readProfiles(db: Database): ProfilesDocument | null {
  const meta = db
    .query("SELECT * FROM profile_store_meta WHERE singleton=1")
    .get() as {
    revision: number;
    highest_master_revision: number;
    legacy_master_connection: string | null;
    legacy_master_terminal: string | null;
  } | null;
  if (!meta) return null;
  const chimes = db
    .query("SELECT body FROM profile_chimes WHERE singleton=1")
    .get() as { body: string };
  return {
    version: 1,
    revision: meta.revision,
    profiles: (
      db
        .query("SELECT body FROM agent_profiles ORDER BY position,id")
        .all() as { body: string }[]
    ).map((row) => JSON.parse(row.body)),
    chimes: JSON.parse(chimes.body),
    assignments: db
      .query(
        "SELECT connection_id,terminal_id,profile_id FROM profile_legacy_assignments ORDER BY position",
      )
      .all() as ProfileAssignment[],
    town_master:
      meta.legacy_master_connection === null
        ? null
        : {
            connection_id: meta.legacy_master_connection,
            terminal_id: meta.legacy_master_terminal!,
          },
    terminal_settings: {
      highest_master_revision: meta.highest_master_revision,
      imported_connections: (
        db
          .query(
            "SELECT connection_id FROM profile_imported_connections ORDER BY position",
          )
          .all() as { connection_id: string }[]
      ).map((row) => row.connection_id),
    },
  };
}

/** Called inside the worker's import transaction or per-operation savepoint. */
export function writeProfiles(db: Database, next: ProfilesDocument) {
  const state = next.terminal_settings ?? {
    imported_connections: [],
    highest_master_revision: 0,
  };
  if (!Number.isSafeInteger(next.revision) || next.revision < 0)
    throw new Error("invalid profile revision");
  const reserve = db.query(
    "INSERT INTO world_ids(id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM world_ids WHERE id=?)",
  );
  for (const id of [
    ...next.profiles.map((profile) => profile.id),
    ...next.assignments.map((assignment) => assignment.profile_id),
  ])
    reserve.run(id, id);
  const keep = new Set(next.profiles.map((profile) => profile.id));
  for (const row of db.query("SELECT id FROM agent_profiles").all() as {
    id: string;
  }[])
    if (!keep.has(row.id))
      db.query("DELETE FROM agent_profiles WHERE id=?").run(row.id);
  const put =
    db.query(`INSERT INTO agent_profiles(id,position,body) VALUES(?,?,?)
    ON CONFLICT(id) DO UPDATE SET position=excluded.position,body=excluded.body
    WHERE agent_profiles.position<>excluded.position OR agent_profiles.body<>excluded.body`);
  next.profiles.forEach((profile, position) =>
    put.run(profile.id, position, JSON.stringify(profile)),
  );
  db.query(`INSERT INTO profile_chimes VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body
    WHERE profile_chimes.body<>excluded.body`).run(JSON.stringify(next.chimes));
  db.exec(
    "DELETE FROM profile_legacy_assignments; DELETE FROM profile_imported_connections",
  );
  next.assignments.forEach((assignment, position) =>
    db
      .query("INSERT INTO profile_legacy_assignments VALUES(?,?,?,?)")
      .run(
        position,
        assignment.connection_id,
        assignment.terminal_id,
        assignment.profile_id,
      ),
  );
  state.imported_connections.forEach((id, position) =>
    db
      .query("INSERT INTO profile_imported_connections VALUES(?,?)")
      .run(id, position),
  );
  db.query(`INSERT INTO profile_store_meta VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET
    revision=excluded.revision,highest_master_revision=excluded.highest_master_revision,
    legacy_master_connection=excluded.legacy_master_connection,legacy_master_terminal=excluded.legacy_master_terminal`).run(
    next.revision,
    state.highest_master_revision,
    next.town_master?.connection_id ?? null,
    next.town_master?.terminal_id ?? null,
  );
}

/** Each operation reads fresh committed/transaction-local state, never a parent's cached document. */
export function executeProfileOperation(
  db: Database,
  operation: ProfileOperation,
): ProfilesDocument {
  const document = readProfiles(db);
  if (!document) throw new Error("World profiles were not initialized");
  const store = new ProfileStore({
    read: () => document,
    commit: (next) => writeProfiles(db, next),
  });
  switch (operation.type) {
    case "save":
      store.save(operation.profile);
      break;
    case "chimes":
      store.saveChimes(operation.chimes);
      break;
    case "delete":
      store.delete(operation.id);
      break;
    case "assign":
      store.assign(operation.assignment);
      break;
    case "legacy-master":
      store.setTownMaster(operation.terminal, { replace: operation.replace });
      break;
    case "remember-master":
      store.rememberMaster(operation.revision);
      break;
    case "next-master":
      store.nextMasterRevision(operation.minimum);
      break;
    case "finish-import":
      store.finishSettingsImport(operation.connectionId);
      break;
    default:
      throw new Error("invalid profile operation");
  }
  return store.get();
}
