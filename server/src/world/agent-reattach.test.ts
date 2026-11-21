import { WorldLedger } from "./world-ledger";
import { createWorldCli } from "./world-cli";
import { expect, test } from "bun:test";
import { emptyBoardDocument, BoardStore } from "./board-store";
import { reattachAgent } from "./agent-reattach";
import { parseWorldArgs } from "../cli/world";
import type { WorldSnapshotResult } from "./snapshot";
const params = {
  from_connection: "old",
  from_tab: "w1:t1",
  from_terminal: "term-old",
  to_connection: "new",
  to_pane: "t1",
};
function setup() {
  let stored = emptyBoardDocument();
  const board = new BoardStore({
    read: () => stored,
    commit: (next) => {
      stored = next;
    },
  });
  board.patch([
    { op: "card.color", key: "old:w1:t1", color: "teal" },
    { op: "layout.set", pinned: { "old:w1:t1": { x: 120, y: 80 } } },
  ]);
  const host = {
    connection_id: "new",
    generation: 2,
    snapshot_generation: 2,
    actionable: true,
    stale: false,
    snapshot: {
      workspaces: [{ workspace_id: "room" }],
      panes: [
        {
          pane_id: "t1",
          terminal_id: "t1",
          workspace_id: "room",
          tab_id: "tab",
          agent: "codex",
        },
      ],
      tabs: [],
    },
  };
  const snapshot = { connections: [host] } as unknown as WorldSnapshotResult;
  return {
    board,
    host,
    snapshot,
    deps: {
      board,
      snapshot: async () => snapshot,
      publishBoard() {},
      current: () => true,
    },
  };
}
test("CLI exposes explicit old identity and destination flags", () => {
  expect(
    parseWorldArgs("agent", [
      "reattach",
      "--from-connection",
      "old",
      "--from-tab",
      "w1:t1",
      "--from-terminal",
      "term-old",
      "--to-connection",
      "new",
      "--to-pane",
      "t1",
      "--json",
    ]),
  ).toEqual({ command: "agent reattach", params, json: true });
});
test("an already moved agent receives old saved desk choices", async () => {
  const f = setup();
  expect((await reattachAgent(f.deps, params)).status).toBe("reattached");
  expect(f.board.get().layout.colors["new:tab"]).toBe("teal");
  expect(f.board.get().layout.pinned["new:tab"]).toEqual({ x: 120, y: 80 });
});
test("stale targets and a still-running old terminal refuse without writing", async () => {
  const f = setup();
  const before = f.board.get();
  f.host.stale = true;
  await expect(reattachAgent(f.deps, params)).rejects.toThrow("not connected");
  f.host.stale = false;
  f.snapshot.connections.push({
    connection_id: "old",
    actionable: true,
    stale: false,
    snapshot: { panes: [{ terminal_id: "term-old" }] },
  } as never);
  await expect(reattachAgent(f.deps, params)).rejects.toThrow("still running");
  expect(f.board.get()).toEqual(before);
});

test("a generation retired while the metadata waits refuses its transfer", async () => {
  const f = setup();
  const before = f.board.get();
  f.deps.current = () => false;
  await expect(reattachAgent(f.deps, params)).rejects.toThrow("changed before");
  expect(f.board.get()).toEqual(before);
});

test("legacy desk pins and colour can be re-attached without an unavailable terminal ID", async () => {
  const f = setup();
  const legacy: Record<string, unknown> = { ...params };
  delete legacy.from_terminal;
  await reattachAgent(f.deps, legacy);
  expect(f.board.get().layout.colors["new:tab"]).toBe("teal");
});

test("the admitted CLI dispatch retains its guarded dependencies and records re-attach history", async () => {
  const f = setup();
  const ledger = new WorldLedger("/synthetic/agent-reattach-ledger.json", {
    persist: false,
  });
  const cli = createWorldCli({
    board: f.board,
    ledger,
    hosts: () => [],
    defaultConnectionId: () => null,
    snapshot: f.deps.snapshot,
    runtimeCurrent: () => true,
    publishBoard() {},
    publishLedger() {},
  });
  const reply = await cli.handle({ command: "agent reattach", params }, null);
  expect(reply.ok).toBe(true);
  expect(f.board.get().layout.colors["new:tab"]).toBe("teal");
  expect(ledger.get().changes.at(-1)).toMatchObject({
    command: "agent reattach",
    undo: null,
  });
});
