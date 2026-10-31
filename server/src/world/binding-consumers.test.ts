import { expect, test } from "bun:test";
import { emptyBoardDocument } from "./board-store";
import { reconcileOps } from "./board-reconcile";

test("an ambiguous World move outcome preserves the Board string's saved target", () => {
  const document = emptyBoardDocument();
  document.strings.push({
    id: "string-fixture",
    from: { note: "note-fixture" },
    to: {
      anchor: {
        connection_id: "studio",
        kind: "pane",
        native_id: "pane-a",
        witness: ["terminal-a"],
      },
    },
  });
  const moved = {
    pane_id: "pane-b",
    tab_id: "tab-b",
    terminal_id: "terminal-a",
  };
  expect(reconcileOps(document, "studio", [moved])).toHaveLength(1);
  expect(
    reconcileOps(document, "studio", [moved, { ...moved, pane_id: "pane-c" }]),
  ).toEqual([]);
  expect(
    reconcileOps(document, "studio", [
      moved,
      { ...moved, terminal_id: "terminal-b" },
    ]),
  ).toEqual([]);
  expect(document.strings[0]!.to).toMatchObject({
    anchor: { native_id: "pane-a", witness: ["terminal-a"] },
  });
});
