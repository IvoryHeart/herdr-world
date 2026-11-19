import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import { migrateWorldDatabase, worldMigrations } from "./world-schema";
import type { BoardCommit, BoardOperation } from "./world-board";
import type { BoardOp } from "../world/board-store";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const doc = (id: string, text = "Synthetic draft") => ({
  id,
  kind: "document" as const,
  title: "Draft",
  x: 0,
  y: 0,
  source: { text },
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "board-element-storage-"));
  roots.push(root);
  const database = join(root, "world.sqlite");
  const open = () => {
    const writer = openWorldWriter(
      database,
      join(root, "ledger.json"),
      1000,
      "synthetic-incarnation",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { path: join(root, "board.json") },
    );
    return {
      close: () => writer.close(),
      board: (
        operation: BoardOperation | { type: "get" },
        at = 1000,
      ): BoardCommit => {
        if ("type" in operation) return { document: writer.read().board! };
        const reply = writer.batch(
          [{ ticket: 1, request: { type: "board", operation } }],
          at,
        )[0]!;
        if (reply.error) throw new Error(reply.error);
        return reply.result as BoardCommit;
      },
    };
  };
  return { database, open };
}

test("element rows commit atomically with legacy notes and survive reopen", () => {
  const f = fixture(),
    writer = f.open();
  const before = writer.board(
    {
      ops: [
        {
          op: "note.put",
          note: {
            id: "sticky",
            text: "Existing note",
            color: "yellow",
            x: 1,
            y: 2,
          },
        },
        { op: "element.put", element: doc("doc") },
      ],
    },
    1001,
  ).document!;
  expect(before.elements).toEqual([{ ...doc("doc"), rev: 1 }]);
  expect(() =>
    writer.board(
      {
        ops: [
          { op: "element.put", element: doc("rolled-back") },
          { op: "card.color", key: "", color: "blue" },
        ],
      },
      1002,
    ),
  ).toThrow();
  expect(writer.board({ type: "get" }).document).toEqual(before);
  writer.close();
  const db = new Database(f.database);
  expect(
    db.query("SELECT record_id,binding_id FROM board_elements").get(),
  ).toEqual({ record_id: "doc", binding_id: null });
  expect(
    db.query("SELECT id FROM world_ids WHERE id='rolled-back'").get(),
  ).toBeNull();
  db.close();
  const reopened = f.open();
  expect(reopened.board({ type: "get" }).document).toEqual(before);
  reopened.close();
});

test("all independent edit orders preserve rows; stale update/delete and deleted/recreated IDs conflict", () => {
  for (const ids of [
    ["a", "b"],
    ["b", "a"],
  ]) {
    const f = fixture(),
      writer = f.open();
    for (const id of ids)
      writer.board({ ops: [{ op: "element.put", element: doc(id) }] }, 1001);
    const before = writer.board({ type: "get" }).document!;
    const rev = before.elements!.find((entry) => entry.id === "a")!.rev;
    writer.board(
      { ops: [{ op: "element.put", element: doc("a", "New draft"), rev }] },
      1002,
    );
    for (const op of [
      { op: "element.put", element: doc("a", "Stale draft"), rev },
      { op: "element.delete", id: "a", rev },
    ] as BoardOp[])
      expect(writer.board({ ops: [op] }, 1003).conflict).toBeDefined();
    expect(
      writer
        .board({ type: "get" })
        .document!.elements!.find((entry) => entry.id === "b"),
    ).toBeDefined();
    const latest = writer
      .board({ type: "get" })
      .document!.elements!.find((entry) => entry.id === "a")!.rev;
    writer.board(
      { ops: [{ op: "element.delete", id: "a", rev: latest }] },
      1004,
    );
    writer.board({ ops: [{ op: "element.put", element: doc("a") }] }, 1005);
    expect(
      writer.board(
        { ops: [{ op: "element.put", element: doc("a", "Old edit"), rev }] },
        1006,
      ).conflict,
    ).toBeDefined();
    writer.close();
  }
});

test("previous schema upgrades without rewriting native records", () => {
  const f = fixture(),
    db = new Database(f.database);
  migrateWorldDatabase(db, f.database, worldMigrations.slice(0, -1), 1000);
  migrateWorldDatabase(db, f.database, worldMigrations, 1001);
  expect(
    db
      .query("SELECT name FROM sqlite_master WHERE name='board_elements'")
      .get(),
  ).toEqual({ name: "board_elements" });
  db.close();
});

test("an element SQL refusal rolls back neighboring rows and reserved identities", () => {
  const f = fixture(),
    seed = f.open();
  seed.close();
  const db = new Database(f.database);
  db.exec(
    "CREATE TRIGGER refuse_element BEFORE INSERT ON board_elements BEGIN SELECT RAISE(ABORT,'synthetic element refusal'); END",
  );
  db.close();
  const writer = f.open();
  expect(() =>
    writer.board(
      {
        ops: [
          {
            op: "note.put",
            note: {
              id: "neighbor",
              text: "Rollback",
              color: "yellow",
              x: 0,
              y: 0,
            },
          },
          { op: "element.put", element: doc("refused-element") },
        ],
      },
      1000,
    ),
  ).toThrow("synthetic element refusal");
  expect(writer.board({ type: "get" }).document!.notes).toEqual([]);
  expect(writer.board({ type: "get" }).document!.elements).toBeUndefined();
  writer.close();
  const check = new Database(f.database);
  expect(
    check
      .query(
        "SELECT id FROM world_ids WHERE id IN ('neighbor','refused-element')",
      )
      .all(),
  ).toEqual([]);
  check.close();
});

test("batched edits use one committed revision and retain delete/recreate fencing", () => {
  const f = fixture(),
    writer = f.open();
  writer.board({ ops: [{ op: "element.put", element: doc("batched") }] }, 1000);
  const saved = writer.board(
    {
      ops: [
        { op: "element.put", element: doc("batched", "First edit"), rev: 1 },
        { op: "element.put", element: doc("batched", "Final edit"), rev: 2 },
      ],
    },
    1001,
  ).document!;
  expect(saved.elements![0]!.rev).toBe(saved.revision);
  const rev = saved.elements![0]!.rev;
  writer.board({ ops: [{ op: "element.delete", id: "batched", rev }] }, 1002);
  writer.board(
    { ops: [{ op: "element.put", element: doc("batched", "New record") }] },
    1003,
  );
  expect(
    writer.board(
      {
        ops: [{ op: "element.put", element: doc("batched", "Old edit"), rev }],
      },
      1004,
    ).conflict,
  ).toBeDefined();
  writer.close();
});
