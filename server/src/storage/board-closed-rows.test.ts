import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorldWriter } from "./world-writer";
import type { BoardOperation } from "./world-board";
import { appearanceKey } from "../../../shared/appearance";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fresh() {
  const root = mkdtempSync(join(tmpdir(), "board-closed-"));
  roots.push(root);
  const database = join(root, "world.sqlite");
  const open = () =>
    openWorldWriter(
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
  return { database, open };
}
type Writer = ReturnType<ReturnType<typeof fresh>["open"]>;
function board(writer: Writer, ops: BoardOperation["ops"]) {
  const [result] = writer.batch(
    [{ ticket: 0, request: { type: "board", operation: { ops } } }],
    1000,
  );
  expect(result!.error).toBeUndefined();
}
const rows = (database: string, family: string) => {
  const db = new Database(database, { readonly: true });
  try {
    return db
      .query(`SELECT key,body FROM board_${family} ORDER BY key`)
      .all() as { key: string; body: string }[];
  } finally {
    db.close();
  }
};

/** Run ops in a fresh writer session, then read rows once its lock is gone. */
function session(
  open: () => Writer,
  ops: BoardOperation["ops"],
): import("../world/board-store").BoardDocument {
  const writer = open();
  try {
    board(writer, ops);
    return writer.read().board!;
  } finally {
    writer.close();
  }
}

test("a closed tab's colour and pin stay under a closed key; a reused ID starts fresh", () => {
  const { database, open } = fresh();
  const key = "studio:tab:t1";
  session(open, [
    { op: "card.color", key, color: "red" },
    { op: "desk.pin", key, cell: null },
  ]);
  const closed = session(open, [{ op: "tab.close", keys: [key] }]);
  expect(closed.layout.colors[key]).toBeUndefined();
  expect(closed.layout.desk_pins[key]).toBeUndefined();
  const closedKey = JSON.stringify(["closed", closed.revision, key]);
  expect(rows(database, "colors")).toEqual([{ key: closedKey, body: '"red"' }]);
  expect(rows(database, "desk_pins").map((row) => row.key)).toEqual([
    closedKey,
  ]);
  // The same native ID comes back on a new tab, which the user colours and pins.
  const reused = session(open, [
    { op: "card.color", key, color: "blue" },
    { op: "desk.pin", key, cell: null },
  ]);
  expect(reused.layout.colors).toEqual({ [key]: "blue" });
  expect(Object.keys(reused.layout.desk_pins)).toEqual([key]);
  expect(rows(database, "colors")).toEqual([
    { key: closedKey, body: '"red"' },
    { key, body: '"blue"' },
  ]);
  // A user's own removal is not a close: the live row goes, the closed one stays.
  session(open, [{ op: "card.color", key, color: null }]);
  expect(rows(database, "colors")).toEqual([{ key: closedKey, body: '"red"' }]);
});

test("a pruned appearance and its tab colour are kept closed, hidden from the document", () => {
  const { database, open } = fresh();
  const target = {
    connection_id: "studio",
    kind: "tab" as const,
    native_id: "tab-a",
    witness: ["terminal-a"],
    color_key: "studio:tab:tab-a",
  };
  session(open, [
    {
      op: "appearance.set",
      target,
      fields: { color: "pink", status: "Reviewing" },
    },
  ]);
  const after = session(open, [
    { op: "appearance.prune", keys: [appearanceKey(target)] },
  ]);
  expect(after.appearance ?? {}).toEqual({});
  expect(after.layout.colors).toEqual({});
  const closedKey = (key: string) =>
    JSON.stringify(["closed", after.revision, key]);
  const appearance = rows(database, "appearance");
  expect(appearance.map((row) => row.key)).toEqual([
    closedKey(appearanceKey(target)),
  ]);
  expect(JSON.parse(appearance[0]!.body).status).toBe("Reviewing");
  expect(rows(database, "colors")).toEqual([
    { key: closedKey(target.color_key), body: '"pink"' },
  ]);
});
