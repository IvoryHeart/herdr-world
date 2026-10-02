import { describe, expect, test } from "bun:test";
import { WorldSnapshotService } from "../../../server/src/world/snapshot";
import { parseWorldSnapshotResult, WorldRuntimeStore } from "./runtimeStore";

function admittedRevision(runtime: WorldRuntimeStore, revision: number) {
  if (runtime.get().revision === revision) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("aggregate admission deadline"));
    }, 2000);
    const off = runtime.subscribe(() => {
      if (runtime.get().revision !== revision) return;
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

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
          coverage: {
            workspaces: 1,
            tabs: 0,
            panes: 0,
            agent_panes: 0,
            status: {
              working: 0,
              idle: 0,
              blocked: 0,
              done: 0,
              unknown: 0,
            },
            by_workspace: [
              {
                workspace_id: "shared",
                tabs: 0,
                panes: 0,
                agent_panes: 0,
                status: {
                  working: 0,
                  idle: 0,
                  blocked: 0,
                  done: 0,
                  unknown: 0,
                },
              },
            ],
          },
        },
      },
    ],
  };
}

describe("World aggregate runtime store", () => {
  test("retirement during cooperative preparation makes only that owner stale", async () => {
    const response = result("synthetic ownership");
    response.connections.push({
      ...response.connections[0],
      connection_id: "host-b",
    });
    let retired = false;
    const runtime = new WorldRuntimeStore({
      call: async () => response,
      connection: (id) => ({ isCurrent: () => id !== "host-a" || !retired }),
      onControl: () => () => {},
      onStatus: () => () => {},
    });
    const task = setTimeout(() => {
      retired = true;
    }, 0);
    try {
      await runtime.refresh();
      const [alpha, beta] = runtime.get().connections;
      expect(alpha?.stale).toBe(true);
      expect(alpha?.actionable).toBe(false);
      expect(beta?.stale).toBe(false);
      expect(beta?.actionable).toBe(true);
    } finally {
      clearTimeout(task);
      runtime.stop();
    }
  });
  test("a healthy input task can run during aggregate preparation and disconnect retires its unfinished model", async () => {
    let status: ((value: "connected" | "disconnected") => void) | undefined;
    const response = result("synthetic dense preparation");
    response.connections = Array.from({ length: 32 }, (_, index) => ({
      ...response.connections[0],
      connection_id: `synthetic-${index}`,
    }));
    let decodedSibling = false;
    const siblingSnapshot = response.connections[1]!.snapshot;
    Object.defineProperty(response.connections[1]!, "snapshot", {
      get() {
        decodedSibling = true;
        return siblingSnapshot;
      },
    });
    const runtime = new WorldRuntimeStore({
      call: async () => response,
      onControl: () => () => {},
      onStatus: (listener) => {
        status = listener;
        return () => {};
      },
    });
    runtime.start();
    const input = Promise.withResolvers<boolean>();
    const task = setTimeout(() => {
      input.resolve(runtime.get().status === "loading" && !decodedSibling);
      status?.("disconnected");
    }, 0);
    try {
      await runtime.refresh();
      expect(await input.promise).toBe(true);
      expect(runtime.get().status).toBe("error");
      expect(runtime.get().connections).toEqual([]);
    } finally {
      clearTimeout(task);
      runtime.stop();
    }
  });

  test("All hosts admits an open late owner before four stalled catalogue peers on the real scheduler", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `host-${index}`);
    const release = Promise.withResolvers<void>();
    const started: string[] = [];
    const service = new WorldSnapshotService({
      list: () =>
        ids.map((id) => ({
          id,
          label: id,
          source: "test",
          is_default: false,
          state: "ready" as const,
          generation: 1,
        })),
      readyRuntimeLease: (id: string) => ({
        connectionId: id,
        generation: 1,
        isCurrent: () => true,
        runtime: {
          herdr: {
            async call(method: string) {
              if (method === "workspace.list") started.push(id);
              if (id !== "host-11") await release.promise;
              if (method === "workspace.list") return { workspaces: [] };
              if (method === "tab.list") return { tabs: [] };
              if (method === "pane.list") return { panes: [] };
              return { agents: [] };
            },
          },
        },
      }),
    });
    const runtime = new WorldRuntimeStore({
      call: (_method, params) => service.snapshot(params),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    runtime.setVisibleConnectionIds(ids);
    runtime.setPriorities([{ connectionId: "host-11", workspaceId: "shared" }]);
    const pending = runtime.refresh();
    try {
      expect(started).toHaveLength(4);
      expect(started[0]).toBe("host-11");
      expect(started.filter((id) => id !== "host-11")).toHaveLength(3);
    } finally {
      release.resolve();
      await pending;
      runtime.stop();
    }
    expect(
      runtime
        .get()
        .connections.find((connection) => connection.connectionId === "host-11")
        ?.actionable,
    ).toBe(true);
  });
  test("host scheduling retains independently open owners beyond the resource hint bound", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const runtime = new WorldRuntimeStore({
      call: async (_method, params) => {
        calls.push(params);
        return result("observed");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    runtime.setVisibleConnectionIds(["visible", "host-0"]);
    const priorities = Array.from({ length: 16 }, (_, index) => ({
      connectionId: `host-${index}`,
      workspaceId: "shared",
    }));
    await runtime.ensurePriorities(priorities);
    expect(calls[0]?.priorities).toHaveLength(8);
    expect(calls[0]?.priority_connection_ids).toEqual([
      ...priorities.map((priority) => priority.connectionId),
    ]);
  });
  test("All hosts does not promote stalled visible peers into the open owner's scheduling class", async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const runtime = new WorldRuntimeStore({
      call: async (_method, params) => {
        calls.push(params);
        return result("valid");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    runtime.setVisibleConnectionIds(
      Array.from({ length: 12 }, (_, index) => `host-${index}`),
    );
    runtime.setPriorities([{ connectionId: "host-11", workspaceId: "shared" }]);
    await runtime.refresh();
    expect(calls[0]?.priority_connection_ids).toEqual(["host-11"]);
    runtime.stop();
  });
  test("changing an observation hint does not discard an already completed valid aggregate", async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    let requests = 0;
    const runtime = new WorldRuntimeStore({
      call: () => (++requests === 1 ? first.promise : second.promise),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    const pending = runtime.refresh();
    runtime.setSelectedConnectionId("host-a");
    first.resolve(result("valid while priorities changed"));
    try {
      await pending;
      expect(runtime.get().status).toBe("ready");
      expect(runtime.get().connections[0]?.snapshot?.workspaces[0]?.label).toBe(
        "valid while priorities changed",
      );
    } finally {
      runtime.stop();
      second.resolve(result("cleanup"));
    }
  });

  test("open resources on several owners supply deduplicated host scheduling hints over the one World transport", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> =
      [];
    const runtime = new WorldRuntimeStore({
      call: async (method, params) => {
        calls.push({ method, params });
        return result("valid");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    runtime.setPriorities([
      { connectionId: "alpha", workspaceId: "shared", paneId: "pane" },
      { connectionId: "beta", workspaceId: "shared", paneId: "pane" },
      { connectionId: "alpha", workspaceId: "another" },
    ]);
    await runtime.refresh();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("world.snapshot");
    expect(calls[0]?.params?.priority_connection_ids).toEqual([
      "alpha",
      "beta",
    ]);
    expect(calls[0]?.params?.priorities).toHaveLength(3);
    runtime.stop();
  });
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
    const admitted = admittedRevision(runtime, 2);
    resolvers[1](result("newer", 2));
    await admitted;

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

  test("sends qualified priorities with the aggregate refresh", async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> =
      [];
    const runtime = new WorldRuntimeStore({
      call: async (method, params) => {
        calls.push({ method, params });
        return result("observed");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    await runtime.ensurePriorities([
      {
        connectionId: "host-a",
        workspaceId: "workspace-512",
        paneId: "pane-4096",
        terminalId: "terminal-4096",
      },
    ]);

    expect(calls).toEqual([
      {
        method: "world.snapshot",
        params: {
          priority_connection_ids: ["host-a"],
          priorities: [
            {
              connection_id: "host-a",
              workspace_id: "workspace-512",
              pane_id: "pane-4096",
              terminal_id: "terminal-4096",
            },
          ],
        },
      },
    ]);
  });

  test("sends a changed selected-host scheduling hint without discarding a valid aggregate", async () => {
    const calls: Array<{
      params?: Record<string, unknown>;
      resolve(value: unknown): void;
    }> = [];
    const runtime = new WorldRuntimeStore({
      call: (_method, params) =>
        new Promise((resolve) => {
          calls.push({ params, resolve });
        }),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });

    runtime.setSelectedConnectionId("host-a");
    const first = runtime.refresh();
    expect(calls[0].params).toMatchObject({
      selected_connection_id: "host-a",
    });
    expect(calls[0].params).not.toHaveProperty("connection_id");
    runtime.setSelectedConnectionId("host-b");
    calls[0].resolve(result("old selected host", 1));
    await first;
    await Promise.resolve();
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "old selected host",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].params).toMatchObject({
      selected_connection_id: "host-b",
    });
    const admitted = admittedRevision(runtime, 2);
    calls[1].resolve(result("new selected host", 2));
    await admitted;
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "new selected host",
    );
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

    const admitted = admittedRevision(runtime, 2);
    resolvers[1](result("second", 2));
    await admitted;
    expect(runtime.get().connections[0].snapshot?.workspaces[0].label).toBe(
      "second",
    );
  });
});
