import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import {
  BoardStore,
  BoardConflictError,
  type BoardOp,
} from "../world/board-store";
import { openStorage, type WorldStorage } from "./storage";
import { systemClock, systemScheduler } from "./ports";
const roots: string[] = [],
  stores: WorldStorage[] = [];
afterEach(async () => {
  for (const s of stores.splice(0)) await s.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "sqlite-board-"));
  roots.push(root);
  return resolveDataPaths({ HERDR_WORLD_DATA_DIR: root });
};
const open = async (paths: ReturnType<typeof fresh>) => {
  const s = await openStorage(paths, {
    clock: systemClock,
    scheduler: systemScheduler,
  });
  stores.push(s);
  return s;
};
const note = (id: string, text: string): BoardOp => ({
  op: "note.put",
  note: { id, text, color: "yellow", x: 10, y: 20 },
});

test("the real root backs up Board JSON once and stores concerns and verified binding captures atomically", async () => {
  const paths = fresh(),
    legacy = new BoardStore(paths.board);
  const document = legacy.patch([
    note("note-a", "Synthetic A"),
    note("note-b", "Synthetic B"),
    {
      op: "string.put",
      string: {
        id: "string-a",
        from: { note: "note-a" },
        to: {
          anchor: {
            connection_id: "studio",
            kind: "pane",
            native_id: "pane-a",
            witness: ["terminal-a"],
          },
        },
      },
    },
    { op: "layout.set", anchors: { "studio:workspace-a": { x: 1, y: 2 } } },
    { op: "card.color", key: "studio:workspace-a", color: "blue" },
    {
      op: "appearance.set",
      target: {
        connection_id: "studio",
        kind: "pane",
        native_id: "pane-a",
        witness: ["terminal-a"],
      },
      fields: { avatar: "builder" },
    },
    {
      op: "interest.set",
      key: "studio:terminal:terminal-a",
      interest: "muted",
    },
  ]);
  const source = readFileSync(paths.board),
    backup = `${paths.board}.${createHash("sha256").update(source).digest("hex")}.sqlite-import.bak`;
  const store = await open(paths);
  expect(existsSync(backup)).toBe(true);
  expect(readFileSync(backup)).toEqual(source);
  expect(store.board().get()).toEqual(document);
  const bindings = await store.bindings.list();
  expect(bindings.map((b) => b.policy).sort()).toEqual([
    "appearance",
    "board-string",
    "interest",
  ]);
  expect(bindings.filter((b) => b.native_id === "workspace-a")).toHaveLength(0);
  await store.board().patch([
    {
      op: "note.put",
      note: { ...document.notes[0]!, text: "Synthetic A revised" },
      rev: document.notes[0]!.rev,
    },
  ]);
  expect(readFileSync(paths.board)).toEqual(source);
  await store.close();
  const db = new Database(join(paths.root, "world.sqlite"), { readonly: true });
  let imported: unknown;
  try {
    expect(db.query("SELECT count(*) AS count FROM board_notes").get()).toEqual(
      { count: 2 },
    );
    expect(
      db.query("SELECT count(*) AS count FROM board_strings").get(),
    ).toEqual({ count: 1 });
    expect(
      db.query("SELECT row_revision FROM board_notes WHERE key='note-a'").get(),
    ).toEqual({ row_revision: document.revision + 1 });
    expect(
      db.query("SELECT row_revision FROM board_notes WHERE key='note-b'").get(),
    ).toEqual({ row_revision: document.revision });
    imported = db.query("SELECT * FROM imports WHERE name='board-json'").get();
  } finally {
    db.close();
  }
  const again = await open(paths);
  expect(again.board().get().notes[0]!.text).toBe("Synthetic A revised");
  await again.close();
  const checked = new Database(join(paths.root, "world.sqlite"), {
    readonly: true,
  });
  try {
    expect(
      checked.query("SELECT * FROM imports WHERE name='board-json'").get(),
    ).toEqual(imported);
  } finally {
    checked.close();
  }
});

test("Board cache advances only after commit; independent notes survive and stale note revisions return the current document", async () => {
  const store = await open(fresh()),
    board = store.board();
  await board.patch([note("note-a", "A"), note("note-b", "B")]);
  const before = board.get();
  const first = board.patch([
    {
      op: "note.put",
      note: { ...before.notes[0]!, text: "A committed" },
      rev: before.notes[0]!.rev,
    },
  ]);
  expect(board.get()).toEqual(before);
  await Promise.resolve();
  expect(board.get()).toEqual(before);
  const outcomes = await Promise.allSettled([
    first,
    board.patch([
      {
        op: "note.put",
        note: { ...before.notes[0]!, text: "Stale A" },
        rev: before.notes[0]!.rev,
      },
    ]),
    board.patch([
      {
        op: "note.put",
        note: { ...before.notes[1]!, text: "B committed" },
        rev: before.notes[1]!.rev,
      },
    ]),
  ]);
  expect(outcomes.map((o) => o.status)).toEqual([
    "fulfilled",
    "rejected",
    "fulfilled",
  ]);
  const error = (outcomes[1] as PromiseRejectedResult).reason;
  expect(error).toBeInstanceOf(BoardConflictError);
  expect(error.document.notes[0].text).toBe("A committed");
  expect(board.get().notes.map((n) => n.text)).toEqual([
    "A committed",
    "B committed",
  ]);
  expect(board.get().revision).toBe(before.revision + 2);
});

