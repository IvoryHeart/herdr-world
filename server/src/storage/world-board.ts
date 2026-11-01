import type { Database } from "bun:sqlite";
import {
  BoardStore,
  BoardConflictError,
  emptyBoardDocument,
  type BoardDocument,
  type BoardOp,
} from "../world/board-store";
import { boardBindingCaptures } from "../world/board-bindings";
import type { createBindingWriter } from "./world-bindings";

const maps = [
  "anchors",
  "offsets",
  "pinned",
  "colors",
  "desk_pins",
  "interest",
  "group_interest",
] as const;
export const boardTables = [
  "notes",
  "strings",
  "appearance",
  ...maps,
  "folded",
  "spawns",
  "groups",
  "group_changes",
] as const;
type Family = (typeof boardTables)[number];
type Row = {
  key: string;
  position: number;
  row_revision: number;
  body: string;
  record_id: string | null;
  binding_id: string | null;
};
export const worldBoardMigration = `
CREATE TABLE board_meta(singleton INTEGER PRIMARY KEY CHECK(singleton=1),revision INTEGER NOT NULL CHECK(revision>=0),appearance INTEGER NOT NULL,group_interest INTEGER NOT NULL,group_changes INTEGER NOT NULL);
${boardTables
  .map(
    (family) => `CREATE TABLE board_${family}(
 key TEXT PRIMARY KEY NOT NULL,position INTEGER NOT NULL CHECK(position>=0),row_revision INTEGER NOT NULL CHECK(row_revision>=0),
 body TEXT NOT NULL CHECK(json_valid(body)),record_id TEXT REFERENCES world_ids(id),binding_id TEXT REFERENCES world_bindings(id) ON DELETE SET NULL
);`,
  )
  .join("\n")}
`;
export function readBoard(db: Database): BoardDocument | null {
  const meta = db.query("SELECT * FROM board_meta WHERE singleton=1").get() as {
    revision: number;
    appearance: number;
    group_interest: number;
    group_changes: number;
  } | null;
  if (!meta) return null;
  const rows = (family: Family) =>
    (
      db
        .query(`SELECT key,body FROM board_${family} ORDER BY position,key`)
        .all() as Pick<Row, "key" | "body">[]
    ).map((row) => [row.key, JSON.parse(row.body)] as const);
  const doc = emptyBoardDocument();
  doc.revision = meta.revision;
  doc.notes = rows("notes").map(([, body]) => body);
  doc.strings = rows("strings").map(([, body]) => body);
  for (const family of maps)
    (doc.layout as any)[family] = Object.fromEntries(rows(family));
  if (!meta.group_interest) delete doc.layout.group_interest;
  doc.layout.folded = rows("folded").map(([key]) => key);
  doc.relations.spawns = rows("spawns").map(([, body]) => body);
  doc.relations.groups = rows("groups").map(([, body]) => body);
  if (meta.group_changes)
    doc.relations.group_changes = rows("group_changes").map(([, body]) => body);
  if (meta.appearance) doc.appearance = Object.fromEntries(rows("appearance"));
  return doc;
}
const signature = (doc: BoardDocument) =>
  JSON.stringify(
    boardBindingCaptures(doc).sort((a, b) => a.key.localeCompare(b.key)),
  );
