import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
  cpSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import {
  fixtureChanges,
  writeLeftoversFolder,
} from "./testing/leftovers-fixture";
import { openWorldWriter } from "./world-writer";
import { openWorldLedger } from "./world-storage";
import { systemScheduler } from "../service/ports";
import { createWorldCli } from "../world/world-cli";
import { BoardStore } from "../world/board-store";
import { WorldLedger, type LedgerStore } from "../world/world-ledger";
import { readBoard, worldBoardElementsMigration } from "./world-board";
import type { BoardStorePort } from "../world/board-store";
import { storageCatalog } from "./catalog";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const changed = new Set([
  "ledger_changes",
  "imports",
  "profile_legacy_assignments",
  "profile_imported_connections",
  "retired_completion_reviews",
]);
function semanticDump(db: Database, tables?: string[]) {
  tables ??= (
    db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  )
    .map((row) => row.name)
    .filter((name) => !changed.has(name));
  return Object.fromEntries(
    tables.map((table) => {
      const rows = db
        .query(`SELECT * FROM ${table} ORDER BY rowid`)
        .all() as Record<string, unknown>[];
      // Schema 15 derives this index key from the unchanged resident body.
      if (table === "apartment_residents")
        for (const row of rows) delete row.session_key;
      return [
        table,
        {
          count: rows.length,
          hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        },
      ];
    }),
  );
}

test.each([13, 14, 15, 16])(
  "schema %i whole-folder startup preserves every protected semantic hash",
  (version) => {
    const root = mkdtempSync(join(tmpdir(), "world-folder-upgrade-"));
    const source = mkdtempSync(join(tmpdir(), "world-folder-source-"));
    roots.push(root, source);
    const original = writeLeftoversFolder(source, version);
    cpSync(source, root, { recursive: true });
    const paths = Object.fromEntries(
      Object.entries(original).map(([key, path]) => [
        key,
        join(root, relative(source, path)),
      ]),
    ) as typeof original;
    const before = new Database(paths.database);
    const dump = semanticDump(before);
    if (version < 16) {
      before.exec("BEGIN");
      before.exec(worldBoardElementsMigration);
    }
    const board = readBoard(before);
    if (version < 16) before.exec("ROLLBACK");
    const profiles = before
      .query("SELECT * FROM agent_profiles ORDER BY position")
      .all();
    before.close();
    const writer = openWorldWriter(
      paths.database,
      paths.ledger,
      2000,
      undefined,
      undefined,
      paths.profiles,
      undefined,
      undefined,
      undefined,
      { path: paths.board },
    );
    const state = writer.read();
    expect(state.board).toEqual(board!);
    expect(state.document.changes).toEqual(fixtureChanges);
    expect(state.profiles?.assignments).toHaveLength(1);
    expect(state.profiles?.terminal_settings?.imported_connections).toEqual([
      "synthetic",
    ]);
    writer.close();
    const after = new Database(paths.database);
    expect(semanticDump(after, Object.keys(dump))).toEqual(dump);
    expect(
      after.query("SELECT * FROM agent_profiles ORDER BY position").all(),
    ).toEqual(profiles);
    expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
    after.close();
    const snapshot = readdirSync(root).find((name) =>
      name.startsWith(`world.sqlite.v${version}.`),
    )!;
    const backup = new Database(join(root, snapshot), { readonly: true });
    expect(semanticDump(backup)).toEqual(dump);
    expect(
      backup.query("SELECT count(*) AS n FROM ledger_changes").get(),
    ).toEqual({ n: 4 });
    backup.close();
    const reopened = openWorldWriter(paths.database, paths.ledger, 3000);
    expect(reopened.read()).toEqual(state);
    reopened.close();
  },
);

