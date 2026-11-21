import { expect, test } from "bun:test";
import { agentMoveDestinations } from "./agentMove";
import type { WorldRuntimeConnection } from "./runtimeStore";
const host = {
  connectionId: "core",
  generation: 2,
  snapshotGeneration: 2,
  state: "ready",
  actionable: true,
  stale: false,
  label: "Example",
  runtime: "herdr-core",
  snapshot: { workspaces: [{ workspace_id: "room", label: "Build" }] },
} as WorldRuntimeConnection;
test("move offers current rooms on another runtime, with their captured generations", () => {
  expect(agentMoveDestinations([host], "tui")).toEqual([
    {
      destination: {
        connection_id: "core",
        generation: 2,
        workspace_id: "room",
      },
      label: "Example · herdr-core · Build",
    },
  ]);
});
test.each([
  { stale: true },
  { actionable: false },
  { snapshotGeneration: 1 },
  { state: "error" },
])(
  "stale, partial, nonactionable and disconnected hosts are never destinations %j",
  (patch) => {
    expect(
      agentMoveDestinations(
        [{ ...host, ...patch } as WorldRuntimeConnection],
        "tui",
      ),
    ).toEqual([]);
  },
);
test("the source offers other rooms on its runtime, never its current room", () => {
  expect(agentMoveDestinations([host], "core", "room")).toEqual([]);
  expect(agentMoveDestinations([host], "core", "other")).toHaveLength(1);
});