export function writeBoard(
  db: Database,
  next: BoardDocument,
  bindings: ReturnType<typeof createBindingWriter>,
  at: number,
  previous: BoardDocument | null = null,
) {
  if (!Number.isSafeInteger(next.revision) || next.revision < 0)
    throw new Error("invalid Board revision");
  const reserve = db.query(
    "INSERT INTO world_ids(id) SELECT ? WHERE NOT EXISTS(SELECT 1 FROM world_ids WHERE id=?)",
  );
  for (const record of [
    ...next.notes,
    ...next.strings,
    ...next.relations.groups,
  ])
    reserve.run(record.id, record.id);
  for (const id of Object.keys(next.layout.group_interest ?? {}))
    reserve.run(id, id);
  if (!previous || signature(next) !== signature(previous)) {
    const captures = boardBindingCaptures(next);
    bindings.execute({ type: "legacy", operation: { type: "begin" } }, at);
    for (let i = 0; i < captures.length; i += 64)
      bindings.execute(
        {
          type: "legacy",
          operation: { type: "prepare", captures: captures.slice(i, i + 64) },
        },
        at,
      );
    bindings.execute({ type: "legacy", operation: { type: "plan" } }, at);
    for (let i = 0; i < captures.length; i += 64)
      bindings.execute(
        {
          type: "legacy",
          operation: {
            type: "put",
            keys: captures.slice(i, i + 64).map((c) => c.key),
          },
        },
        at,
      );
    bindings.execute({ type: "legacy", operation: { type: "finish" } }, at);
  }
  const captureKeys = new Set(boardBindingCaptures(next).map((c) => c.key));
  const bound = new Map(
    (
      db
        .query(
          "SELECT l.key,b.id,b.record_id FROM world_binding_legacy l JOIN world_bindings b ON b.id=l.binding_id",
        )
        .all() as { key: string; id: string; record_id: string }[]
    ).map((row) => [row.key, row]),
  );
  const owned = (capture: string | undefined) =>
    capture ? bound.get(capture) : undefined;
  const colours = new Map(
    Object.entries(next.appearance ?? {})
      .filter(([, r]) => r.kind === "tab" && r.color_key)
      .map(([key, r]) => [r.color_key!, JSON.stringify(["tab-colour", key])]),
  );
  function save(
    family: Family,
    entries: readonly (readonly [string, unknown])[],
  ) {
    const keep = new Set(entries.map(([key]) => key));
    for (const row of db.query(`SELECT key FROM board_${family}`).all() as {
      key: string;
    }[])
      if (!keep.has(row.key))
        db.query(`DELETE FROM board_${family} WHERE key=?`).run(row.key);
    const put =
      db.query(`INSERT INTO board_${family}(key,position,row_revision,body,record_id,binding_id) VALUES(?,?,?,?,?,?)
   ON CONFLICT(key) DO UPDATE SET position=excluded.position,row_revision=excluded.row_revision,body=excluded.body,record_id=excluded.record_id,binding_id=excluded.binding_id
   WHERE board_${family}.position<>excluded.position OR board_${family}.body<>excluded.body OR board_${family}.record_id IS NOT excluded.record_id OR board_${family}.binding_id IS NOT excluded.binding_id`);
    entries.forEach(([key, value], position) => {
      const capture =
        family === "appearance"
          ? JSON.stringify(["appearance", key])
          : family === "interest" &&
              captureKeys.has(JSON.stringify(["interest", key]))
            ? JSON.stringify(["interest", key])
            : family === "colors"
              ? colours.get(key)
              : undefined;
      const binding = owned(capture);
      if (
        capture &&
        (family !== "colors" || (next.layout.colors as any)[key]) &&
        !binding
      )
        throw new Error("Board binding capture is missing");
      const record = ["notes", "strings", "groups", "group_interest"].includes(
        family,
      )
        ? key
        : (binding?.record_id ?? null);
      put.run(
        key,
        position,
        next.revision,
        JSON.stringify(value),
        record,
        binding?.id ?? null,
      );
    });
  }
  save(
    "notes",
    next.notes.map((note) => [note.id, note]),
  );
  save(
    "strings",
    next.strings.map((string) => [string.id, string]),
  );
  save("appearance", Object.entries(next.appearance ?? {}));
  for (const family of maps)
    save(family, Object.entries(next.layout[family] ?? {}));
  save(
    "folded",
    next.layout.folded.map((key) => [key, true]),
  );
  save(
    "spawns",
    next.relations.spawns.map((row) => [
      JSON.stringify([row.child.connection_id, row.child.terminal_id]),
      row,
    ]),
  );
  save(
    "groups",
    next.relations.groups.map((row) => [row.id, row]),
  );
  save(
    "group_changes",
    (next.relations.group_changes ?? []).map((row, index) => [
      String(index),
      row,
    ]),
  );
  db.query(
    `INSERT INTO board_meta VALUES(1,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,appearance=excluded.appearance,group_interest=excluded.group_interest,group_changes=excluded.group_changes`,
  ).run(
    next.revision,
    Number(next.appearance !== undefined),
    Number(next.layout.group_interest !== undefined),
    Number(next.relations.group_changes !== undefined),
  );
}
export type BoardOperation = { ops: readonly BoardOp[]; revision?: number };
export type BoardCommit = { document: BoardDocument | null; conflict?: string };
export function executeBoardOperation(
  db: Database,
  operation: BoardOperation,
  bindings: ReturnType<typeof createBindingWriter>,
  at: number,
): BoardCommit {
  const before = readBoard(db);
  if (!before) throw new Error("World Board was not initialized");
  if (
    operation.revision !== undefined &&
    operation.revision !== before.revision
  )
    return { document: null };
  const model = new BoardStore(
    {
      read: () => before,
      commit: (next) => writeBoard(db, next, bindings, at, before),
    },
    { now: () => at },
  );
  try {
    return { document: model.patch(operation.ops) };
  } catch (error) {
    if (error instanceof BoardConflictError)
      return { document: error.document, conflict: error.message };
    throw error;
  }
}
