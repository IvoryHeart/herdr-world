import { expect, test } from "bun:test";
import { emptyBoardDocument, type BoardOp } from "./board-store";
import { spawnRecordOps } from "./relations";
import type { WorldConnectionSnapshot, WorldSnapshotResult } from "./snapshot";

const connection = (
  overrides: Partial<WorldConnectionSnapshot> = {},
): WorldConnectionSnapshot => ({
  connection_id: "studio",
  label: "Studio",
  source: "local",
  is_default: true,
  state: "ready",
  generation: 2,
  snapshot_generation: 2,
  stale: false,
  actionable: true,
  snapshot: {
    workspaces: [],
    tabs: [],
    panes: [
      { pane_id: "w1:p1", terminal_id: "term_parent" },
      {
        pane_id: "w1:p2",
        terminal_id: "term_child",
        tokens: { spawned_by: "w1:p1" },
      },
    ],
    agents: [],
    coverage: {} as never,
    watch_admission: {} as never,
  },
  ...overrides,
});
const result = (
  ...connections: WorldConnectionSnapshot[]
): WorldSnapshotResult => ({ revision: 1, observed_at: 0, connections });

test("a live snapshot's spawn token becomes a claim qualified by generation", () => {
  expect(spawnRecordOps(emptyBoardDocument(), result(connection()), 9)).toEqual(
    [
      {
        op: "spawn.record",
        claims: [
          {
            child: { connection_id: "studio", terminal_id: "term_child" },
            parent: { connection_id: "studio", terminal_id: "term_parent" },
            source: "herdr:spawned_by",
            generation: 2,
            observed_at: 9,
          },
        ],
      },
    ],
  );
});

test("cached, stale or previous-runtime topology is never recorded", () => {
  const empty = emptyBoardDocument();
  for (const overrides of [
    { stale: true },
    { actionable: false },
    { state: "reconnecting" as const },
    { snapshot_generation: 1 },
  ])
    expect(spawnRecordOps(empty, result(connection(overrides)), 9)).toEqual([]);
});

test("a claim already saved is not written again", () => {
  const document = emptyBoardDocument();
  const [op] = spawnRecordOps(document, result(connection()), 9);
  document.relations.spawns = (
    op as Extract<BoardOp, { op: "spawn.record" }>
  ).claims;
  expect(spawnRecordOps(document, result(connection()), 10)).toEqual([]);
});

test("a complete snapshot drops claims and group members whose terminals closed", () => {
  const document = emptyBoardDocument();
  const gone = (terminal_id: string) => ({
    connection_id: "studio",
    terminal_id,
  });
  document.relations.spawns = [
    {
      child: gone("term_old_child"),
      parent: gone("term_old_parent"),
      source: "herdr:spawned_by",
      generation: 1,
      observed_at: 1,
    },
  ];
  document.relations.groups = [
    {
      id: "g1",
      kind: "team",
      members: [gone("term_parent"), gone("term_old")].map((ref) => ({
        ref,
        roles: [],
        joined_at: 1,
      })),
      created_at: 1,
    },
  ];
  const complete = connection();
  complete.snapshot!.coverage = { panes: 2 } as never;
  const ops = spawnRecordOps(document, result(complete), 9);
  expect(ops[0]).toEqual({
    op: "relations.prune",
    children: [gone("term_old_child")],
    members: [gone("term_old")],
  });
  expect(ops[1]?.op).toBe("spawn.record");
  // A bounded snapshot may leave panes out, so it prunes nothing.
  expect(
    spawnRecordOps(document, result(connection()), 9).map((op) => op.op),
  ).toEqual(["spawn.record"]);
});
