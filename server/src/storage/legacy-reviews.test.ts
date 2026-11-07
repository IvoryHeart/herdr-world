import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readdirSync, rmSync } from "node:fs";
import { openWorldLedger } from "./world-storage";
import { systemScheduler } from "../service/ports";
import { legacyReviewFixture } from "./testing/legacy-review-fixture";
import {
  LEGACY_REVIEW_TTL_MS,
  LEGACY_REVIEW_MAX_BYTES,
  legacyReviewArchiveBytes,
} from "./legacy-review-archive";
import { migrateLegacyCompletionReviews } from "./legacy-review-migration";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import { DESK_METADATA_MAX_BYTES } from "../../../shared/deskState";
import { terminalMarkStorageBytes } from "./terminal-mark-budget";
import { openWorldWriter } from "./world-writer";
import { terminalMarkInput } from "./testing/terminal-mark-input";

const clock = (time: number) => ({ now: () => time, monotonic: () => time });

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("schema-9 upgrade archives completion receipts and preserves Desk/watch rows and bindings byte-for-byte", async () => {
  const f = legacyReviewFixture();
  roots.push(f.root);
  const clock = { now: () => 2000, monotonic: () => 2000 };
  const storage = await openWorldLedger(f.paths, {
    clock,
    scheduler: systemScheduler,
  });
  try {
    expect(
      storage.terminalMarks
        .list()
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["desk", "watchlist"]);
  } finally {
    await storage.close();
  }
  const db = new Database(f.paths.database, { readonly: true });
  try {
    expect(db.query("PRAGMA user_version").get()).toEqual({
      user_version: worldMigrations.length,
    });
    expect(
      db
        .query(
          "SELECT m.rowid,m.id,m.kind,m.binding_id,m.revision,m.body,m.open_order,b.body AS binding FROM terminal_marks m JOIN world_bindings b ON b.id=m.binding_id ORDER BY m.rowid",
        )
        .all(),
    ).toEqual(f.protectedRows);
    expect(
      db.query("SELECT id,migrated_at FROM retired_completion_reviews").all(),
    ).toEqual([{ id: f.ids[0], migrated_at: 2000 }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
    expect(
      readdirSync(f.root).some(
        (name) => name.startsWith("world.sqlite.v9.") && name.endsWith(".bak"),
      ),
    ).toBe(true);
  } finally {
    db.close();
  }
});

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

test("archive migration is idempotent and original migration time survives restart", async () => {
  const f = legacyReviewFixture([
    { index: 0 },
    { index: 1, known: false },
    { index: 2, sequence: null },
  ]);
  roots.push(f.root);
  for (const time of [2000, 8000]) {
    const storage = await openWorldLedger(f.paths, {
      clock: clock(time),
      scheduler: systemScheduler,
    });
    expect(storage.terminalMarks.archiveStatus()).toEqual({
      count: 3,
      expires_at: 2000 + LEGACY_REVIEW_TTL_MS,
    });
    expect(storage.terminalMarks.list()).toHaveLength(2);
    await storage.close();
  }
  const db = new Database(f.paths.database, { readonly: true });
  try {
    expect(
      db
        .query(
          "SELECT eligible FROM retired_completion_reviews ORDER BY original_order",
        )
        .all(),
    ).toEqual([{ eligible: 1 }, { eligible: 0 }, { eligible: 0 }]);
  } finally {
    db.close();
  }
});

test("a proven review and its archived receipt removal share one SQLite acknowledgement", async () => {
  const f = legacyReviewFixture();
  roots.push(f.root);
  const storage = await openWorldLedger(f.paths, {
    clock: clock(2000),
    scheduler: systemScheduler,
  });
  try {
    const row = storage.terminalMarks
      .list()
      .find((entry) => entry.kind === "desk")!;
    const input = terminalMarkInput("desk"),
      target = {
        adapter: row.binding.adapter,
        instance: row.binding.instance,
        kind: row.binding.kind,
        native_id: row.binding.native_id,
        evidence: row.binding.evidence,
      };
    const proof = {
      terminal_id: "terminal-0",
      session: target.evidence.session!,
      sequence: 4,
      status: "done" as const,
      last_activity_at: 1000,
      activity_matches: true,
    };
    expect(
      await storage.terminalMarks.observeLegacy(
        "alpha",
        ["terminal-0"],
        [proof],
        () => true,
      ),
    ).toEqual(new Set(["terminal-0"]));
    const saved = await storage.terminalMarks.put({
      ...input,
      id: row.id,
      revision: row.revision,
      body: row.body,
      target,
      event: {
        type: "listing",
        complete: true,
        fence: input.current,
        entities: [
          {
            native_id: target.native_id,
            terminals: ["terminal-0"],
            session: proof.session,
          },
        ],
      },
      legacy_review: { ...proof, review_changed: false },
    });
    expect(saved.body.reviewed_stop).toBe('stop:["stop-0",1000]');
    expect(storage.terminalMarks.archiveStatus().count).toBe(0);
    expect(
      storage.terminalMarks.list().find((entry) => entry.id === row.id)?.body
        .reviewed_stop,
    ).toBe(saved.body.reviewed_stop);
    expect((await storage.inspect()).integrity).toBe("ok");
  } finally {
    await storage.close();
  }
});

test("unknown receipts do not resolve, drain on complete absence, and all remaining receipts expire at30days", async () => {
  const f = legacyReviewFixture([
    { index: 1, known: false },
    { index: 2, sequence: null },
  ]);
  roots.push(f.root);
  const storage = await openWorldLedger(f.paths, {
    clock: clock(2000),
    scheduler: systemScheduler,
  });
  try {
    expect(
      await storage.terminalMarks.observeLegacy(
        "alpha",
        ["terminal-0", "terminal-1", "terminal-2"],
        [
          {
            terminal_id: "terminal-1",
            session: null,
            sequence: 4,
            status: "done",
            last_activity_at: null,
            activity_matches: true,
          },
        ],
        () => true,
      ),
    ).toEqual(new Set());
    expect(storage.terminalMarks.archiveStatus().count).toBe(2);
    await storage.terminalMarks.observeLegacy(
      "alpha",
      ["terminal-0", "terminal-2"],
      [],
      () => true,
    );
    expect(storage.terminalMarks.archiveStatus().count).toBe(1);
    await storage.terminalMarks.expire(2000 + LEGACY_REVIEW_TTL_MS - 1);
    expect(storage.terminalMarks.archiveStatus().count).toBe(1);
    await storage.terminalMarks.expire(2000 + LEGACY_REVIEW_TTL_MS);
    expect(storage.terminalMarks.archiveStatus()).toEqual({
      count: 0,
      expires_at: null,
    });
    expect(
      storage.terminalMarks
        .list()
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["desk", "watchlist"]);
  } finally {
    await storage.close();
  }
});

test("legacy count overflow evicts only oldest receipts while leaving Desk and watch rows intact", async () => {
  const f = legacyReviewFixture(
    Array.from({ length: 4097 }, (_, index) => ({ index })),
  );
  roots.push(f.root);
  const storage = await openWorldLedger(f.paths, {
    clock: clock(2000),
    scheduler: systemScheduler,
  });
  expect(storage.terminalMarks.archiveStatus().count).toBe(4096);
  expect(storage.terminalMarks.list()).toHaveLength(2);
  await storage.close();
  const db = new Database(f.paths.database, { readonly: true });
  try {
    const archiveBytes = legacyReviewArchiveBytes(db);
    expect(archiveBytes).toBeLessThan(LEGACY_REVIEW_MAX_BYTES);
    console.log(
      JSON.stringify({
        shape: "legacy-4096",
        archiveRows: 4096,
        archiveBytes,
        archiveBytesPerRecord: archiveBytes / 4096,
        archiveBudgetBytes: LEGACY_REVIEW_MAX_BYTES,
        operationalRows: 2,
        frameBytes: 1024 * 1024,
      }),
    );
    expect(
      db
        .query("SELECT id FROM retired_completion_reviews WHERE id=?")
        .get(f.ids[0]!),
    ).toBeNull();
    expect(
      db
        .query("SELECT id FROM retired_completion_reviews WHERE id=?")
        .get(f.ids.at(-1)!),
    ).toEqual({ id: f.ids.at(-1)! });
  } finally {
    db.close();
  }
}, 30_000);

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

test("a refused binding or capacity write rolls back both the migrated review and receipt removal", () => {
  for (const failure of ["binding"] as const) {
    const f = legacyReviewFixture();
    roots.push(f.root);
    const writer = openWorldWriter(
      f.paths.database,
      f.paths.ledger,
      2000,
      "migration-test",
    );
    try {
      const row = writer
        .read()
        .terminalMarks!.find((row) => row.kind === "desk")!;
      const input = terminalMarkInput("desk"),
        target = {
          adapter: row.binding.adapter,
          instance: row.binding.instance,
          kind: row.binding.kind,
          native_id: row.binding.native_id,
          evidence: row.binding.evidence,
        };
      const result = writer.batch(
        [
          {
            ticket: 1,
            request: {
              type: "terminal-mark",
              operation: {
                type: "put",
                input: {
                  ...input,
                  id: row.id,
                  revision: row.revision,
                  target,
                  body: row.body,
                  event: {
                    type: "listing",
                    complete: true,
                    fence: {
                      ...input.current,
                      ...(failure === "binding" ? { generation: 99 } : {}),
                    },
                    entities: [
                      {
                        native_id: target.native_id,
                        terminals: ["terminal-0"],
                        session: target.evidence.session,
                      },
                    ],
                  },
                  legacy_review: {
                    terminal_id: "terminal-0",
                    session: target.evidence.session!,
                    sequence: 4,
                    status: "done",
                    last_activity_at: 1000,
                    activity_matches: true,
                    review_changed: false,
                  },
                },
              },
            },
          },
        ],
        2000,
      );
      expect(result[0]!.error).toBeDefined();
      expect(writer.read().terminalMarks).toEqual([
        row,
        writer.read().terminalMarks![1]!,
      ]);
      expect(writer.read().legacyReviewArchive?.count).toBe(1);
    } finally {
      writer.close();
    }
    const db = new Database(f.paths.database, { readonly: true });
    try {
      expect(
        db
          .query("SELECT count(*) AS count FROM retired_completion_reviews")
          .get(),
      ).toEqual({ count: 1 });
      expect(db.query("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
    } finally {
      db.close();
    }
  }
});

test("real post-resolution capacity refusal restores the archived receipt and every committed Desk row", () => {
  const f = legacyReviewFixture();
  roots.push(f.root);
  const writer = openWorldWriter(
    f.paths.database,
    f.paths.ledger,
    2000,
    "migration-capacity",
  );
  const write = (input: ReturnType<typeof terminalMarkInput>) =>
    writer.batch(
      [
        {
          ticket: 1,
          request: { type: "terminal-mark", operation: { type: "put", input } },
        },
      ],
      2000,
    )[0]!;
  const rows = () =>
    writer.read().terminalMarks!.filter((row) => row.kind === "desk");
  const bytes = () => terminalMarkStorageBytes(rows());
  try {
    const padding = Array.from({ length: 100 }, (_, i) =>
      terminalMarkInput("desk", `padding-${i}`),
    );
    for (const input of padding)
      expect(
        write({
          ...input,
          body: { ...input.body, reviewed_stop: "x", opened_at: null },
        }).error,
      ).toBeUndefined();
    const length =
      Math.floor((DESK_METADATA_MAX_BYTES - bytes()) / padding.length) + 1;
    const update = (i: number, length: number) => {
      const row = rows().find(
        (row) => row.binding.evidence.terminals[0] === `padding-${i}`,
      )!;
      return write({
        ...padding[i]!,
        id: row.id,
        revision: row.revision,
        body: { ...row.body, reviewed_stop: "x".repeat(length) },
      });
    };
    for (let i = 0; i < padding.length; i++)
      expect(update(i, length).error).toBeUndefined();
    expect(
      update(0, length + DESK_METADATA_MAX_BYTES - bytes() - 8).error,
    ).toBeUndefined();
    expect(bytes()).toBe(DESK_METADATA_MAX_BYTES - 8);
    const before = writer.read().terminalMarks!,
      row = rows().find(
        (row) => row.binding.evidence.terminals[0] === "terminal-0",
      )!,
      input = terminalMarkInput("desk");
    const target = {
      adapter: row.binding.adapter,
      instance: row.binding.instance,
      kind: row.binding.kind,
      native_id: row.binding.native_id,
      evidence: row.binding.evidence,
    };
    const result = write({
      ...input,
      id: row.id,
      revision: row.revision,
      body: row.body,
      target,
      event: {
        type: "listing",
        complete: true,
        fence: input.current,
        entities: [
          {
            native_id: target.native_id,
            terminals: target.evidence.terminals,
            session: target.evidence.session,
          },
        ],
      },
      legacy_review: {
        terminal_id: "terminal-0",
        session: target.evidence.session!,
        sequence: 4,
        status: "done",
        last_activity_at: 1000,
        activity_matches: true,
        review_changed: false,
      },
    });
    expect(result.error).toContain("Desk capacity exceeded:");
    expect(writer.read().terminalMarks).toEqual(before);
    expect(writer.read().legacyReviewArchive?.count).toBe(1);
  } finally {
    writer.close();
  }
});
