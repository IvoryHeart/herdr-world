import { describe, expect, test } from "bun:test";
import { parseWorldSnapshotResult, WorldRuntimeStore } from "./runtimeStore";

function result(label: string, generation = 1) {
  return {
    revision: generation,
    observed_at: 100 + generation,
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

  test("retains every aggregate candidate for view-specific projection", () => {
    const template = result("valid").connections[0];
    const parsed = parseWorldSnapshotResult({
      ...result("valid"),
      connections: Array.from({ length: 129 }, (_, index) => ({
        ...template,
        connection_id: `host-${index}`,
      })),
    });

    expect(parsed?.connections).toHaveLength(129);
    expect(parsed?.connections[128]?.connectionId).toBe("host-128");
  });

  test("a delayed response from before disconnect cannot replace a newer aggregate", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    let statusListener: (
      status: "connecting" | "connected" | "disconnected",
    ) => void = () => {
      throw new Error("status listener was not registered");
    };
    const runtime = new WorldRuntimeStore({
      call: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onControl: () => () => undefined,
      onStatus: (listener) => {
        statusListener = listener;
        return () => undefined;
      },
    });

    runtime.start();
    const older = runtime.refresh();
    statusListener("disconnected");
    statusListener("connected");
    resolvers[0](result("older", 1));
    await older;
    await Promise.resolve();
    resolvers[1](result("newer", 2));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (runtime.get().revision === 2) break;
      await Promise.resolve();
    }

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

  test("makes retained observations stale and non-actionable on disconnect", async () => {
    let statusListener: (
      status: "connecting" | "connected" | "disconnected",
    ) => void = () => {
      throw new Error("status listener was not registered");
    };
    const runtime = new WorldRuntimeStore({
      call: async () => result("observed"),
      onControl: () => () => undefined,
      onStatus: (listener) => {
        statusListener = listener;
        return () => undefined;
      },
    });

    await runtime.refresh();
    runtime.start();
    statusListener("disconnected");

    expect(runtime.get().status).toBe("error");
    expect(runtime.get().connections[0]).toMatchObject({
      stale: true,
      actionable: false,
    });
  });

  test("makes retained observations stale when refresh fails", async () => {
    let shouldFail = false;
    const runtime = new WorldRuntimeStore({
      call: async () => {
        if (shouldFail) throw new Error("observation failed");
        return result("observed");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    await runtime.refresh();
    shouldFail = true;
    await runtime.refresh();

    expect(runtime.get().error).toBe("observation failed");
    expect(runtime.get().connections[0]).toMatchObject({
      stale: true,
      actionable: false,
    });
  });

  test("admits an in-flight snapshot before servicing one queued refresh", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const runtime = new WorldRuntimeStore({
      call: () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    const first = runtime.refresh();
    void runtime.refresh();
    void runtime.refresh();
    expect(resolvers).toHaveLength(1);

    resolvers[0](result("first", 1));
    await first;
    await Promise.resolve();
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "first",
    );
    expect(resolvers).toHaveLength(2);

    resolvers[1](result("second", 2));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (runtime.get().revision === 2) break;
      await Promise.resolve();
    }
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "second",
    );
  });
});
