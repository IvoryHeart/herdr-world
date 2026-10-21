import { expect, test } from "bun:test";
import { townMoveNotice, townMoveResult } from "./townMoves";

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
