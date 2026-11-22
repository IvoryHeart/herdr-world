import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apartmentsMigration, apartmentSessionsMigration } from "./apartments";
import { readBoard, worldBoardElementsMigration } from "./world-board";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import { openWorldWriter } from "./world-writer";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const previewMigrations = [
  ...worldMigrations.slice(0, 13),
  worldBoardElementsMigration,
];
const note = { id: "sticky", text: "Keep me", color: "yellow", x: 1, y: 2 };
const element = {
  id: "draft",
  kind: "document" as const,
  title: "Draft",
  x: 3,
  y: 4,
  rev: 7,
  source: { text: "Keep this draft" },
};
function fixture(migrations = previewMigrations) {
  const root = mkdtempSync(join(tmpdir(), "board-schema-upgrade-"));
  roots.push(root);
  const path = join(root, "world.sqlite");
  const db = new Database(path);
  migrateWorldDatabase(db, path, migrations, 1000);
  db.exec("INSERT INTO board_meta VALUES(1,7,0,0,0)");
  db.query(
    "INSERT INTO board_notes(key,position,row_revision,body) VALUES(?,0,7,?)",
  ).run(note.id, JSON.stringify(note));
  if (migrations.includes(worldBoardElementsMigration))
    db.query(
      "INSERT INTO board_elements(key,position,row_revision,body) VALUES(?,0,7,?)",
    ).run(element.id, JSON.stringify(element));
  return { root, path, db };
}
const tables = (db: Database) =>
  db
    .query(
      "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
    )
    .all();

test("Board migration follows main's immutable Apartments versions", () => {
  expect(worldMigrations[13]).toBe(apartmentsMigration);
  expect(worldMigrations[14]).toBe(apartmentSessionsMigration);
  expect(worldMigrations[15]).toBe(worldBoardElementsMigration);
});

test.each([
  ["release v13", worldMigrations.slice(0, 13)],
  ["main v14", worldMigrations.slice(0, 14)],
  ["main v15", worldMigrations.slice(0, 15)],
  ["Board-only preview v14", previewMigrations],
  ["current v16", [...worldMigrations]],
] as const)(
  "%s upgrades with records, backup and repeated startup intact",
  (_, migrations) => {
    const { root, path, db } = fixture([...migrations]);
    const hasElements = migrations.includes(worldBoardElementsMigration);
    const hasApartments = migrations.includes(apartmentsMigration);
    const resident = JSON.stringify({
      harness: "codex",
      session_id: "synthetic-session",
    });
    if (hasApartments)
      db.query(
        "INSERT INTO apartment_residents(id,moved_out_at,body) VALUES('resident',1,?)",
      ).run(resident);
    const hasEvictions = migrations.includes(apartmentSessionsMigration);
    if (hasEvictions)
      db.exec(
        "INSERT INTO apartment_evictions VALUES('codex/evicted-session',2)",
      );
    const before = tables(db);
    const noteRow = db.query("SELECT * FROM board_notes").all();
    const elementRows = hasElements
      ? db.query("SELECT * FROM board_elements").all()
      : [];
    try {
      const backupPath = migrateWorldDatabase(db, path, worldMigrations, 1001);
      expect(db.query("PRAGMA user_version").get()).toEqual({
        user_version: worldMigrations.length,
      });
      expect(db.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(db.query("SELECT * FROM board_notes").all()).toEqual(noteRow);
      expect(db.query("SELECT * FROM board_elements").all()).toEqual(
        elementRows,
      );
      expect(readBoard(db)).toMatchObject({ revision: 7, notes: [note] });
      if (hasElements) expect(readBoard(db)!.elements).toEqual([element]);
      expect(
        db.query("SELECT session_key FROM apartment_residents").all(),
      ).toEqual(
        hasApartments
          ? [
              {
                session_key:
                  migrations.length === 14 ? "codex/synthetic-session" : null,
              },
            ]
          : [],
      );
      if (hasApartments)
        expect(db.query("SELECT body FROM apartment_residents").get()).toEqual({
          body: resident,
        });
      expect(db.query("SELECT * FROM apartment_evictions").all()).toEqual(
        hasEvictions ? [{ session_key: "codex/evicted-session", at: 2 }] : [],
      );
      if (migrations.length < worldMigrations.length) {
        const backup = new Database(backupPath!, { readonly: true });
        try {
          expect(tables(backup)).toEqual(before);
          expect(backup.query("PRAGMA user_version").get()).toEqual({
            user_version: migrations.length,
          });
          expect(backup.query("SELECT * FROM board_notes").all()).toEqual(
            noteRow,
          );
          if (hasElements)
            expect(backup.query("SELECT * FROM board_elements").all()).toEqual(
              elementRows,
            );
        } finally {
          backup.close();
        }
      } else expect(backupPath).toBeUndefined();
      expect(
        migrateWorldDatabase(db, path, worldMigrations, 1002),
      ).toBeUndefined();
    } finally {
      db.close();
    }
    // Exercise the production startup rather than only the migration helper.
    const writer = openWorldWriter(path, join(root, "ledger.json"), 1003);
    writer.close();
  },
);

test("preview recovery rolls back with a later migration and retries without losing rows", () => {
  const { path, db } = fixture();
  const before = tables(db);
  const elementRows = db.query("SELECT * FROM board_elements").all();
  try {
    expect(() =>
      migrateWorldDatabase(
        db,
        path,
        [
          ...worldMigrations,
          () => {
            throw new Error("synthetic later failure");
          },
        ],
        1001,
      ),
    ).toThrow("synthetic later failure");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 14 });
    expect(tables(db)).toEqual(before);
    expect(db.query("SELECT * FROM board_elements").all()).toEqual(elementRows);
    migrateWorldDatabase(db, path, worldMigrations, 1002);
    expect(db.query("SELECT * FROM apartment_evictions").all()).toEqual([]);
    expect(db.query("SELECT * FROM board_elements").all()).toEqual(elementRows);
  } finally {
    db.close();
  }
});

test("an unrecognized v14 missing Apartments still refuses instead of repairing arbitrary damage", () => {
  const { path, db } = fixture(worldMigrations.slice(0, 13));
  try {
    db.exec("PRAGMA user_version=14");
    expect(() => migrateWorldDatabase(db, path)).toThrow(
      "no such table: apartment_residents",
    );
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 14 });
  } finally {
    db.close();
  }
});
