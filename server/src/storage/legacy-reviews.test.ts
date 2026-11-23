import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { legacyReviewFixture } from "./testing/legacy-review-fixture";
import {
  migrateLegacyCompletionReviews,
  LEGACY_REVIEW_MAX_BYTES,
} from "./legacy-review-migration";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import { openWorldWriter } from "./world-writer";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.each([1, 4097])(
  "schema 9 exports all %i retired receipts and preserves Desk/watch rows exactly",
  (count) => {
    const f = legacyReviewFixture(
      Array.from({ length: count }, (_, index) => ({ index })),
    );
    roots.push(f.root);
    const writer = openWorldWriter(f.paths.database, f.paths.ledger, 2000);
    expect(
      writer
        .read()
        .terminalMarks.map((row) => row.kind)
        .sort(),
    ).toEqual(["desk", "watchlist"]);
    writer.close();
    const db = new Database(f.paths.database, { readonly: true });
    try {
      expect(
        db
          .query(
            "SELECT m.rowid,m.id,m.kind,m.binding_id,m.revision,m.body,m.open_order,b.body AS binding FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id ORDER BY m.rowid",
          )
          .all(),
      ).toEqual(f.protectedRows);
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
      expect(
        db
          .query(
            "SELECT name FROM sqlite_master WHERE name='retired_completion_reviews'",
          )
          .get(),
      ).toBeNull();
      const files = readdirSync(join(f.root, "legacy"));
      const exported = JSON.parse(
        readFileSync(
          join(
            f.root,
            "legacy",
            files.find((name) =>
              name.startsWith("retired-completion-reviews."),
            )!,
          ),
          "utf8",
        ),
      );
      expect(exported.map((row: { id: string }) => row.id)).toEqual(f.ids);
      expect(exported[0].migrated_at).toBe(2000);
    } finally {
      db.close();
    }
    const reopened = openWorldWriter(
      f.paths.database,
      f.paths.ledger,
      2000 + 100 * 86400000,
    );
    reopened.close();
    expect(
      readdirSync(join(f.root, "legacy")).filter((name) =>
        name.startsWith("retired-completion-reviews."),
      ),
    ).toHaveLength(1);
  },
  30000,
);

test("migration rollback leaves schema9, receipts and protected rows intact with a labelled failure", () => {
  const f = legacyReviewFixture();
  roots.push(f.root);
  const db = new Database(f.paths.database, { strict: true });
  try {
    const before = db
      .query(
        "SELECT id,kind,body,binding_id FROM terminal_marks ORDER BY rowid",
      )
      .all();
    expect(() =>
      migrateWorldDatabase(
        db,
        f.paths.database,
        [
          ...worldMigrations.slice(0, 9),
          (target, at) => {
            migrateLegacyCompletionReviews(target, at);
            throw new Error("synthetic migration fault");
          },
        ],
        2000,
      ),
    ).toThrow("synthetic migration fault");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(
      db
        .query(
          "SELECT id,kind,body,binding_id FROM terminal_marks ORDER BY rowid",
        )
        .all(),
    ).toEqual(before);
    expect(
      db
        .query(
          "SELECT name FROM sqlite_master WHERE name='retired_completion_reviews'",
        )
        .get(),
    ).toBeNull();
  } finally {
    db.close();
  }
});

test("an over-budget archive is a labelled atomic migration refusal with schema9 retained", () => {
  const f = legacyReviewFixture();
  roots.push(f.root);
  const db = new Database(f.paths.database, { strict: true });
  try {
    db.query(
      "UPDATE terminal_marks SET body=json_set(body,'$.padding',?) WHERE id=?",
    ).run("x".repeat(LEGACY_REVIEW_MAX_BYTES), f.ids[0]!);
    const bytes = db
      .query(
        "SELECT length(CAST(body AS BLOB)) AS bytes FROM terminal_marks WHERE id=?",
      )
      .get(f.ids[0]!);
    expect(() =>
      migrateWorldDatabase(db, f.paths.database, worldMigrations, 2000),
    ).toThrow("Legacy review migration refused: archive exceeds 64 MiB");
    expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(
      db
        .query(
          "SELECT length(CAST(body AS BLOB)) AS bytes FROM terminal_marks WHERE id=?",
        )
        .get(f.ids[0]!),
    ).toEqual(bytes);
    expect(
      db.query("SELECT count(*) AS count FROM terminal_marks").get(),
    ).toEqual({ count: 3 });
  } finally {
    db.close();
  }
}, 30_000);