test("a valid multibyte Board patch larger than the ordinary batch limit commits and survives restart", async () => {
  const paths = fresh(),
    store = await open(paths),
    board = store.board();
  const ops = Array.from({ length: 400 }, (_, i) =>
    note(`note-${i}`, "界".repeat(3800)),
  );
  expect(Buffer.byteLength(JSON.stringify(ops))).toBeGreaterThan(
    4 * 1024 * 1024,
  );
  const write = board.patch(ops),
    closing = store.close();
  await write;
  await closing;
  const reopened = await open(paths);
  expect(reopened.board().get().notes).toHaveLength(400);
  expect(reopened.board().get().notes[399]!.text).toBe("界".repeat(3800));
});

test("queued planning and conditional compensation use the latest committed Board", async () => {
  const store = await open(fresh()),
    board = store.board();
  await board.patch([note("note-a", "Initial")]);
  const revision = board.get().revision;
  const edit = board.patch([
    {
      ...note("note-a", "Newer browser edit"),
      rev: board.get().notes[0]!.rev,
    } as BoardOp,
  ]);
  let compensated = false;
  const compensate = board.patchIf(revision, () => {
    compensated = true;
    return [{ op: "card.color", key: "studio:workspace-a", color: "red" }];
  });
  const planning = board.patch((doc) => [note("note-b", doc.notes[0]!.text)]);
  const results = await Promise.all([edit, compensate, planning]);
  expect(results[1]).toBeNull();
  expect(compensated).toBe(false);
  expect(board.get().notes.map((n) => n.text)).toEqual([
    "Newer browser edit",
    "Newer browser edit",
  ]);
  const before = board.get(),
    failed = board.patch([
      note("note-c", "Must roll back"),
      { op: "note.delete", id: "note-a", rev: 0 },
    ]);
  const [refused] = await Promise.allSettled([failed]);
  expect(refused!.status).toBe("rejected");
  expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(
    BoardConflictError,
  );
  expect(board.get()).toEqual(before);
});

test("malformed legacy Board is backed up exactly and import can be repaired without partial records", async () => {
  const paths = fresh();
  mkdirSync(dirname(paths.board), { recursive: true });
  const bytes = Buffer.from([0x7b, 0xff, 0x7d]);
  writeFileSync(paths.board, bytes, { mode: 0o600 });
  const backup = `${paths.board}.${createHash("sha256").update(bytes).digest("hex")}.sqlite-import.bak`;
  await expect(open(paths)).rejects.toThrow();
  expect(readFileSync(paths.board)).toEqual(bytes);
  expect(readFileSync(backup)).toEqual(bytes);
  if (process.platform !== "win32")
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  const db = new Database(join(paths.root, "world.sqlite"));
  try {
    expect(db.query("SELECT count(*) AS count FROM board_meta").get()).toEqual({
      count: 0,
    });
    expect(
      db.query("SELECT count(*) AS count FROM world_bindings").get(),
    ).toEqual({ count: 0 });
    expect(
      db
        .query("SELECT count(*) AS count FROM imports WHERE name='board-json'")
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
  rmSync(paths.board);
  const legacy = new BoardStore(paths.board);
  const doc = legacy.patch([note("note-repaired", "Repaired")]);
  const store = await open(paths);
  expect(store.board().get()).toEqual(doc);
  await store
    .board()
    .patch([
      { op: "note.delete", id: "note-repaired", rev: doc.notes[0]!.rev },
    ]);
  await store.close();
  writeFileSync(paths.board, "{ changed after import");
  const again = await open(paths);
  expect(again.board().get().notes).toEqual([]);
});

test("a conflicting exact-byte backup blocks Board import without changing its source", async () => {
  const paths = fresh(),
    legacy = new BoardStore(paths.board);
  legacy.patch([note("note-a", "Legacy")]);
  const bytes = readFileSync(paths.board),
    backup = `${paths.board}.${createHash("sha256").update(bytes).digest("hex")}.sqlite-import.bak`;
  writeFileSync(backup, "Existing protected backup");
  await expect(open(paths)).rejects.toThrow(/backup/i);
  expect(readFileSync(paths.board)).toEqual(bytes);
  expect(readFileSync(backup, "utf8")).toBe("Existing protected backup");
});