test.each(["export", "after-copy"])(
  "%s failure retains the original database, names its snapshot and safely retries",
  (fault) => {
    const root = mkdtempSync(join(tmpdir(), "world-upgrade-failure-"));
    roots.push(root);
    const paths = writeLeftoversFolder(root, 15, false);
    if (fault === "export")
      writeFileSync(join(root, "legacy"), "synthetic export obstruction");
    const db = new Database(paths.database);
    const dump = semanticDump(db);
    try {
      const migrations =
        fault === "export"
          ? worldMigrations
          : [
              ...worldMigrations,
              () => {
                throw new Error("synthetic after-copy fault");
              },
            ];
      expect(() =>
        migrateWorldDatabase(db, paths.database, migrations, 2000),
      ).toThrow(/snapshot preserved at .*world\.sqlite\.v15\./);
      expect(db.query("PRAGMA user_version").get()).toEqual({
        user_version: 15,
      });
      expect(semanticDump(db)).toEqual(dump);
      expect(
        db.query("SELECT count(*) AS n FROM ledger_changes").get(),
      ).toEqual({ n: 4 });
      if (fault === "export") rmSync(join(root, "legacy"));
      migrateWorldDatabase(db, paths.database, worldMigrations, 3000);
      expect(
        db.query("SELECT count(*) AS n FROM command_changes").get(),
      ).toEqual({ n: 4 });
      const exports = readdirSync(join(root, "legacy")).filter((name) =>
        name.startsWith("retired-completion-reviews."),
      );
      expect(exports).toHaveLength(1);
      if (process.platform !== "win32")
        expect(statSync(join(root, "legacy", exports[0]!)).mode & 0o777).toBe(
          0o600,
        );
    } finally {
      db.close();
    }
  },
);

test("production CLI history and conditional undo behave identically across migration", async () => {
  const root = mkdtempSync(join(tmpdir(), "world-history-upgrade-"));
  roots.push(root);
  const paths = writeLeftoversFolder(root, 15, false);
  const legacy = join(root, "before-ledger.json");
  writeFileSync(
    legacy,
    JSON.stringify({
      version: 1,
      revision: 0,
      changes: fixtureChanges,
      asks: [],
      results: [],
    }),
  );
  const beforeBoard = new BoardStore(join(root, "before-board.json"));
  beforeBoard.patch([
    { op: "card.color", key: "synthetic:tab", color: "pink" },
  ]);
  async function exercise(
    board: Pick<BoardStorePort, "get" | "patch" | "patchIf">,
    ledger: LedgerStore,
  ) {
    const cli = createWorldCli({
      board,
      ledger,
      hosts: () => [],
      defaultConnectionId: () => null,
      snapshot: async () => ({ revision: 1, observed_at: 1, connections: [] }),
      publishBoard: () => {},
      publishLedger: () => {},
      now: () => 4000,
    });
    const run = (command: string, params: Record<string, unknown> = {}) =>
      cli.handle({ command, params, caller: {} }, null);
    expect((await run("history")).result).toEqual(fixtureChanges);
    expect(
      (await run("history", { actor: "Synthetic builder", limit: 2 })).result,
    ).toEqual(fixtureChanges.slice(-2));
    expect(await run("undo", { id: "c-undone" })).toMatchObject({
      ok: false,
      code: "refused",
    });
    await board.patch([
      { op: "card.color", key: "synthetic:tab", color: "red" },
    ]);
    expect(await run("undo", { id: "c-probe" })).toMatchObject({
      ok: false,
      code: "refused",
    });
    await board.patch([
      { op: "card.color", key: "synthetic:tab", color: "pink" },
    ]);
    expect(await run("undo", { id: "c-probe" })).toMatchObject({
      ok: true,
      result: { command: "undo", summary: "undid c-probe" },
    });
    expect(board.get().layout.colors["synthetic:tab"]).toBe("blue");
    expect(ledger.change("c-probe")?.undone_by).toBeString();
    expect(await run("undo", { id: "c-probe" })).toMatchObject({
      ok: false,
      code: "refused",
    });
  }
  await exercise(beforeBoard, new WorldLedger(legacy));
  const storage = await openWorldLedger(paths, {
    clock: { now: () => 4000, monotonic: () => 4000 },
    scheduler: systemScheduler,
  });
  try {
    await exercise(storage.board, storage.ledger);
  } finally {
    await storage.close();
  }
  const reopened = await openWorldLedger(paths, {
    clock: { now: () => 4000, monotonic: () => 4000 },
    scheduler: systemScheduler,
  });
  try {
    expect(reopened.ledger.change("c-probe")?.undone_by).toBeString();
    expect(reopened.board.get().layout.colors["synthetic:tab"]).toBe("blue");
  } finally {
    await reopened.close();
  }
  expect(
    storageCatalog.find((entry) => entry.name === "command_changes")?.limit,
  ).toBe(2000);
});

