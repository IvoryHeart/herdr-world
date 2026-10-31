import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./board-store";
import { afterHerdrClose } from "./board-closing";
import {
  pruneSnapshotAppearance,
  snapshotAppearancePruneOps,
} from "./appearance-prune";
import { appearanceKey } from "../../../shared/appearance";
import type { WorldSnapshotResult } from "./snapshot";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const tab = {
  connection_id: "alpha",
  kind: "tab" as const,
  native_id: "tab-1",
  witness: ["terminal-1"],
  color_key: "alpha:tab-1",
};
const pane = {
  connection_id: "alpha",
  kind: "pane" as const,
  native_id: "pane-1",
  witness: ["terminal-1"],
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "appearance-prune-"));
  roots.push(root);
  return new BoardStore(join(root, "board.json"));
}
function snapshot(patch: Record<string, unknown> = {}): WorldSnapshotResult {
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
          panes: [],
          tabs: [],
          workspaces: [],
          coverage: { panes: 0, tabs: 0, workspaces: 0 },
        },
        ...patch,
      },
    ],
  } as unknown as WorldSnapshotResult;
}
function seed(board: BoardStore) {
  board.patch([
    { op: "appearance.set", target: tab, fields: { status: "Done" } },
    { op: "appearance.set", target: pane, fields: { avatar: "builder" } },
  ]);
}
test("complete current absence prunes dead records, but partial/stale/retired observations cannot", () => {
  const board = fixture();
  seed(board);
  board.patch([
    {
      op: "appearance.set",
      target: { ...pane, connection_id: "beta" },
      fields: { avatar: "designer" },
    },
  ]);
  board.patch([
    { op: "appearance.set", target: tab, fields: { color: "pink" } },
  ]);
  const before = board.get();
  for (const patch of [
    { stale: true },
    { actionable: false },
    { snapshot_generation: 2 },
    { state: "reconnecting" },
    {
      snapshot: {
        panes: [],
        tabs: [],
        workspaces: [],
        coverage: { panes: 1, tabs: 0, workspaces: 0 },
      },
    },
  ])
    expect(
      snapshotAppearancePruneOps(before, snapshot(patch), () => true),
    ).toEqual([]);
  expect(snapshotAppearancePruneOps(before, snapshot(), () => false)).toEqual(
    [],
  );
  board.patch(snapshotAppearancePruneOps(before, snapshot(), () => true));
  expect(Object.keys(board.get().appearance ?? {})).toEqual([
    appearanceKey({ ...pane, connection_id: "beta" }),
  ]);
  expect(board.get().layout.colors[tab.color_key]).toBeUndefined();
});

test("unknown, malformed and retired close observations retain saved records", async () => {
  const board = fixture();
  seed(board);
  const before = board.get();
  for (const mode of ["unknown", "malformed", "retired"]) {
    let current = true;
    await afterHerdrClose(
      board,
      "alpha",
      "pane.closed",
      {},
      {
        call: async () => {
          if (mode === "unknown") throw new Error("unavailable");
          if (mode === "retired") current = false;
          return {
            panes:
              mode === "malformed" ? [{ pane_id: "missing-terminal" }] : [],
          };
        },
        isCurrent: () => current,
        changed: () => {
          throw new Error("unknown read cannot prune");
        },
      },
    );
    expect(board.get()).toEqual(before);
  }
});
test("a confirmed close drops status-only tabs and avatar-only panes, while moving terminals remain", async () => {
  const board = fixture();
  seed(board);
  await afterHerdrClose(
    board,
    "alpha",
    "tab.closed",
    { data: { tab_id: "tab-1" } },
    {
      call: async () => ({ panes: [] }),
      isCurrent: () => true,
      changed: () => {},
    },
  );
  expect(board.get().appearance).toEqual({});
  seed(board);
  await afterHerdrClose(
    board,
    "alpha",
    "tab.closed",
    { data: { tab_id: "tab-1" } },
    {
      call: async () => ({
        panes: [
          { pane_id: "pane-2", tab_id: "tab-2", terminal_id: "terminal-1" },
        ],
      }),
      isCurrent: () => true,
      changed: () => {},
    },
  );
  expect(Object.keys(board.get().appearance ?? {})).toHaveLength(2);
});
test("a close read cannot prune records saved after its observation admission", async () => {
  const board = fixture();
  seed(board);
  let read = false;
  await afterHerdrClose(
    board,
    "alpha",
    "pane.closed",
    {},
    {
      call: async () => {
        read = true;
        board.patch([
          {
            op: "appearance.set",
            target: {
              ...pane,
              native_id: "pane-new",
              witness: ["terminal-new"],
            },
            fields: { avatar: "designer" },
          },
        ]);
        return { panes: [] };
      },
      isCurrent: () => true,
      changed: () => {},
    },
  );
  expect(read).toBe(true);
  expect(Object.keys(board.get().appearance ?? {})).toHaveLength(3);
});
test("long-lived close churn does not exhaust the bounded appearance store", async () => {
  const board = fixture();
  for (let index = 0; index < 1030; index++) {
    const witness = [`terminal-${index}`];
    board.patch([
      {
        op: "appearance.set",
        target: {
          ...tab,
          native_id: `tab-${index}`,
          color_key: `alpha:tab-${index}`,
          witness,
        },
        fields: { status: "Done" },
      },
      {
        op: "appearance.set",
        target: { ...pane, native_id: `pane-${index}`, witness },
        fields: { avatar: "builder" },
      },
    ]);
    await afterHerdrClose(
      board,
      "alpha",
      "tab.closed",
      { data: { tab_id: `tab-${index}` } },
      {
        call: async () => ({ panes: [] }),
        isCurrent: () => true,
        changed: () => {},
      },
    );
  }
  expect(Object.keys(board.get().appearance ?? {})).toHaveLength(0);
}, 30000);

