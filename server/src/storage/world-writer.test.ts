import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import type {
  AttentionEntry,
  EffectRecovery,
  LedgerCommit,
  LedgerWrite,
  ReplayPage,
  StorageRequest,
} from "./world-protocol";
const roots: string[] = [];
const writers: ReturnType<typeof openWorldWriter>[] = [];
afterEach(() => {
  for (const writer of writers.splice(0)) writer.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "world-writer-"));
  roots.push(root);
  return {
    root,
    database: join(root, "world.sqlite"),
    legacy: join(root, "ledger.json"),
  };
};
const open = (paths = fixture()) => {
  const writer = openWorldWriter(paths.database, paths.legacy, 1000);
  writers.push(writer);
  return writer;
};
const write = (_id: string, revision: number): LedgerWrite => ({
  at: 1000,
  revision,
  effects: [],
  asks: { put: [], remove: [] },
  changes: { put: [], remove: [] },
  results: { put: [], remove: [] },
});
const ask = (id: string) => ({
  id,
  at: 1000,
  actor: { label: "Fixture", verified: false },
  question: "Keep?",
  options: [],
  owner_only: true,
});
const request = (
  writer: ReturnType<typeof openWorldWriter>,
  request: StorageRequest,
  at = 1000,
) => writer.batch([{ ticket: 1, request }], at)[0]!;
const page = (
  writer: ReturnType<typeof openWorldWriter>,
  seq = 0,
  at = 1000,
) => {
  const initial = request(
    writer,
    { type: "replay", cursor: null, limit: 1000 },
    at,
  ).result as ReplayPage;
  return request(
    writer,
    {
      type: "replay",
      cursor: { incarnation: initial.incarnation, seq },
      limit: 1000,
    },
    at,
  ).result as ReplayPage;
};

test("declared effects are atomic and unique per record; results and answers create no implicit send", () => {
  const writer = open();
  const first = write("op-once", 0);
  first.asks.put.push(ask("q-once"));
  first.effects = [
    {
      kind: "ask.created",
      recovery: "repeatable",
      record_id: "q-once",
      target: { connection_id: "studio" },
    },
  ];
  expect(
    (request(writer, { type: "write", write: first }).result as LedgerCommit)
      .revision,
  ).toBe(1);
  expect(request(writer, { type: "write", write: first }).error).toContain(
    "revision conflict",
  );
  const next = write("op-repeat-effect", 1);
  next.effects = first.effects;
  next.results.put.push({
    id: "r-result",
    at: 1000,
    actor: { label: "Fixture", verified: false },
    task: "fixture",
    summary: "Done",
    status: "done",
  });
  expect(
    (request(writer, { type: "write", write: next }).result as LedgerCommit)
      .revision,
  ).toBe(2);
  expect(
    request(writer, { type: "outbox", record_id: "q-once" }).result,
  ).toHaveLength(1);
  expect(
    request(writer, { type: "outbox", record_id: "r-result" }).result,
  ).toEqual([]);
});

test("the outbox accepts all five protocol recovery classes without granting uncertain retries", () => {
  const writer = open();
  const recoveries: EffectRecovery[] = [
    "keyed",
    "reconcilable",
    "reattachable",
    "repeatable",
    "opaque",
  ];
  for (const [revision, recovery] of recoveries.entries()) {
    const mutation = write(recovery, revision);
    mutation.effects = [
      {
        kind: "synthetic.recovery",
        record_id: recovery,
        recovery,
        target: null,
      },
    ];
    expect(
      request(writer, { type: "write", write: mutation }).error,
    ).toBeUndefined();
    const [entry] = request(writer, { type: "outbox", record_id: recovery })
      .result as AttentionEntry[];
    expect(entry!.recovery).toBe(recovery);
    const claimed = request(writer, { type: "claim", id: entry!.id })
      .result as AttentionEntry;
    request(writer, {
      type: "finish",
      id: entry!.id,
      attempt: claimed.attempt,
      state: "uncertain",
      reason: "No receipt",
      due_at: 2000,
    });
    const retried = request(
      writer,
      { type: "claim", id: entry!.id },
      2000,
    ).result;
    expect(Boolean(retried)).toBe(recovery === "repeatable");
  }
});

