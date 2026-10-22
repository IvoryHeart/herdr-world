import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
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
  clientBoardOps,
  moveFollowOps,
  reconcileOps,
  tabClosedColorOps,
  type BoardAnchor,
} from "./board-store";
import {
  defaultTerminalColorFor,
  resolveTerminalColor,
} from "../../../shared/terminalColor";
import { encodeRecipient, recipientOps, sessionOf } from "./board-recipient";

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
  test("which agent a pane string is for is the service's to record (#228)", () => {
    const store = new BoardStore(path);
    // A client cannot claim a recipient, nor send the service's operation.
    const { ops, observed } = clientBoardOps([
      { op: "note.put", note: note("n1") },
      {
        op: "string.put",
        string: {
          id: "s1",
          from: { note: "n1" },
          to: {
            anchor: {
              ...anchor("w1:p1"),
              recipient: "forged",
              observed: { agent: "claude", session: { value: "seen" } },
            },
          },
        },
      },
    ]);
    store.patch(ops);
    // What the browser showed is returned for this save, never stored.
    expect(store.get().strings[0]?.to).toEqual({ anchor: anchor("w1:p1") });
    expect(observed.get("s1:to")).toEqual({
      agent: "claude",
      session: { value: "seen" },
    });
    expect(() =>
      clientBoardOps([
        {
          op: "anchor.recipient",
          string_id: "s1",
          end: "to",
          connection_id: "studio",
          pane_id: "w1:p1",
          terminal_id: "term_example_1",
          recipient: "forged",
        },
      ]),
    ).toThrow("unknown operation");
    // The service's record applies only while the end names that host, pane
    // and a witnessed terminal, and survives a restart.
    const record = (
      pane_id: string,
      terminal_id: string,
      connection_id = "studio",
    ) =>
      store.patch([
        {
          op: "anchor.recipient",
          string_id: "s1",
          end: "to",
          connection_id,
          pane_id,
          terminal_id,
          recipient: `agent-in-${pane_id}-${terminal_id}`,
        },
      ]);
    record("w1:p2", "term_example_1");
    record("w1:p1", "term_other");
    record("w1:p1", "term_example_1", "other-host");
    expect(store.get().strings[0]?.to).toEqual({ anchor: anchor("w1:p1") });
    record("w1:p1", "term_example_1");
    const recorded = {
      anchor: {
        ...anchor("w1:p1"),
        recipient: "agent-in-w1:p1-term_example_1",
      },
    };
    expect(new BoardStore(path).get().strings[0]?.to).toEqual(recorded);
    // A new terminal holds a different agent: re-witnessing forgets it.
    store.patch([
      {
        op: "anchor.witness",
        string_id: "s1",
        end: "to",
        witness: ["term_after_restart"],
      },
    ]);
    expect(store.get().strings[0]?.to).toEqual({
      anchor: { ...anchor("w1:p1"), witness: ["term_after_restart"] },
    });
  });

  test("a late recipient read for one host never lands on another host's string (review P2)", async () => {
    const store = new BoardStore(path);
    const string = (connection_id: string) => ({
      op: "string.put" as const,
      string: {
        id: "s1",
        from: { note: "n1" },
        to: { anchor: { ...anchor("w1:p1"), connection_id } },
      },
    });
    store.patch([{ op: "note.put", note: note("n1") }, string("studio")]);
    const session = { source: "hook", kind: "id", value: "session-a" };
    let answer!: () => void;
    const pending = recipientOps(
      store.get(),
      [string("studio")],
      new Map([["s1:to", { agent: "claude", session }]]),
      () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              token: encodeRecipient({
                agent: "claude",
                session: sessionOf(session),
                group: 10,
              }),
              label: "claude",
              terminal_id: "term_example_1",
            });
        }),
    );
    // While studio's read is pending, the string moves to another host whose
    // pane and terminal IDs happen to match.
    store.patch([string("other-host")]);
    answer();
    store.patch(await pending);
    expect(store.get().strings[0]?.to).toEqual({
      anchor: { ...anchor("w1:p1"), connection_id: "other-host" },
    });
  });

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

  test("a replacing layout save drops entries for cards that are gone", () => {
    const store = new BoardStore(path);
    store.patch([
      {
        op: "layout.set",
        offsets: { old: { x: 1, y: 1 }, kept: { x: 2, y: 2 } },
      },
    ]);
    store.patch([
      { op: "layout.set", replace: true, offsets: { kept: { x: 3, y: 3 } } },
    ]);
    expect(store.get().layout.offsets).toEqual({ kept: { x: 3, y: 3 } });
  });

  test("card colours are set, cleared, kept by layout saves and persisted", () => {
    const store = new BoardStore(path);
    store.patch([
      { op: "card.color", key: "studio:w1", color: "teal" },
      { op: "card.color", key: "studio:w1:t2", color: "purple" },
    ]);
    store.patch([{ op: "card.color", key: "studio:w1:t2", color: null }]);
    store.patch([
      {
        op: "layout.set",
        replace: true,
        offsets: { "studio:w1": { x: 1, y: 1 } },
      },
    ]);
    expect(new BoardStore(path).get().layout.colors).toEqual({
      "studio:w1": "teal",
    });
    expect(() =>
      store.patch([
        { op: "card.color", key: "studio:w1", color: "plaid" as never },
      ]),
    ).toThrow("card colour");
  });

  test("a board saved before card colours loads with none", () => {
    const store = new BoardStore(path);
    store.patch([{ op: "note.put", note: note("n1") }]);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    delete raw.layout.colors;
    writeFileSync(path, JSON.stringify(raw));
    expect(new BoardStore(path).get().layout.colors).toEqual({});
  });

  test("a string whose target is gone is detached, not deleted", () => {
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
    store.patch([{ op: "string.detach", id: "s1" }]);
    expect(new BoardStore(path).get().strings[0]).toMatchObject({
      id: "s1",
      detached: true,
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

  test("strings follow a move made in any view: new pane and tab IDs, same witnesses", () => {
    const pane = (native_id: string, connection_id = "alpha") => ({
      anchor: {
        connection_id,
        kind: "pane" as const,
        native_id,
        witness: ["term_1"],
      },
    });
    const store = new BoardStore(path);
    store.patch([
      { op: "note.put", note: note("n1") },
      {
        op: "string.put",
        string: { id: "a", from: { note: "n1" }, to: pane("w1:p2") },
      },
      {
        op: "string.put",
        string: {
          id: "b",
          from: { note: "n1" },
          to: {
            anchor: {
              connection_id: "alpha",
              kind: "tab",
              native_id: "w1:t1",
              witness: [],
            },
          },
        },
      },
      {
        op: "string.put",
        string: { id: "c", from: { note: "n1" }, to: pane("w1:p9") },
      },
      {
        op: "string.put",
        string: { id: "d", from: { note: "n1" }, to: pane("w1:p2", "beta") },
      },
    ]);
    const desk = moveFollowOps(store.get(), "alpha", "w1:t1", {
      tab_id: "w2:t4",
      panes: [{ previous: "w1:p2", current: "w2:p7" }],
    });
    expect(desk.map((op) => op.op === "string.put" && op.string.id)).toEqual([
      "a",
      "b",
    ]);
    store.patch(desk);
    const after = store.get().strings;
    expect(after.find((s) => s.id === "a")!.to).toEqual(pane("w2:p7"));
    expect(after.find((s) => s.id === "b")!.to).toMatchObject({
      anchor: { native_id: "w2:t4" },
    });
    // A single pane moved into another desk: only that pane's anchor changes.
    const single = moveFollowOps(store.get(), "alpha", null, {
      tab_id: "w3:t1",
      panes: [{ previous: "w1:p9", current: "w3:p2" }],
    });
    expect(single.map((op) => op.op === "string.put" && op.string.id)).toEqual([
      "c",
    ]);
  });

  describe("a moved tab keeps the colour it showed", () => {
    const ids = new Set(["w1", "w2", "w3"]);
    const move = (
      store: BoardStore,
      tab: string,
      to: { tab_id: string; from: string; workspace: string },
    ) =>
      moveFollowOps(
        store.get(),
        "alpha",
        tab,
        {
          tab_id: to.tab_id,
          workspace_id: to.workspace,
          source_workspace_id: to.from,
          panes: [],
        },
        { before: store.get().layout.colors, workspaceIds: ids },
      );

    test("a chosen colour moves to the new tab ID; other hosts are untouched", () => {
      const store = new BoardStore(path);
      store.patch([
        { op: "card.color", key: "alpha:w1:t1", color: "teal" },
        { op: "card.color", key: "beta:w1:t1", color: "red" },
      ]);
      store.patch(
        move(store, "w1:t1", { tab_id: "w2:t4", from: "w1", workspace: "w2" }),
      );
      expect(store.get().layout.colors).toEqual({
        "alpha:w2:t4": "teal",
        "beta:w1:t1": "red",
      });
    });

    const shown = (store: BoardStore, workspaceId: string, tabId: string) =>
      resolveTerminalColor<string>(store.get().layout.colors, {
        connectionId: "alpha",
        workspaceId,
        tabId,
        workspaceIds: ids,
      }).color;

    test("a default colour is kept by saving it for the new tab", () => {
      const store = new BoardStore(path);
      const before = shown(store, "w1", "w1:t1");
      store.patch(
        move(store, "w1:t1", { tab_id: "w2:t4", from: "w1", workspace: "w2" }),
      );
      expect(shown(store, "w2", "w2:t4")).toBe(before);
    });

    test("an inherited workspace colour is kept; the workspace keeps its own", () => {
      const store = new BoardStore(path);
      store.patch([{ op: "card.color", key: "alpha:w2", color: "pink" }]);
      store.patch(
        move(store, "w2:t4", { tab_id: "w3:t1", from: "w2", workspace: "w3" }),
      );
      expect(shown(store, "w3", "w3:t1")).toBe("pink");
      expect(store.get().layout.colors["alpha:w2"]).toBe("pink");
    });

    test("a tab's own colour stays its own when it matches the new room's", () => {
      const store = new BoardStore(path);
      store.patch([
        { op: "card.color", key: "alpha:w1:t1", color: "red" },
        { op: "card.color", key: "alpha:w2", color: "red" },
      ]);
      store.patch(
        move(store, "w1:t1", { tab_id: "w2:t4", from: "w1", workspace: "w2" }),
      );
      expect(store.get().layout.colors).toEqual({
        "alpha:w2": "red",
        "alpha:w2:t4": "red",
      });
      // Recolouring the room later leaves the moved tab alone.
      store.patch([{ op: "card.color", key: "alpha:w2", color: "blue" }]);
      expect(shown(store, "w2", "w2:t4")).toBe("red");
    });

    test("a tab whose ID is a workspace's (older Herdr) uses the qualified key", () => {
      const store = new BoardStore(path);
      // A colour the new tab would not show by default, so it must be saved.
      const own =
        defaultTerminalColorFor("alpha:w2:t9") === "pink" ? "orange" : "pink";
      store.patch([
        { op: "card.color", key: "alpha:w1", color: "green" },
        { op: "card.color", key: "alpha:tab:w1", color: own },
      ]);
      expect(
        move(store, "w1", { tab_id: "w2:t9", from: "w1", workspace: "w2" }),
      ).toEqual([
        { op: "card.color", key: "alpha:w2:t9", color: own },
        { op: "card.color", key: "alpha:tab:w1", color: null },
      ]);
    });
  });

  test("a closed tab's colour goes; a plain key only when no workspace holds it", () => {
    const store = new BoardStore(path);
    store.patch([
      { op: "card.color", key: "alpha:w1:t1", color: "teal" },
      { op: "card.color", key: "alpha:w2", color: "green" },
      { op: "card.color", key: "alpha:tab:w2", color: "pink" },
    ]);
    expect(tabClosedColorOps(store.get(), "alpha", "w1:t1", true)).toEqual([
      { op: "card.color", key: "alpha:w1:t1", color: null },
    ]);
    // Older Herdr: tab w2 closed while workspace w2 still exists.
    expect(tabClosedColorOps(store.get(), "alpha", "w2", false)).toEqual([
      { op: "card.color", key: "alpha:tab:w2", color: null },
    ]);
  });

  test("a conditional detach applies only while the end still names the checked target", () => {
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
    const ifOld = {
      end: "to" as const,
      connection_id: "studio",
      kind: "pane" as const,
      native_id: "w1:p1",
    };
    // A move rewrote the string first: the late detach is a no-op.
    store.patch([
      {
        op: "string.put",
        string: {
          id: "s1",
          from: { note: "n1" },
          to: { anchor: anchor("w2:p4") },
        },
      },
    ]);
    store.patch([{ op: "string.detach", id: "s1", if_anchor: ifOld }]);
    expect(store.get().strings[0]!.detached).toBeUndefined();
    store.patch([
      {
        op: "string.detach",
        id: "s1",
        if_anchor: { ...ifOld, native_id: "w2:p4" },
      },
    ]);
    expect(store.get().strings[0]!.detached).toBe(true);
  });

  test("after a compensated move, witnessed anchors follow the observed panes", () => {
    const pane = (native_id: string, witness: string[]) => ({
      anchor: {
        connection_id: "studio",
        kind: "pane" as const,
        native_id,
        witness,
      },
    });
    const store = new BoardStore(path);
    store.patch([
      { op: "note.put", note: note("n1") },
      // The string's terminal was put back in its tab under a new pane ID.
      {
        op: "string.put",
        string: {
          id: "a",
          from: { note: "n1" },
          to: pane("w1:p1", ["term_1"]),
        },
      },
      // Its terminal was not observed: left as it is.
      {
        op: "string.put",
        string: {
          id: "b",
          from: { note: "n1" },
          to: pane("w1:p3", ["term_3"]),
        },
      },
      {
        op: "string.put",
        string: {
          id: "c",
          from: { note: "n1" },
          to: {
            anchor: {
              connection_id: "studio",
              kind: "tab",
              native_id: "w1:t1",
              witness: ["term_1", "term_2"],
            },
          },
        },
      },
    ]);
    const ops = reconcileOps(store.get(), "studio", [
      { terminal_id: "term_1", pane_id: "w1:p5", tab_id: "w1:t1" },
      { terminal_id: "term_2", pane_id: "w1:p6", tab_id: "w1:t1" },
    ]);
    expect(ops.map((op) => op.op === "string.put" && op.string.id)).toEqual([
      "a",
    ]);
    store.patch(ops);
    expect(store.get().strings.find((s) => s.id === "a")!.to).toEqual(
      pane("w1:p5", ["term_1"]),
    );
    // Only some of the tab's terminals were seen, in another tab: not moved.
    expect(
      reconcileOps(store.get(), "studio", [
        { terminal_id: "term_1", pane_id: "w2:p1", tab_id: "w2:t1" },
      ]).filter((op) => op.op === "string.put" && op.string.id === "c"),
    ).toEqual([]);
    // Split across tabs: the tab anchor is not guessed.
    expect(
      reconcileOps(store.get(), "studio", [
        { terminal_id: "term_1", pane_id: "w1:p5", tab_id: "w1:t1" },
        { terminal_id: "term_2", pane_id: "w2:p1", tab_id: "w2:t1" },
      ]).map((op) => op.op === "string.put" && op.string.id),
    ).toEqual([]);
  });
});
