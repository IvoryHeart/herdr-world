import { describe, expect, test } from "bun:test";
import { parseWorldSnapshotResult, WorldRuntimeStore } from "./runtimeStore";

function result(label: string, generation = 1) {
  return {
    revision: generation,
    observed_at: 100 + generation,
    truncated_connections: false,
    connections: [
      {
        connection_id: "host-a",
        label: "Host A",
        source: "saved-profile",
        is_default: false,
        state: "ready",
        generation,
        snapshot_generation: generation,
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [
            {
              workspace_id: "shared",
              number: 1,
              label,
              focused: true,
              pane_count: 1,
              tab_count: 1,
              agent_status: "idle",
            },
          ],
          tabs: [],
          panes: [],
          agents: [],
        },
      },
    ],
  };
}

describe("World aggregate runtime store", () => {
  test("parses a bounded qualified snapshot and rejects malformed entries", () => {
    const parsed = parseWorldSnapshotResult({
      ...result("valid"),
      connections: [
        ...result("valid").connections,
        { connection_id: "missing-everything-else" },
      ],
    });

    expect(parsed?.connections).toHaveLength(1);
    expect(parsed?.connections[0]).toMatchObject({
      connectionId: "host-a",
      generation: 1,
      snapshotGeneration: 1,
      actionable: true,
    });
    expect(parsed?.connections[0].snapshot?.workspaces[0].label).toBe("valid");
  });

  test("a delayed older request cannot replace a newer aggregate", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const runtime = new WorldRuntimeStore({
      call: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    const older = runtime.refresh();
    const newer = runtime.refresh();
    resolvers[1](result("newer", 2));
    await newer;
    resolvers[0](result("older", 1));
    await older;

    expect(runtime.get().connections[0].generation).toBe(2);
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "newer",
    );
  });

  test("keeps duplicate native ids separate by owning connection", async () => {
    const payload = result("Host A");
    payload.connections.push({
      ...payload.connections[0],
      connection_id: "host-b",
      label: "Host B",
      snapshot: {
        ...payload.connections[0].snapshot,
        workspaces: [
          {
            ...payload.connections[0].snapshot.workspaces[0],
            label: "Host B",
          },
        ],
      },
    });
    const runtime = new WorldRuntimeStore({
      call: async () => payload,
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    await runtime.refresh();

    expect(
      runtime
        .get()
        .connections.map((connection) => [
          connection.connectionId,
          connection.snapshot?.workspaces[0].workspace_id,
        ]),
    ).toEqual([
      ["host-a", "shared"],
      ["host-b", "shared"],
    ]);
  });
});
