import { expect, test } from "bun:test";
import { applyAppearance } from "../../../shared/appearance";
import { appearanceForMove, reconciledAppearanceOps } from "./appearance-move";
import { emptyBoardDocument } from "./board-store";
const target = {
  connection_id: "alpha",
  kind: "tab" as const,
  native_id: "tab-1",
  witness: ["terminal-1"],
  color_key: "alpha:tab-1",
};
test("moving a reused tab ID cannot carry the old occupant's colour or status", () => {
  const doc = emptyBoardDocument();
  applyAppearance(doc, target, { color: "pink", status: "Old occupant" });
  const moved = {
    tab_id: "tab-2",
    panes: [{ previous: "pane-1", current: "pane-2" }],
  };
  const result = appearanceForMove(
    doc,
    "alpha",
    [{ pane_id: "pane-2", tab_id: "tab-2", terminal_id: "replacement" }],
    "tab-1",
    moved,
  );
  expect(result.layout.colors[target.color_key]).toBeUndefined();
  expect(Object.keys(result.appearance ?? {})).toHaveLength(0);
  const continued = appearanceForMove(
    doc,
    "alpha",
    [{ pane_id: "pane-2", tab_id: "tab-2", terminal_id: "terminal-1" }],
    "tab-1",
    moved,
  );
  expect(continued.layout.colors[target.color_key]).toBe("pink");
});
test("compensation follows positive terminal evidence but never guesses incomplete tab membership", () => {
  const doc = emptyBoardDocument();
  applyAppearance(doc, target, { color: "pink", status: "Continuing" });
  const topology = [
    { terminal_id: "terminal-1", pane_id: "pane-2", tab_id: "tab-2" },
  ];
  expect(
    reconciledAppearanceOps(doc, "alpha", topology, new Set()),
  ).toHaveLength(3);
  expect(reconciledAppearanceOps(doc, "beta", topology, new Set())).toEqual([]);
  applyAppearance(
    doc,
    { ...target, witness: ["terminal-1", "terminal-2"] },
    {},
  );
  expect(reconciledAppearanceOps(doc, "alpha", topology, new Set())).toEqual(
    [],
  );
});