test("savepoint refusal preserves neighboring operations in a committed group", () => {
  const writer = open();
  const results = writer.batch(
    [
      { ticket: 1, request: { type: "write", write: write("first", 0) } },
      { ticket: 2, request: { type: "write", write: write("conflict", 0) } },
      { ticket: 3, request: { type: "write", write: write("second", 1) } },
    ],
    1000,
  );
  expect((results[0]!.result as LedgerCommit).revision).toBe(1);
  expect(results[1]!.error).toContain("revision conflict");
  expect((results[2]!.result as LedgerCommit).revision).toBe(2);
  expect(writer.read().document.revision).toBe(2);
});

test("history expiry preserves pending asks and intents, with no record-body copies", () => {
  const writer = open();
  const original = write("op-pending", 0);
  original.asks.put.push(ask("q-pending"));
  original.effects = [
    {
      kind: "ask.created",
      recovery: "repeatable",
      record_id: "q-pending",
      target: null,
    },
  ];
  request(writer, { type: "write", write: original });
  expect(page(writer).changes[0]).not.toHaveProperty("body");
  const future = 1000 + 25 * 60 * 60 * 1000;
  request(
    writer,
    { type: "write", write: { ...write("later", 1), at: future } },
    future,
  );
  expect(page(writer, 0, future).reset).toBe(true);
  expect(writer.read().document.asks).toHaveLength(1);
  expect(request(writer, { type: "outbox" }, future).result).toHaveLength(1);
  const deletion = write("delete-pending", 2);
  deletion.asks.remove.push("q-pending");
  expect(
    request(writer, { type: "write", write: deletion }, future).error,
  ).toContain("unanswered ask");
});

test("row cap and service incarnation reject old and foreign cursors", () => {
  const writer = open();
  for (let group = 0; group < 314; group++) {
    const requests = Array.from({ length: 32 }, (_, index) => {
      const seq = group * 32 + index;
      const operation = write(`op-${seq}`, seq);
      operation.changes.put.push({
        id: "c-history",
        at: 1000,
        actor: { label: "Fixture", verified: false },
        command: "fixture",
        summary: `${seq}`,
        undo: null,
      });
      return {
        ticket: seq,
        request: { type: "write" as const, write: operation },
      };
    });
    expect(writer.batch(requests, 1000).every((row) => !row.error)).toBe(true);
  }
  expect(page(writer).reset).toBe(true);
  const retained = page(writer, 48);
  expect(retained.reset).toBe(false);
  expect(retained.watermark).toBe(10048);
  expect(retained.changes).toHaveLength(1000);
  expect(
    (
      request(writer, {
        type: "replay",
        cursor: { incarnation: "another-store", seq: 48 },
        limit: 10,
      }).result as ReplayPage
    ).reset,
  ).toBe(true);
});

test("attempt receipts are fenced; closure cancels atomically and trim removes finished effects", () => {
  const writer = open();
  const first = write("op-ask", 0);
  first.asks.put.push(ask("q-ask"));
  first.effects = [
    {
      kind: "ask.created",
      recovery: "repeatable",
      record_id: "q-ask",
      target: { connection_id: "studio" },
    },
  ];
  request(writer, { type: "write", write: first });
  const entry = (
    request(writer, { type: "outbox" }).result as AttentionEntry[]
  )[0]!;
  const claimed = request(writer, { type: "claim", id: entry.id })
    .result as AttentionEntry;
  expect(request(writer, { type: "claim", id: entry.id }).result).toBeNull();
  expect(
    request(writer, {
      type: "finish",
      id: entry.id,
      attempt: claimed.attempt + 1,
      state: "delivered",
      reason: "stale",
    }).result,
  ).toBeNull();
  expect(
    (
      request(writer, {
        type: "finish",
        id: entry.id,
        attempt: claimed.attempt,
        state: "pending",
        reason: "busy",
        due_at: 31000,
      }).result as AttentionEntry
    ).state,
  ).toBe("pending");
  const close = write("op-close", 1);
  close.asks.put.push({
    ...ask("q-ask"),
    withdrawn: { at: 1001 },
  } as (typeof close.asks.put)[number]);
  request(writer, { type: "write", write: close });
  expect(
    (request(writer, { type: "outbox", id: entry.id }).result as AttentionEntry)
      .state,
  ).toBe("cancelled");
  const trim = write("op-trim", 2);
  trim.asks.remove.push("q-ask");
  expect(request(writer, { type: "write", write: trim }).error).toBeUndefined();
  expect(request(writer, { type: "outbox", id: entry.id }).result).toBeNull();
});

