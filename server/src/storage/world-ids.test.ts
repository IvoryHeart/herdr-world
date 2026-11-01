import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import { worldMigrations, WORLD_APPLICATION_ID } from "./world-schema";
import { openWorldLedger, type WorldLedgerStorage } from "./world-storage";
import { systemClock, systemScheduler } from "../service/ports";
import { importLegacyLedger } from "./world-import";

const roots: string[] = [];
const writers: ReturnType<typeof openWorldWriter>[] = [];
const stores: WorldLedgerStorage[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "world-ids-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
  };
};
const ask = (id: string) => ({
  id,
  at: 1000,
  actor: { label: "Fixture", verified: false },
  question: "Keep?",
  options: [],
  owner_only: true,
  answer: { text: "Yes", at: 1001, by: "owner", occurrence: "q-11111111" },
});
const open = (target: ReturnType<typeof fixture>, bytes?: () => Uint8Array) => {
  const writer = openWorldWriter(
    target.database,
    target.ledger,
    1000,
    "fixture",
    bytes,
  );
  writers.push(writer);
  return writer;
};
const issue = (writer: ReturnType<typeof openWorldWriter>, kind: string) =>
  writer.batch([{ ticket: 1, request: { type: "issue-id", kind } }], 1000)[0]!;
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const writer of writers.splice(0)) writer.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("imported record IDs are preserved and excluded from allocation across families", () => {
  const target = fixture();
  writeFileSync(
    target.ledger,
    JSON.stringify({
      version: 1,
      revision: 0,
      asks: [ask("q-00000000")],
      changes: [],
      results: [
        {
          id: "q-11111111",
          at: 1000,
          actor: { label: "Fixture", verified: false },
          task: "Fixture",
          summary: "Done",
          status: "done",
        },
      ],
    }),
  );
  let draw = 0;
  const writer = open(target, () => new Uint8Array(8).fill(draw++));
  expect(writer.read().document.asks[0]?.id).toBe("q-00000000");
  expect(writer.read().document.results[0]?.id).toBe("q-11111111");
  expect(issue(writer, "q")).toMatchObject({ result: "q-22222222" });
  expect(draw).toBe(3);
});

test("migration registers IDs across every existing SQLite family", () => {
  const target = fixture();
  const db = new Database(target.database);
  db.exec(worldMigrations.slice(0, 2).join("\n"));
  db.exec(
    `PRAGMA application_id=${WORLD_APPLICATION_ID}; PRAGMA user_version=2`,
  );
  db.query("INSERT INTO results VALUES(?,?,?)").run(
    "q-00000000",
    1000,
    JSON.stringify({ id: "q-00000000" }),
  );
  db.query("INSERT INTO ledger_changes VALUES(?,?,?)").run(
    "q-11111111",
    1000,
    JSON.stringify({ id: "q-11111111" }),
  );
  db.query(
    "INSERT INTO replay_changes(operation_id,committed_at,kind,record_id) VALUES(?,?,?,?)",
  ).run("q-22222222", 1000, "fixture", "q-33333333");
  db.query("INSERT INTO asks VALUES(?,?,?,?)").run(
    "legacy-question",
    1000,
    1001,
    JSON.stringify({
      ...ask("legacy-question"),
      answer: { text: "Yes", at: 1001, by: "owner", occurrence: "q-44444444" },
    }),
  );
  db.query(
    "INSERT INTO outbox(id,operation_id,kind,record_id,recovery,state,due_at,created_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    "q-55555555",
    "q-66666666",
    "fixture",
    "q-77777777",
    "opaque",
    "delivered",
    1000,
    1000,
    1001,
  );
  db.close();
  let draw = 0;
  const writer = open(target, () => new Uint8Array(8).fill(draw++));
  expect(issue(writer, "q")).toMatchObject({ result: "q-88888888" });
});

test("reservation commit controls crash recovery even when its acknowledgement is lost", () => {
  for (const crash of ["before-commit", "after-commit"] as const) {
    const target = fixture();
    const first = open(target, () => new Uint8Array(8));
    expect(() =>
      first.batch(
        [{ ticket: 1, request: { type: "issue-id", kind: "q" } }],
        1000,
        (stage) => {
          if (stage === crash) throw new Error("simulated process loss");
        },
      ),
    ).toThrow("process loss");
    first.close();
    writers.splice(writers.indexOf(first), 1);
    let draw = 0;
    const second = open(target, () => new Uint8Array(8).fill(draw++));
    expect(issue(second, "q").result).toBe(
      crash === "before-commit" ? "q-00000000" : "q-11111111",
    );
  }
});

