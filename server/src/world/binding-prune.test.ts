import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDataPaths } from "../config/data-paths";
import { openStorage, type WorldStorage } from "../service/storage";
import { systemClock, systemScheduler } from "../service/ports";
import {
  pruneGoneAppearance,
  pruneSnapshotAppearance,
  snapshotAppearancePruneOps,
} from "./appearance-prune";
import { pruneGoneInterest } from "./interest-prune";
import { interestKey } from "../../../shared/interest";
import type { WorldSnapshotResult } from "./snapshot";

const roots: string[] = [],
  stores: WorldStorage[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const session = {
  source: "synthetic",
  agent: "fixture",
  kind: "id",
  value: "session-a",
};
const rows = (dimension: "native" | "terminal" | "session") => [
  {
    pane_id: "pane-b",
    terminal_id: "terminal-b",
    ...(dimension === "session" ? { agent_session: session } : {}),
  },
  {
    pane_id: dimension === "native" ? "pane-b" : "pane-c",
    terminal_id: dimension === "terminal" ? "terminal-b" : "terminal-c",
    ...(dimension === "session" ? { agent_session: session } : {}),
  },
];
const snapshot = (panes: unknown[]): WorldSnapshotResult =>
  ({
    connections: [
      {
        connection_id: "studio",
        generation: 1,
        snapshot_generation: 1,
        state: "ready",
        stale: false,
        actionable: true,
        snapshot: {
          panes,
          tabs: [],
          workspaces: [],
          coverage: { panes: panes.length, tabs: 0, workspaces: 0 },
        },
      },
    ],
  }) as unknown as WorldSnapshotResult;
const open = async () => {
  const root = mkdtempSync(join(tmpdir(), "binding-prune-"));
  roots.push(root);
  const store = await openStorage(
    resolveDataPaths({ HERDR_WORLD_DATA_DIR: root }),
    { clock: systemClock, scheduler: systemScheduler },
  );
  stores.push(store);
  store.board().patch([
    {
      op: "appearance.set",
      target: {
        connection_id: "studio",
        kind: "pane",
        native_id: "pane-a",
        witness: ["terminal-a"],
      },
      fields: { avatar: "builder" },
    },
    {
      op: "interest.set",
      key: interestKey("studio", "terminal-a"),
      interest: "muted",
    },
  ]);
  await store.bindings.settled();
  return store;
};
const cases = (
  ["appearance", "interest", "snapshot", "snapshot-recheck"] as const
).flatMap((consumer) =>
  (["native", "terminal", "session"] as const).map(
    (dimension) => [consumer, dimension] as const,
  ),
);
for (const [consumer, dimension] of cases)
  test(`${consumer} refuses destructive pruning from a duplicate ${dimension} identity`, async () => {
    const store = await open(),
      board = store.board(),
      before = board.get(),
      captures = await store.bindings.list();
    const panes = rows(dimension),
      changes: number[] = [];
    const host = {
      call: async () => ({ panes }),
      isCurrent: () => true,
      changed: (revision: number) => changes.push(revision),
    };
    if (consumer === "appearance")
      await pruneGoneAppearance(board, "studio", host);
    else if (consumer === "interest")
      await pruneGoneInterest(board, "studio", host);
    else if (consumer === "snapshot")
      expect(
        snapshotAppearancePruneOps(before, snapshot(panes), () => true),
      ).toEqual([]);
    else
      await pruneSnapshotAppearance(
        board,
        before,
        snapshot([]),
        () => host,
        host.changed,
      );
    expect(changes).toEqual([]);
    expect(board.get()).toEqual(before);
    expect(await store.bindings.list()).toEqual(captures);
  });

test("a complete unambiguous listing still reclaims appearance and interest", async () => {
  const store = await open();
  const host = {
    call: async () => ({
      panes: [{ pane_id: "pane-b", terminal_id: "terminal-b" }],
    }),
    isCurrent: () => true,
    changed: () => {},
  };
  await pruneGoneAppearance(store.board(), "studio", host);
  await pruneGoneInterest(store.board(), "studio", host);
  expect(store.board().get().appearance).toEqual({});
  expect(store.board().get().layout.interest).toEqual({});
  expect(await store.bindings.list()).toEqual([]);
});

test("explicit unknown sessions do not turn distinct terminals into an ambiguous identity", async () => {
  const store = await open();
  const host = {
    call: async () => ({
      panes: [
        {
          pane_id: "pane-b",
          terminal_id: "terminal-b",
          agent_session: { ...session, kind: "unknown", value: "unknown" },
        },
        {
          pane_id: "pane-c",
          terminal_id: "terminal-c",
          agent_session: { ...session, kind: "unknown", value: "unknown" },
        },
      ],
    }),
    isCurrent: () => true,
    changed: () => {},
  };
  await pruneGoneAppearance(store.board(), "studio", host);
  await pruneGoneInterest(store.board(), "studio", host);
  expect(await store.bindings.list()).toEqual([]);
});
