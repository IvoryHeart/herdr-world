import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interestKey } from "../../../shared/interest";
import { afterHerdrClose } from "./board-closing";
import { BoardStore } from "./board-store";

let root: string;
beforeEach(() => {
  root = join(tmpdir(), `board-closing-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("a closed tab drops its colour and pin; a closed pane drops gone terminals' interest", async () => {
  const board = new BoardStore(join(root, "board.json"));
  board.patch([
    { op: "card.color", key: "conn-a:tab:w1", color: "green" },
    { op: "desk.pin", key: "conn-a:tab:w1", cell: null },
    {
      op: "interest.set",
      key: interestKey("conn-a", "term_1"),
      interest: "muted",
    },
  ]);
  const revisions: number[] = [];
  const host = {
    call: async () => ({ panes: [] }),
    isCurrent: () => true,
    changed: (revision: number) => revisions.push(revision),
  };
  afterHerdrClose(
    board,
    "conn-a",
    "tab_closed",
    { data: { tab_id: "w1" } },
    host,
  );
  await settle();
  const layout = board.get().layout;
  expect(layout.colors).toEqual({});
  expect(layout.desk_pins).toEqual({});
  expect(layout.interest).toEqual({});
  expect(revisions.length).toBe(2);

  afterHerdrClose(board, "conn-a", "pane_agent_status_changed", {}, host);
  await settle();
  expect(revisions.length).toBe(2);
});
