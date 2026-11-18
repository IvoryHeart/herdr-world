import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore, clientBoardOps } from "./board-store";
import { AVATAR_CHOICES, appearanceKey } from "../../../shared/appearance";
import { relationsOf, spawnClaimsToRecord } from "../../../shared/relations";
import type { AgentAddress } from "../../../shared/agentMove";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const from: AgentAddress = {
  connection_id: "tui",
  generation: 1,
  workspace_id: "w1",
  tab_id: "w1:t1",
  pane_id: "w1:p1",
  terminal_id: "term-a",
  color_key: "tui:w1:t1",
};
const to: AgentAddress = {
  connection_id: "core",
  generation: 2,
  workspace_id: "hc:room:main",
  tab_id: "hc:room:main:tab:world-b1",
  pane_id: "t1",
  terminal_id: "t1",
  color_key: "core:hc:room:main:tab:world-b1",
};
const parent = { connection_id: "tui", terminal_id: "term-parent" };
const child = { connection_id: "tui", terminal_id: "term-child" };
function setup() {
  const root = mkdtempSync(join(tmpdir(), "move-details-"));
  roots.push(root);
  const path = join(root, "board.json"),
    store = new BoardStore(path);
  store.patch([
    { op: "layout.set", pinned: { [from.color_key]: { x: 120, y: 80 } } },
    { op: "desk.pin", key: from.color_key, cell: { col: 1, row: 2 } },
    {
      op: "appearance.set",
      target: {
        connection_id: from.connection_id,
        kind: "tab",
        native_id: from.tab_id,
        witness: [from.terminal_id],
        color_key: from.color_key,
      },
      fields: { color: "teal", status: "Reviewing" },
    },
    {
      op: "appearance.set",
      target: {
        connection_id: from.connection_id,
        kind: "pane",
        native_id: from.pane_id,
        witness: [from.terminal_id],
      },
      fields: { avatar: AVATAR_CHOICES[0]!.id },
    },
    {
      op: "note.put",
      note: { id: "note", text: "Review", color: "yellow", x: 1, y: 2 },
    },
    {
      op: "string.put",
      string: {
        id: "link",
        from: { note: "note" },
        to: {
          anchor: {
            connection_id: from.connection_id,
            kind: "pane",
            native_id: from.pane_id,
            witness: [from.terminal_id],
          },
        },
      },
    },
    {
      op: "spawn.record",
      claims: [
        {
          child: from,
          parent,
          source: "herdr:spawned_by",
          generation: 1,
          observed_at: 1,
        },
        {
          child,
          parent: from,
          source: "herdr:spawned_by",
          generation: 1,
          observed_at: 1,
        },
      ],
    },
  ]);
  return { store, path };
}
test("pins, colour, appearance, strings and both directions of parentage survive a persistent runtime move", () => {
  const { store, path } = setup();
  store.patch([{ op: "agent.rehome", from, to }]);
  const saved = new BoardStore(path).get();
  expect(saved.layout.pinned[to.color_key]).toEqual({ x: 120, y: 80 });
  expect(saved.layout.desk_pins[to.color_key]?.cell).toEqual({
    col: 1,
    row: 2,
  });
  expect(saved.layout.colors[to.color_key]).toBe("teal");
  expect(saved.layout.colors[from.color_key]).toBeUndefined();
  expect(
    saved.appearance?.[
      appearanceKey({
        connection_id: to.connection_id,
        kind: "pane",
        native_id: to.pane_id,
      })
    ]?.avatar,
  ).toBe(AVATAR_CHOICES[0]!.id);
  expect(saved.strings[0]?.to).toEqual({
    anchor: {
      connection_id: to.connection_id,
      kind: "pane",
      native_id: to.pane_id,
      witness: [to.terminal_id],
    },
  });
  expect(
    saved.relations.spawns.map((s) => [
      s.child.connection_id,
      s.child.terminal_id,
      s.parent.connection_id,
      s.parent.terminal_id,
    ]),
  ).toEqual([
    ["core", "t1", "tui", "term-parent"],
    ["tui", "term-child", "core", "t1"],
  ]);
});
test("the still-visible old native stamp cannot undo a moved parent", () => {
  const { store } = setup();
  store.patch([{ op: "agent.rehome", from, to }]);
  const saved = store.get().relations;
  const old = {
    child,
    parent: from,
    source: "herdr:spawned_by",
    generation: 1,
    observed_at: 2,
  };
  expect(spawnClaimsToRecord(saved.spawns, [old])).toEqual([]);
  const observations = [
    {
      connection_id: "tui",
      generation: 1,
      current: true,
      panes: [
        { pane_id: "old", terminal_id: from.terminal_id },
        {
          pane_id: "child",
          terminal_id: child.terminal_id,
          tokens: { spawned_by_terminal: from.terminal_id },
        },
      ],
    },
    {
      connection_id: "core",
      generation: 2,
      current: true,
      panes: [{ pane_id: "t1", terminal_id: "t1" }],
    },
  ];
  expect(
    relationsOf(saved, observations).find(
      (r) => r.b.terminal_id === child.terminal_id,
    )?.a,
  ).toEqual({ connection_id: "core", terminal_id: "t1" });
  const newParent = {
    ...old,
    parent: { connection_id: "tui", terminal_id: "new-parent" },
  };
  expect(spawnClaimsToRecord(saved.spawns, [newParent])).toEqual([newParent]);
});
test("ordinary clients cannot claim a move; a reused desk does not donate its choices", () => {
  const { store } = setup();
  expect(() => clientBoardOps([{ op: "agent.rehome", from, to }])).toThrow(
    "unknown operation",
  );
  const before = store.get();
  expect(() =>
    store.patch([
      { op: "agent.rehome", from: { ...from, terminal_id: "replacement" }, to },
    ]),
  ).toThrow("different terminal");
  expect(store.get()).toEqual(before);
});
test("source recovery witnesses retain settings through native absence and compensate in the same tab", () => {
  const { store } = setup();
  const recovery = { ...from, pane_id: "w1:p2", terminal_id: "term-recovery" };
  store.patch([{ op: "agent.rehome", from, to: recovery }]);
  store.patch([{ op: "agent.rehome", from: recovery, to, previous: from }]);
  store.patch([{ op: "agent.rehome", from: to, to: recovery, previous: from }]);
  expect(store.get().layout.colors[from.color_key]).toBe("teal");
  expect(store.get().layout.pinned[from.color_key]).toEqual({ x: 120, y: 80 });
  expect(store.get().relations.spawns[0]?.child.terminal_id).toBe(
    "term-recovery",
  );
});

test("moving one pane copies its shared desk choices and retains the other occupants", () => {
  const { store } = setup();
  store.patch([
    { op: "agent.rehome", from, to, remaining: ["other-terminal"] },
  ]);
  const saved = store.get();
  expect(saved.layout.colors[from.color_key]).toBe("teal");
  expect(saved.layout.colors[to.color_key]).toBe("teal");
  expect(saved.layout.pinned[from.color_key]).toEqual(
    saved.layout.pinned[to.color_key],
  );
  expect(
    saved.appearance?.[
      appearanceKey({
        connection_id: from.connection_id,
        kind: "tab",
        native_id: from.tab_id,
      })
    ]?.witness,
  ).toEqual(["other-terminal"]);
});
