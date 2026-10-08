import { describe, expect, test } from "bun:test";
import { moveTabInList, tabDropSlot, tabMoveInsertIndex } from "./tabReorder";

const tab = (tab_id: string, workspace_id = "w1") => ({ tab_id, workspace_id });
const ids = (tabs: { tab_id: string }[]) => tabs.map((t) => t.tab_id);

describe("tabMoveInsertIndex", () => {
  test("inserts before the new right-hand neighbor", () => {
    // a b c -> c a b: c goes before a.
    expect(tabMoveInsertIndex(["a", "b", "c"], "c", ["c", "a", "b"])).toBe(0);
    // a b c -> b a c: a goes before c, counted before removal.
    expect(tabMoveInsertIndex(["a", "b", "c"], "a", ["b", "a", "c"])).toBe(2);
  });

  test("appends after the new left-hand neighbor at the group end", () => {
    expect(tabMoveInsertIndex(["a", "b", "c"], "a", ["b", "c", "a"])).toBe(3);
  });

  test("returns null when the order does not change", () => {
    expect(tabMoveInsertIndex(["a", "b", "c"], "b", ["a", "b", "c"])).toBe(
      null,
    );
    expect(tabMoveInsertIndex(["a"], "a", ["a"])).toBe(null);
    expect(tabMoveInsertIndex(["a", "b"], "x", ["x", "a"])).toBe(null);
  });

  test("maps a pin group's display order onto Herdr's full order", () => {
    // Herdr order a p b c with p pinned; unpinned group displays a b c.
    // Moving c to the front of that group places it before a.
    expect(tabMoveInsertIndex(["a", "p", "b", "c"], "c", ["c", "a", "b"])).toBe(
      0,
    );
    // Moving a to the group end places it after c.
    expect(tabMoveInsertIndex(["a", "p", "b", "c"], "a", ["b", "c", "a"])).toBe(
      4,
    );
  });
});

describe("moveTabInList", () => {
  test("matches Herdr insert-before-index semantics", () => {
    const tabs = [tab("a"), tab("b"), tab("c")];
    expect(ids(moveTabInList(tabs, "a", 2))).toEqual(["b", "a", "c"]);
    expect(ids(moveTabInList(tabs, "c", 0))).toEqual(["c", "a", "b"]);
    expect(ids(moveTabInList(tabs, "a", 3))).toEqual(["b", "c", "a"]);
    expect(ids(moveTabInList(tabs, "b", 1))).toEqual(["a", "b", "c"]);
  });

  test("keeps other workspaces' tabs in their slots", () => {
    const tabs = [tab("x", "w0"), tab("a"), tab("y", "w2"), tab("b")];
    expect(ids(moveTabInList(tabs, "b", 0))).toEqual(["x", "b", "y", "a"]);
  });

  test("ignores unknown tabs", () => {
    expect(ids(moveTabInList([tab("a")], "z", 0))).toEqual(["a"]);
  });
});

describe("tabDropSlot", () => {
  test("counts the midpoints the dragged center has passed", () => {
    expect(tabDropSlot(5, [10, 30, 50])).toBe(0);
    expect(tabDropSlot(31, [10, 30, 50])).toBe(2);
    expect(tabDropSlot(99, [10, 30, 50])).toBe(3);
    expect(tabDropSlot(0, [])).toBe(0);
  });
});
