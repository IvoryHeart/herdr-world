import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import type { BoardOperation } from "./world-board";
import { BoardStore } from "../world/board-store";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "board-writer-"));
  roots.push(root);
  return {
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
    board: join(root, "board.json"),
  };
};
const open = (p: ReturnType<typeof fresh>) =>
  openWorldWriter(
    p.database,
    p.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { path: p.board },
  );
function orders<T>(values: readonly T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        orders(values.filter((_, other) => other !== index)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}
const target = {
  connection_id: "studio",
  kind: "tab" as const,
  native_id: "tab-a",
  witness: ["terminal-a"],
  color_key: "studio:tab-a",
};
test("all 24 note/appearance/refusal orders use transaction-local state and refuse the entire invalid patch", () => {
  for (const order of orders(["a", "b", "appearance", "refused"] as const)) {
    const p = fresh(),
      writer = open(p);
    const operations: Record<(typeof order)[number], BoardOperation> = {
      a: {
        ops: [
          {
            op: "note.put",
            note: { id: "note-a", text: "A", color: "yellow", x: 1, y: 2 },
          },
        ],
      },
      b: {
        ops: [
          {
            op: "note.put",
            note: { id: "note-b", text: "B", color: "blue", x: 3, y: 4 },
          },
        ],
      },
      appearance: {
        ops: [
          {
            op: "appearance.set",
            target,
            fields: { color: "pink", status: "Ready" },
          },
        ],
      },
      refused: {
        ops: [
          {
            op: "note.put",
            note: {
              id: "note-rollback",
              text: "Rollback",
              color: "pink",
              x: 0,
              y: 0,
            },
          },
          { op: "card.color", key: "", color: "green" },
        ],
      },
    };
    let after;
    try {
      const results = writer.batch(
        order.map((name, ticket) => ({
          ticket,
          request: { type: "board" as const, operation: operations[name] },
        })),
        1000,
      );
      for (const [index, name] of order.entries()) {
        if (name === "refused") expect(results[index]!.error).toBeDefined();
        else expect(results[index]!.error).toBeUndefined();
      }
      after = writer.read().board!;
      expect(after.notes.map((n) => n.id).sort()).toEqual(["note-a", "note-b"]);
      expect(after.revision).toBe(3);
      expect(after.layout.colors["studio:tab-a"]).toBe("pink");
    } finally {
      writer.close();
    }
    const reopened = open(p);
    try {
      expect(reopened.read().board).toEqual(after);
    } finally {
      reopened.close();
    }
    const db = new Database(p.database, { readonly: true });
    try {
      expect(
        db
          .query(
            "SELECT count(*) AS count FROM world_ids WHERE id='note-rollback'",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        db
          .query(
            "SELECT count(*) AS count FROM board_appearance WHERE binding_id IS NOT NULL AND record_id IS NOT NULL",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(
        db.query("SELECT count(*) AS count FROM world_bindings").get(),
      ).toEqual({ count: 2 });
      expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  }
});
test("a SQL refusal rolls back Board records, reserved IDs and binding captures but not neighboring accepted patches", () => {
  const p = fresh(),
    seed = open(p);
  seed.close();
  const fixture = new Database(p.database);
  fixture.exec(
    "CREATE TRIGGER refuse_appearance BEFORE INSERT ON board_appearance BEGIN SELECT RAISE(ABORT,'synthetic SQL refusal'); END",
  );
  fixture.close();
  const writer = open(p);
  try {
    const replies = writer.batch(
      [
        {
          ticket: 1,
          request: {
            type: "board",
            operation: {
              ops: [
                {
                  op: "note.put",
                  note: {
                    id: "note-keep",
                    text: "Keep",
                    color: "yellow",
                    x: 0,
                    y: 0,
                  },
                },
              ],
            },
          },
        },
        {
          ticket: 2,
          request: {
            type: "board",
            operation: {
              ops: [
                {
                  op: "string.put",
                  string: {
                    id: "string-rollback",
                    from: { anchor: target },
                    to: { anchor: target },
                  },
                },
                { op: "appearance.set", target, fields: { status: "Refused" } },
              ],
            },
          },
        },
        {
          ticket: 3,
          request: {
            type: "board",
            operation: {
              revision: 1,
              ops: [
                { op: "card.color", key: "studio:workspace-a", color: "teal" },
              ],
            },
          },
        },
      ],
      1000,
    );
    expect(replies[1]!.error).toContain("synthetic SQL refusal");
    expect(replies[0]!.error).toBeUndefined();
    expect(replies[2]!.error).toBeUndefined();
    expect(writer.read().board!.revision).toBe(2);
    expect(writer.read().board!.strings).toEqual([]);
  } finally {
    writer.close();
  }
  const db = new Database(p.database, { readonly: true });
  try {
    expect(
      db.query("SELECT count(*) AS count FROM world_bindings").get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query(
          "SELECT count(*) AS count FROM world_ids WHERE id='string-rollback'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query("SELECT row_revision FROM board_notes WHERE key='note-keep'")
        .get(),
    ).toEqual({ row_revision: 1 });
    expect(
      db.query("SELECT record_id,binding_id FROM board_colors").get(),
    ).toEqual({ record_id: null, binding_id: null });
  } finally {
    db.close();
  }
});

test("an interrupted Board import rolls back rows, reservations, bindings and marker before retry", () => {
  const p = fresh(),
    legacy = new BoardStore(p.board);
  const doc = legacy.patch([
    {
      op: "note.put",
      note: {
        id: "note-import",
        text: "Synthetic import",
        color: "yellow",
        x: 0,
        y: 0,
      },
    },
    { op: "appearance.set", target, fields: { color: "pink" } },
  ]);
  expect(() =>
    openWorldWriter(
      p.database,
      p.ledger,
      1000,
      "synthetic-incarnation",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        path: p.board,
        fault: (stage) => {
          if (stage === "before-commit")
            throw new Error("synthetic interruption");
        },
      },
    ),
  ).toThrow("synthetic interruption");
  const db = new Database(p.database);
  try {
    for (const table of [
      "board_notes",
      "board_appearance",
      "world_ids",
      "world_bindings",
    ])
      expect(db.query(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    expect(
      db
        .query("SELECT count(*) AS count FROM imports WHERE name='board-json'")
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
  const writer = open(p);
  try {
    expect(writer.read().board).toEqual(doc);
  } finally {
    writer.close();
  }
});
test("a completed Board import ignores malformed retained JSON without replacing its marker or binding identities", () => {
  const p = fresh(),
    legacy = new BoardStore(p.board);
  const doc = legacy.patch([
    { op: "appearance.set", target, fields: { color: "pink" } },
  ]);
  const initial = open(p);
  initial.close();
  const before = new Database(p.database);
  const marker = before
      .query("SELECT * FROM imports WHERE name='board-json'")
      .get(),
    bindings = before.query("SELECT * FROM world_bindings").all();
  before.close();
  writeFileSync(p.board, "{ malformed after committed import");
  let reopened!: ReturnType<typeof open>;
  expect(() => {
    reopened = open(p);
  }).not.toThrow();
  try {
    expect(reopened.read().board).toEqual(doc);
  } finally {
    reopened?.close();
  }
  const after = new Database(p.database);
  try {
    expect(
      after.query("SELECT * FROM imports WHERE name='board-json'").get(),
    ).toEqual(marker);
    expect(after.query("SELECT * FROM world_bindings").all()).toEqual(bindings);
  } finally {
    after.close();
  }
});
test("a conflicting preserved Board backup is refused before any rows or marker", () => {
  const p = fresh(),
    legacy = new BoardStore(p.board);
  legacy.patch([{ op: "appearance.set", target, fields: { color: "pink" } }]);
  const bytes = readFileSync(p.board),
    backup = `${p.board}.${createHash("sha256").update(bytes).digest("hex")}.sqlite-import.bak`;
  writeFileSync(backup, "Conflicting synthetic backup");
  expect(() => open(p)).toThrow(/backup/i);
  expect(readFileSync(p.board)).toEqual(bytes);
  expect(readFileSync(backup, "utf8")).toBe("Conflicting synthetic backup");
});