test("migrations preserve a private consistent snapshot and refuse future/foreign databases", () => {
  const paths = fixture();
  const db = new Database(paths.database);
  try {
    db.exec("PRAGMA journal_mode=WAL");
    migrateWorldDatabase(db, paths.database);
    const backupPath = migrateWorldDatabase(db, paths.database, [
      ...worldMigrations,
      "CREATE TABLE extension(value TEXT)",
    ]);
    expect(backupPath).toMatch(
      /world\.sqlite\.v1\.[0-9a-hjkmnp-tv-z]{8}\.bak$/,
    );
    const backup = new Database(backupPath!, { readonly: true });
    try {
      expect(
        (backup.query("PRAGMA user_version").get() as { user_version: number })
          .user_version,
      ).toBe(1);
    } finally {
      backup.close();
    }
    if (process.platform !== "win32")
      expect(statSync(backupPath!).mode & 0o777).toBe(0o600);
  } finally {
    db.close();
  }
  expect(() => openWorldWriter(paths.database, paths.legacy, 1000)).toThrow(
    "newer than this service supports",
  );
  const foreign = fixture();
  const other = new Database(foreign.database);
  other.exec("PRAGMA application_id=42");
  other.close();
  const foreignBytes = readFileSync(foreign.database);
  const foreignMode = statSync(foreign.database).mode;
  expect(() => openWorldWriter(foreign.database, foreign.legacy, 1000)).toThrow(
    "another application",
  );
  expect(readFileSync(foreign.database)).toEqual(foreignBytes);
  expect(statSync(foreign.database).mode).toBe(foreignMode);
});

test("restoring a migration snapshot can upgrade again without replacing the prior snapshot", () => {
  const paths = fixture();
  const migrations = [...worldMigrations, "CREATE TABLE extension(value TEXT)"];
  const db = new Database(paths.database);
  migrateWorldDatabase(db, paths.database);
  const first = migrateWorldDatabase(db, paths.database, migrations)!;
  db.close();
  const before = readFileSync(first);
  copyFileSync(first, paths.database);
  const restored = new Database(paths.database);
  try {
    const second = migrateWorldDatabase(restored, paths.database, migrations)!;
    expect(second).not.toBe(first);
    expect(readFileSync(first)).toEqual(before);
    expect(
      (restored.query("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(2);
  } finally {
    restored.close();
  }
});

test("a failed migration leaves the original version and a usable backup", () => {
  const paths = fixture();
  const db = new Database(paths.database);
  try {
    migrateWorldDatabase(db, paths.database);
    expect(() =>
      migrateWorldDatabase(db, paths.database, [
        ...worldMigrations,
        "CREATE TABLE partial(value TEXT); INVALID SQL",
      ]),
    ).toThrow(
      /snapshot preserved at .*world\.sqlite\.v1\.[0-9a-hjkmnp-tv-z]{8}\.bak/,
    );
    expect(
      (db.query("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    ).toBe(1);
    expect(
      db.query("SELECT name FROM sqlite_master WHERE name='partial'").get(),
    ).toBeNull();
  } finally {
    db.close();
  }
});

test("the database is private on POSIX", () => {
  const paths = fixture();
  open(paths);
  if (process.platform !== "win32")
    expect(statSync(paths.database).mode & 0o777).toBe(0o600);
});
