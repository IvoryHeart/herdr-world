import { expect, test } from "bun:test";
import { moveTabInList } from "../../tabReorder";
import { deskReorderIndex, townMoveNotice, townMoveResult } from "./townMoves";

const pane = (tab: string, n: number) => ({
  terminal_id: `term-${n}`,
  pane_id: `p${n}`,
  tab_id: tab,
});

test("a move confirmed back reads as not moved and springs home", () => {
  const outcome = {
    status: "failed" as const,
    message: "Moving the desk failed: rejected The desk was moved back.",
    rolled_back: true,
    topology: [pane("t1", 1), pane("t1", 2)],
  };
  expect(townMoveResult(outcome)).toBe("returned");
  expect(townMoveNotice("Desk", outcome, "t1")).toStartWith("Desk not moved:");
});

test("a partial move says how many panes left, never that nothing moved", () => {
  const outcome = {
    status: "failed" as const,
    message: "Some panes could not be moved back.",
    rolled_back: false,
    topology_known: true,
    topology: [pane("t1", 1), pane("t9", 2), pane("t9", 3)],
  };
  expect(townMoveResult(outcome)).toBe("uncertain");
  const notice = townMoveNotice("Desk", outcome, "t1");
  expect(notice).toContain("only partly moved: 2 of 3 panes");
  expect(notice).not.toContain("not moved");
});

test("unknown pane locations ask the user to check both rooms", () => {
  const outcome = {
    status: "failed" as const,
    message: "Where its panes are now could not be read.",
    rolled_back: false,
    topology_known: false,
    topology: [],
  };
  expect(townMoveResult(outcome)).toBe("uncertain");
  expect(townMoveNotice("Desk", outcome, "t1")).toContain("Check both rooms");
});

const order = ["a", "b", "c", "d"];

/** Herdr's order after tab.move, as Spaces applies it locally. */
const after = (tabId: string, insertIndex: number) =>
  moveTabInList(
    order.map((tab_id) => ({ tab_id, workspace_id: "w" })),
    tabId,
    insertIndex,
  ).map(({ tab_id }) => tab_id);

test("a desk dropped on another takes that desk's slot", () => {
  // Forward: lands after the desk it was dropped on.
  expect(after("a", deskReorderIndex(order, "a", "c")!)).toEqual([
    "b",
    "c",
    "a",
    "d",
  ]);
  // Backward: lands before it.
  expect(after("d", deskReorderIndex(order, "d", "b")!)).toEqual([
    "a",
    "d",
    "b",
    "c",
  ]);
  expect(after("b", deskReorderIndex(order, "b", "a")!)).toEqual([
    "b",
    "a",
    "c",
    "d",
  ]);
});

test("a desk sent last goes after every tab, hidden ones included", () => {
  expect(after("b", deskReorderIndex(order, "b", null)!)).toEqual([
    "a",
    "c",
    "d",
    "b",
  ]);
  expect(deskReorderIndex(order, "d", null)).toBeNull();
});

test("a desk or target that left the room is refused", () => {
  expect(deskReorderIndex(order, "a", "x")).toBeUndefined();
  expect(deskReorderIndex(order, "x", "a")).toBeUndefined();
});