test("a complete snapshot can reclaim a full legacy store in one bounded operation", () => {
  const board = fixture();
  for (let first = 0; first < 2048; first += 128)
    board.patch(
      Array.from({ length: 128 }, (_, offset) => ({
        op: "appearance.set" as const,
        target: {
          ...pane,
          native_id: `old-pane-${first + offset}`,
          witness: [`old-terminal-${first + offset}`],
        },
        fields: { avatar: "builder" },
      })),
    );
  const ops = snapshotAppearancePruneOps(board.get(), snapshot(), () => true);
  expect(ops).toHaveLength(1);
  board.patch(ops);
  board.patch([
    { op: "appearance.set", target: pane, fields: { avatar: "designer" } },
  ]);
  expect(Object.keys(board.get().appearance ?? {})).toHaveLength(1);
}, 30000);

test("snapshot cleanup coalesces held native reads and releases admission for a later sweep", async () => {
  const board = fixture();
  seed(board);
  const before = board.get();
  const held = Promise.withResolvers<{ panes: unknown[] }>();
  let reads = 0;
  const host = {
    call: async () => {
      reads++;
      return held.promise;
    },
    isCurrent: () => true,
  };
  const first = pruneSnapshotAppearance(
    board,
    before,
    snapshot(),
    () => host,
    () => {},
  );
  await pruneSnapshotAppearance(
    board,
    before,
    snapshot(),
    () => host,
    () => {},
  );
  expect(reads).toBe(1);
  board.patch([
    {
      op: "appearance.set",
      target: { ...pane, native_id: "new-pane", witness: ["new-terminal"] },
      fields: { avatar: "designer" },
    },
  ]);
  held.resolve({ panes: [] });
  await first;
  expect(Object.keys(board.get().appearance ?? {})).toHaveLength(3);
  await pruneSnapshotAppearance(
    board,
    board.get(),
    snapshot(),
    () => host,
    () => {},
  );
  expect(reads).toBe(2);
  expect(board.get().appearance).toEqual({});
});

test("a retiring cleanup host retains its records without blocking a current sibling", async () => {
  const board = fixture();
  seed(board);
  board.patch([
    {
      op: "appearance.set",
      target: { ...pane, connection_id: "beta" },
      fields: { avatar: "designer" },
    },
  ]);
  const result = snapshot();
  result.connections.push({ ...result.connections[0]!, connection_id: "beta" });
  let alphaCurrent = true;
  await pruneSnapshotAppearance(
    board,
    board.get(),
    result,
    (id) => ({
      call: async () => {
        if (id === "beta") alphaCurrent = false;
        return { panes: [] };
      },
      isCurrent: () => id === "beta" || alphaCurrent,
    }),
    () => {},
  );
  expect(
    Object.values(board.get().appearance ?? {}).map(
      (entry) => entry.connection_id,
    ),
  ).toEqual(["alpha", "alpha"]);
});
