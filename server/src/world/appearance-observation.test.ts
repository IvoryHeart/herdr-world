import { expect, test } from "bun:test";
import {
  legacyAppearanceOps,
  movedAppearanceOps,
} from "./appearance-observation";
import { emptyBoardDocument } from "./board-store";
import { applyAppearance, appearanceFor } from "../../../shared/appearance";
import type { WorldSnapshotResult } from "./snapshot";
const target = {
  connection_id: "alpha",
  kind: "tab" as const,
  native_id: "tab-1",
  witness: ["terminal-1"],
  color_key: "alpha:tab-1",
};
function snapshot(patch: Record<string, unknown> = {}) {
  return {
    connections: [
      {
        connection_id: "alpha",
        generation: 3,
        snapshot_generation: 3,
        state: "ready",
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [{ workspace_id: "space-1" }],
          tabs: [{ tab_id: "tab-1" }],
          panes: [
            { pane_id: "pane-1", tab_id: "tab-1", terminal_id: "terminal-1" },
          ],
          coverage: { panes: 1, tabs: 1, workspaces: 1 },
        },
        ...patch,
      },
    ],
  } as unknown as WorldSnapshotResult;
}
test("legacy colour adoption requires complete current evidence and never rebinds", () => {
  const doc = emptyBoardDocument();
  doc.layout.colors[target.color_key] = "pink";
  expect(legacyAppearanceOps(doc, snapshot(), () => true)).toEqual([
    { op: "appearance.set", target, fields: {} },
  ]);
  for (const patch of [
    { stale: true },
    { snapshot_generation: 2 },
    { actionable: false },
    {
      snapshot: {
        ...snapshot().connections[0]!.snapshot,
        coverage: { panes: 2, tabs: 1, workspaces: 1 },
      },
    },
  ])
    expect(legacyAppearanceOps(doc, snapshot(patch), () => true)).toEqual([]);
  expect(legacyAppearanceOps(doc, snapshot(), () => false)).toEqual([]);
  applyAppearance(doc, target, {});
  expect(legacyAppearanceOps(doc, snapshot(), () => true)).toEqual([]);
  expect(
    appearanceFor(doc.appearance, { ...target, witness: ["replacement"] }),
  ).toBeNull();
});
test("confirmed moves carry tab status and independent pane avatar bindings", () => {
  const doc = emptyBoardDocument();
  applyAppearance(doc, target, { status: "Reviewing", color: "pink" });
  applyAppearance(
    doc,
    {
      connection_id: "alpha",
      kind: "pane",
      native_id: "pane-1",
      witness: ["terminal-1"],
    },
    { avatar: "builder" },
  );
  const ops = movedAppearanceOps(
    doc,
    "alpha",
    "tab-1",
    { tab_id: "tab-2", panes: [{ previous: "pane-1", current: "pane-2" }] },
    new Set(["space-1"]),
  );
  expect(ops).toHaveLength(2);
  expect(ops[0]).toMatchObject({
    op: "appearance.relocate",
    from: target,
    target: { ...target, native_id: "tab-2", color_key: "alpha:tab-2" },
  });
  expect(ops[1]).toMatchObject({
    target: { kind: "pane", native_id: "pane-2", witness: ["terminal-1"] },
  });
  expect(
    movedAppearanceOps(
      doc,
      "beta",
      "tab-1",
      { tab_id: "tab-2", panes: [] },
      new Set(),
    ),
  ).toEqual([]);
});

test("complete continuing observations learn split terminals without adopting replacement occupants", () => {
  const doc = emptyBoardDocument();
  applyAppearance(doc, target, { status: "Shared across split" });
  const result = snapshot();
  result.connections[0]!.snapshot!.panes.push({
    pane_id: "pane-2",
    tab_id: "tab-1",
    terminal_id: "terminal-2",
  });
  result.connections[0]!.snapshot!.coverage.panes = 2;
  const ops = legacyAppearanceOps(doc, result, () => true);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({
    target: { witness: ["terminal-1", "terminal-2"] },
  });
  const replacement = snapshot();
  replacement.connections[0]!.snapshot!.panes[0]!.terminal_id = "replacement";
  expect(legacyAppearanceOps(doc, replacement, () => true)).toEqual([]);
});
