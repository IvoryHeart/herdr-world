import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOARD_LIMITS,
  BoardConflictError,
  BoardStore,
  type BoardAnchor,
} from "./board-store";

let root: string;
let path: string;
beforeEach(() => {
  root = join(tmpdir(), `board-store-${crypto.randomUUID()}`);
  mkdirSync(join(root, "herdr-world"), { recursive: true });
  path = join(root, "herdr-world", "boards", "board.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const note = (id: string, text = "Ship it") => ({
  id,
  text,
  color: "yellow" as const,
  x: 10,
  y: 20,
});
const anchor = (native_id: string): BoardAnchor => ({
  connection_id: "studio",
  kind: "pane",
  native_id,
  witness: ["term_example_1"],
});

describe("Board store", () => {
  test("a new board is empty and nothing is written until it changes", () => {
    const store = new BoardStore(path);
    expect(store.get()).toMatchObject({
      version: 1,
      revision: 0,
      notes: [],
      strings: [],
    });
    expect(existsSync(path)).toBe(false);
  });

  test("notes and strings persist across a restart, written privately", () => {
    const store = new BoardStore(path);
    store.patch([
      { op: "note.put", note: note("n1") },
      {
        op: "string.put",
        string: {
          id: "s1",
          from: { note: "n1" },
          to: { anchor: anchor("w1:p1") },
        },
      },
      {
        op: "layout.set",
        offsets: { "studio:w1": { x: 640, y: 0 } },
        folded: ["studio:w2"],
      },
    ]);
    const reopened = new BoardStore(path).get();
    expect(reopened.revision).toBe(1);
    expect(reopened.notes).toEqual([{ ...note("n1"), rev: 1 }]);
    expect(reopened.strings[0]?.to).toEqual({ anchor: anchor("w1:p1") });
    expect(reopened.layout).toMatchObject({
      offsets: { "studio:w1": { x: 640, y: 0 } },
      folded: ["studio:w2"],
    });
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("an edit based on an older note revision is refused, never overwritten", () => {
    const store = new BoardStore(path);
    store.patch([{ op: "note.put", note: note("n1") }]);
    store.patch([{ op: "note.put", note: note("n1", "Phone edit"), rev: 1 }]);
    let conflict: unknown;
    try {
      store.patch([
        { op: "note.put", note: note("n1", "Desktop edit"), rev: 1 },
      ]);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(BoardConflictError);
    expect((conflict as BoardConflictError).document.notes[0]?.text).toBe(
      "Phone edit",
    );
    expect(store.get().notes[0]).toMatchObject({ text: "Phone edit", rev: 2 });
  });

  test("editing a deleted note is a conflict, and deleting a note removes its strings", () => {
    const store = new BoardStore(path);
    store.patch([
      { op: "note.put", note: note("n1") },
      {
        op: "string.put",
        string: {
          id: "s1",
          from: { note: "n1" },
          to: { anchor: anchor("w1:p1") },
        },
      },
    ]);
    store.patch([{ op: "note.delete", id: "n1", rev: 1 }]);
    expect(store.get().strings).toEqual([]);
    expect(() =>
      store.patch([{ op: "note.put", note: note("n1"), rev: 1 }]),
    ).toThrow(BoardConflictError);
  });

  test("operations apply all or none", () => {
    const store = new BoardStore(path);
    store.patch([{ op: "note.put", note: note("n1") }]);
    expect(() =>
      store.patch([
        { op: "note.put", note: note("n2") },
        {
          op: "string.put",
          string: { id: "s1", from: { note: "missing" }, to: { note: "n2" } },
        },
      ]),
    ).toThrow("missing note");
    expect(store.get()).toMatchObject({ revision: 1, notes: [{ id: "n1" }] });
  });

  test("layout merges, unpins, and anchors can be re-witnessed", () => {
    const store = new BoardStore(path);
    store.patch([
      { op: "layout.set", pinned: { a: { x: 1, y: 1 }, b: { x: 2, y: 2 } } },
      { op: "note.put", note: note("n1") },
      {
        op: "string.put",
        string: {
          id: "s1",
          from: { note: "n1" },
          to: { anchor: anchor("w1:p1") },
        },
      },
    ]);
    store.patch([
      { op: "layout.set", unpinned: ["a"], offsets: { c: { x: 3, y: 3 } } },
      {
        op: "anchor.witness",
        string_id: "s1",
        end: "to",
        witness: ["term_example_2"],
      },
    ]);
    const board = store.get();
    expect(board.layout.pinned).toEqual({ b: { x: 2, y: 2 } });
    expect(board.layout.offsets).toEqual({ c: { x: 3, y: 3 } });
    expect(board.strings[0]?.to).toMatchObject({
      anchor: { witness: ["term_example_2"] },
    });
  });

  test("bounds are enforced with clear errors", () => {
    const store = new BoardStore(path);
    expect(() =>
      store.patch([
        {
          op: "note.put",
          note: note("n1", "x".repeat(BOARD_LIMITS.noteText + 1)),
        },
      ]),
    ).toThrow("note text");
    const many = Array.from({ length: BOARD_LIMITS.ops }, (_, i) => ({
      op: "note.put" as const,
      note: note(`n${i}`),
    }));
    store.patch(many);
    expect(() =>
      store.patch([{ op: "note.put", note: note("one-more") }]),
    ).toThrow(`at most ${BOARD_LIMITS.notes} notes`);
    expect(() =>
      store.patch([
        { op: "layout.set", offsets: { k: { x: Number.NaN, y: 0 } } },
      ]),
    ).toThrow("point");
    expect(() =>
      store.patch([
        {
          op: "string.put",
          string: {
            id: "s",
            from: { note: "n1" },
            to: { anchor: { ...anchor("p"), kind: "host" as never } },
          },
        },
      ]),
    ).toThrow("anchor kind");
  });

  test("an unreadable file is kept aside and the board starts empty", () => {
    mkdirSync(join(root, "herdr-world", "boards"), { recursive: true });
    writeFileSync(path, "{ not json");
    const logs: string[] = [];
    const store = new BoardStore(path, {
      now: () => 42,
      log: (line) => logs.push(line),
    });
    expect(store.get().notes).toEqual([]);
    expect(readdirSync(join(root, "herdr-world", "boards"))).toContain(
      "board.json.unreadable-42",
    );
    expect(logs[0]).toContain("unreadable");
  });
});