test("migrated command history retains the 2000-row admission limit and permanent IDs", async () => {
  const root = mkdtempSync(join(tmpdir(), "world-history-limit-"));
  roots.push(root);
  const paths = writeLeftoversFolder(root, 13, false);
  const db = new Database(paths.database);
  db.transaction(() => {
    for (let i = 4; i < 2000; i++) {
      const change = { ...fixtureChanges[1]!, id: `c-limit-${i}`, at: i };
      db.query("INSERT INTO ledger_changes VALUES(?,?,?)").run(
        change.id,
        change.at,
        JSON.stringify(change),
      );
    }
  })();
  db.close();
  const storage = await openWorldLedger(paths, {
    clock: { now: () => 4000, monotonic: () => 4000 },
    scheduler: systemScheduler,
  });
  try {
    expect(storage.ledger.get().changes).toHaveLength(2000);
    await storage.ledger.update((doc) =>
      doc.changes.push({ ...fixtureChanges[1]!, id: "c-next", at: 4000 }),
    );
    expect(storage.ledger.get().changes).toHaveLength(2000);
    expect(storage.ledger.change("c-undone")).toBeUndefined();
    expect(storage.ledger.get().changes.at(-1)?.id).toBe("c-next");
  } finally {
    await storage.close();
  }
  const after = new Database(paths.database);
  expect(
    after.query("SELECT id FROM world_ids WHERE id='c-undone'").get(),
  ).toEqual({ id: "c-undone" });
  expect(
    after.query("SELECT count(*) AS n FROM retired_ledger_changes").get(),
  ).toEqual({ n: 2000 });
  after.close();
});

test.each([13, 14, 15, 16])(
  "schema %i preserves populated leftovers before retirement",
  (version) => {
    const root = mkdtempSync(join(tmpdir(), "world-leftovers-"));
    roots.push(root);
    const path = join(root, "world.sqlite");
    const db = new Database(path);
    try {
      migrateWorldDatabase(db, path, worldMigrations.slice(0, version), 1000);
      db.exec(`INSERT INTO ledger_changes VALUES('c-keep',1,'{"id":"c-keep","undo":null}');
      INSERT INTO profile_legacy_assignments VALUES(0,'synthetic','terminal','profile');
      INSERT INTO profile_imported_connections VALUES('synthetic',0);
      INSERT INTO imports VALUES('ledger-json','synthetic-hash',1);
      INSERT INTO world_ids VALUES('c-review');
      INSERT INTO retired_completion_reviews VALUES('c-review','synthetic','terminal',1,0,1,'{}');`);
      const backup = migrateWorldDatabase(db, path, worldMigrations, 2000);
      expect(backup).toBeString();
      const tables = (
        db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as {
          name: string;
        }[]
      ).map((row) => row.name);
      for (const name of [
        "ledger_changes",
        "profile_legacy_assignments",
        "profile_imported_connections",
        "imports",
        "retired_completion_reviews",
      ])
        expect(tables).not.toContain(name);
      expect(db.query("SELECT * FROM command_changes").all()).toEqual(
        db.query("SELECT * FROM retired_ledger_changes").all(),
      );
      const exports = readdirSync(join(root, "legacy")).filter((name) =>
        name.startsWith("retired-completion-reviews."),
      );
      expect(exports).toHaveLength(1);
      expect(
        JSON.parse(readFileSync(join(root, "legacy", exports[0]!), "utf8")),
      ).toMatchObject([{ id: "c-review", receipt: "{}" }]);
    } finally {
      db.close();
    }
  },
);

test("schema 1 and empty current stores traverse the complete cleanup chain", () => {
  const root = mkdtempSync(join(tmpdir(), "world-schema-one-"));
  roots.push(root);
  const path = join(root, "world.sqlite");
  const db = new Database(path);
  migrateWorldDatabase(db, path, worldMigrations.slice(0, 1), 1000);
  db.exec(
    'INSERT INTO ledger_changes VALUES(\'c-first\',1,\'{"id":"c-first","undo":null}\')',
  );
  migrateWorldDatabase(db, path, worldMigrations, 2000);
  expect(db.query("SELECT id FROM command_changes").all()).toEqual([
    { id: "c-first" },
  ]);
  expect(
    db
      .query(
        "SELECT name FROM sqlite_master WHERE name='retired_completion_reviews'",
      )
      .get(),
  ).toBeNull();
  expect(readdirSync(root)).not.toContain("legacy");
  db.close();
});