test("collision exhaustion and invalid kinds refuse allocation without poisoning the next operation", () => {
  const writer = open(fixture(), () => new Uint8Array(8));
  expect(issue(writer, "q").result).toBe("q-00000000");
  expect(issue(writer, "q").error).toContain("collision");
  expect(issue(writer, "").error).toContain("kind");
  expect(issue(writer, "source/native").error).toContain("kind");
  expect(issue(writer, "r").result).toBe("r-00000000");
});

test("reservations survive pruning and reopening without changing ledger revision", () => {
  const target = fixture();
  const first = open(target, () => new Uint8Array(8));
  expect(issue(first, "q")).toMatchObject({ result: "q-00000000" });
  expect(first.read().document.revision).toBe(0);
  const put = {
    at: 1000,
    revision: 0,
    effects: [],
    asks: { put: [], remove: [] },
    changes: { put: [], remove: [] },
    results: {
      put: [
        {
          id: "q-00000000",
          at: 1000,
          actor: { label: "Fixture", verified: false },
          task: "Fixture",
          summary: "Done",
          status: "done" as const,
        },
      ],
      remove: [],
    },
  };
  expect(
    first.batch(
      [{ ticket: 1, request: { type: "write", write: put } }],
      1000,
    )[0]?.error,
  ).toBeUndefined();
  first.close();
  writers.splice(writers.indexOf(first), 1);
  const db = new Database(target.database);
  expect(db.query("SELECT id FROM results").all()).toHaveLength(1);
  db.exec("DELETE FROM replay_changes; DELETE FROM results");
  db.close();
  let draw = 0;
  const second = open(target, () => new Uint8Array(8).fill(draw++));
  expect(issue(second, "q")).toMatchObject({ result: "q-11111111" });
});

test("a stopped backup uses fresh entropy and keeps its existing reservations", () => {
  const target = fixture();
  const restored = fixture();
  const first = open(target, () => new Uint8Array(8));
  expect(issue(first, "q").result).toBe("q-00000000");
  first.close();
  writers.splice(writers.indexOf(first), 1);
  copyFileSync(target.database, restored.database);
  const later = open(target, () => new Uint8Array(8).fill(1));
  expect(issue(later, "q").result).toBe("q-11111111");
  let draw = 0;
  const copy = open(restored, () =>
    new Uint8Array(8).fill(draw++ === 0 ? 0 : 2),
  );
  expect(issue(copy, "q").result).toBe("q-22222222");
});

test("worker allocation commits unique reservations and stops admission on close", async () => {
  const store = await openWorldLedger(fixture(), {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  stores.push(store);
  const ids = await Promise.all(
    Array.from({ length: 40 }, () => store.ids.issue("q")),
  );
  expect(new Set(ids).size).toBe(40);
  for (const id of ids)
    expect(id).toMatch(/^q-[0123456789abcdefghjkmnpqrstvwxyz]{8}$/);
  expect(await store.ledger.nextId("q")).not.toBe(ids[0]);
  await store.close();
  await expect(store.ids.issue("q")).rejects.toThrow(/clos/i);
});

test("repeated ask upserts keep already-reserved answer occurrences", async () => {
  const store = await openWorldLedger(fixture(), {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  stores.push(store);
  const id = await store.ids.issue("q");
  const occurrence = await store.ids.issue("a");
  await store.ledger.update((document) =>
    document.asks.push({
      ...ask(id),
      answer: { text: "Yes", at: 1001, by: "owner", occurrence },
    }),
  );
  await store.ledger.update((document) => {
    document.asks[0]!.question = "Still kept?";
  });
  expect(store.ledger.ask(id)?.answer?.occurrence).toBe(occurrence);
  expect(store.ledger.ask(id)?.question).toBe("Still kept?");
});

test("import counts domain records without including reservation-trigger writes", () => {
  const target = fixture();
  const db = new Database(target.database);
  try {
    db.exec(worldMigrations.join("\n"));
    writeFileSync(
      target.ledger,
      JSON.stringify({
        version: 1,
        revision: 0,
        asks: [ask("q-fixture")],
        changes: [],
        results: [],
      }),
    );
    const messages: string[] = [];
    importLegacyLedger(db, target.ledger, 1000, (message) =>
      messages.push(message),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("1 asks, 0 results, 0 changes");
    expect(db.query("SELECT id FROM world_ids").all()).toEqual([
      { id: "q-fixture" },
    ]);
    const updated = {
      ...ask("q-fixture"),
      answer: { text: "Yes", by: "owner", at: 1001, occurrence: "a-00000000" },
    };
    db.query("UPDATE asks SET body=? WHERE id=?").run(
      JSON.stringify(updated),
      "q-fixture",
    );
    expect(
      db.query("SELECT id FROM world_ids WHERE id=?").get("a-00000000"),
    ).toEqual({ id: "a-00000000" });
  } finally {
    db.close();
  }
});
