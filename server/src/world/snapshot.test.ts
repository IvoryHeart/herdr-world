import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "../connections/types";
import { WorldSnapshotService } from "./snapshot";

type Runtime = {
  herdr: {
    call(method: string): Promise<unknown>;
  };
};

function status(
  id: string,
  state: ConnectionStatus["state"] = "ready",
  generation = 1,
): ConnectionStatus {
  return {
    id,
    label: id.toUpperCase(),
    source: id === "local" ? "startup-config" : "saved-profile",
    is_default: id === "local",
    state,
    generation,
    ...(state === "error" ? { error: { message: "host unavailable" } } : {}),
  };
}

function runtime(label: string): Runtime {
  return {
    herdr: {
      async call(method) {
        if (method === "workspace.list") {
          return {
            workspaces: [
              {
                workspace_id: "shared-workspace",
                label: `${label} workspace`,
              },
            ],
          };
        }
        if (method === "tab.list") {
          return {
            tabs: [
              {
                tab_id: "shared-tab",
                workspace_id: "shared-workspace",
                label: `${label} tab`,
              },
            ],
          };
        }
        if (method === "pane.list") {
          return {
            panes: [
              {
                pane_id: "shared-pane",
                terminal_id: "shared-terminal",
                workspace_id: "shared-workspace",
                tab_id: "shared-tab",
                agent: "codex",
              },
            ],
          };
        }
        if (method === "agent.list") return { agents: [] };
        throw new Error(`unexpected method: ${method}`);
      },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("WorldSnapshotService", () => {
  test("reserves all watched panes and ancestry beyond ordinary bounds", async () => {
    const panes = Array.from({ length: 4_224 }, (_, index) => ({
      pane_id: `pane-${index}`,
      terminal_id: `terminal-${index}`,
      workspace_id: `workspace-${index}`,
      tab_id: `tab-${index}`,
      focused: index < 4_096,
    }));
    const watched = Array.from({ length: 128 }, (_, index) => ({
      connection_id: "local",
      connection_generation: 1,
      terminal_id: `terminal-${4_096 + index}`,
      label: `Late ${index}`,
    }));
    const value: Runtime = {
      herdr: {
        async call(method) {
          if (method === "workspace.list")
            return {
              workspaces: panes.map(({ workspace_id }) => ({ workspace_id })),
            };
          if (method === "tab.list")
            return {
              tabs: panes.map(({ tab_id, workspace_id }) => ({
                tab_id,
                workspace_id,
              })),
            };
          if (method === "pane.list") return { panes };
          return { agents: [] };
        },
      },
    };
    const service = new WorldSnapshotService(
      {
        list: () => [status("local")],
        readyRuntimeLease: () => ({
          connectionId: "local",
          generation: 1,
          runtime: value,
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      undefined,
      () => ({ revision: 7, records: watched }),
    );
    const snapshot = (await service.snapshot()).connections[0]?.snapshot;
    expect(snapshot?.watch_admission).toEqual({
      revision: 7,
      registered: 128,
      missing: 0,
      unresolved: 0,
      matched: 128,
      admitted: 128,
      admission_failed: 0,
    });
    expect(
      snapshot?.panes.filter(
        ({ terminal_id }) => terminal_id === "terminal-4223",
      ),
    ).toHaveLength(1);
    expect(
      snapshot?.workspaces.filter(
        ({ workspace_id }) => workspace_id === "workspace-4223",
      ),
    ).toHaveLength(1);
    expect(
      snapshot?.tabs.filter(({ tab_id }) => tab_id === "tab-4223"),
    ).toHaveLength(1);
  });

  test("classifies one duplicate watched terminal as unresolved once", async () => {
    const value: Runtime = {
      herdr: {
        async call(method) {
          if (method === "workspace.list")
            return { workspaces: [{ workspace_id: "space" }] };
          if (method === "tab.list")
            return { tabs: [{ tab_id: "tab", workspace_id: "space" }] };
          if (method === "pane.list")
            return {
              panes: [
                {
                  pane_id: "a",
                  terminal_id: "duplicate",
                  workspace_id: "space",
                  tab_id: "tab",
                },
                {
                  pane_id: "b",
                  terminal_id: "duplicate",
                  workspace_id: "space",
                  tab_id: "tab",
                },
              ],
            };
          return { agents: [] };
        },
      },
    };
    const service = new WorldSnapshotService(
      {
        list: () => [status("local")],
        readyRuntimeLease: () => ({
          connectionId: "local",
          generation: 1,
          runtime: value,
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      undefined,
      () => ({
        revision: 4,
        records: [
          {
            connection_id: "local",
            connection_generation: 1,
            terminal_id: "duplicate",
            label: "Duplicate",
          },
        ],
      }),
    );
    expect(
      (await service.snapshot()).connections[0]?.snapshot?.watch_admission,
    ).toEqual({
      revision: 4,
      registered: 1,
      missing: 0,
      unresolved: 1,
      matched: 0,
      admitted: 0,
      admission_failed: 0,
    });
  });
  test("validates the selected host before any runtime is used", async () => {
    let leases = 0;
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => {
        leases += 1;
        return null;
      },
    });
    for (const hint of [null, "", 3, "unknown"]) {
      await expect(
        service.snapshot({ selected_connection_id: hint }),
      ).rejects.toThrow("selected World connection");
    }
    expect(leases).toBe(0);
    expect((await service.snapshot()).connections).toHaveLength(1);
    expect(leases).toBe(1);
  });

  test("returns all 64 catalogue entries with the selected host before slow peers", async () => {
    const hostIds = Array.from({ length: 64 }, (_, index) => `host-${index}`);
    const release = deferred<void>();
    const started: string[] = [];
    const runtimes = new Map(
      hostIds.map((id) => {
        const base = runtime(id);
        return [
          id,
          {
            herdr: {
              async call(method: string) {
                if (method === "workspace.list") started.push(id);
                if (id !== "host-63") await release.promise;
                return base.herdr.call(method);
              },
            },
          },
        ] as const;
      }),
    );
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => hostIds.map((id) => status(id)),
        readyRuntimeLease: (id) => ({
          connectionId: id,
          generation: 1,
          runtime: runtimes.get(id)!,
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      20,
    );
    try {
      const result = await service.snapshot({
        selected_connection_id: "host-63",
      });
      expect(result.connections).toHaveLength(64);
      expect(
        result.connections.map(({ connection_id }) => connection_id),
      ).toEqual(hostIds);
      expect(started[0]).toBe("host-63");
      expect(started).toHaveLength(4);
      expect(result.connections[63]).toMatchObject({
        actionable: true,
        stale: false,
        snapshot: { workspaces: [{ label: "host-63 workspace" }] },
      });
      expect(
        result.connections
          .slice(0, 63)
          .every(
            ({ actionable, snapshot }) => !actionable && snapshot === null,
          ),
      ).toBe(true);
      expect(JSON.stringify(result).length).toBeLessThan(40_000);
      const repeated = await service.snapshot({
        selected_connection_id: "host-63",
      });
      expect(repeated.connections[63].actionable).toBe(true);
      expect(started).toHaveLength(4);
      expect(JSON.stringify(repeated).length).toBeLessThan(40_000);
    } finally {
      release.resolve();
    }
  });

  test("keeps a slow selected host and unavailable peers non-actionable without inventing children", async () => {
    const release = deferred<void>();
    const selectedRuntime: Runtime = {
      herdr: {
        async call(method) {
          await release.promise;
          return runtime("Selected").herdr.call(method);
        },
      },
    };
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => [
          status("selected"),
          status("incompatible", "error"),
          status("offline", "disconnected"),
        ],
        readyRuntimeLease: (id) =>
          id === "selected"
            ? {
                connectionId: id,
                generation: 1,
                runtime: selectedRuntime,
                isCurrent: () => true,
              }
            : null,
      },
      Date.now,
      undefined,
      15,
    );
    try {
      const result = await service.snapshot({
        selected_connection_id: "selected",
      });
      expect(result.connections).toHaveLength(3);
      expect(result.connections[0]).toMatchObject({
        state: "ready",
        snapshot: null,
        stale: false,
        actionable: false,
        snapshot_error: "observation deadline exceeded",
      });
      expect(result.connections[1]).toMatchObject({
        state: "error",
        snapshot: null,
        actionable: false,
      });
      expect(result.connections[2]).toMatchObject({
        state: "disconnected",
        snapshot: null,
        actionable: false,
      });
    } finally {
      release.resolve();
    }
  });

  test("admits a reconnected host only after its new generation is ready", async () => {
    let connected = false;
    const value = runtime("Reconnected");
    const service = new WorldSnapshotService<Runtime>({
      list: () => [
        status(
          "remote",
          connected ? "ready" : "reconnecting",
          connected ? 2 : 1,
        ),
      ],
      readyRuntimeLease: () =>
        connected
          ? {
              connectionId: "remote",
              generation: 2,
              runtime: value,
              isCurrent: () => connected,
            }
          : null,
    });
    const unavailable = await service.snapshot({
      selected_connection_id: "remote",
    });
    expect(unavailable.connections[0]).toMatchObject({
      generation: 1,
      snapshot: null,
      actionable: false,
    });
    connected = true;
    const ready = await service.snapshot({ selected_connection_id: "remote" });
    expect(ready.connections[0]).toMatchObject({
      generation: 2,
      snapshot_generation: 2,
      stale: false,
      actionable: true,
      snapshot: { workspaces: [{ label: "Reconnected workspace" }] },
    });
  });

  test("coalesces overlapping requests for one host without multiplying Herdr calls", async () => {
    const release = deferred<void>();
    const base = runtime("Current");
    let calls = 0;
    const value: Runtime = {
      herdr: {
        async call(method) {
          calls += 1;
          await release.promise;
          return base.herdr.call(method);
        },
      },
    };
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: value,
        isCurrent: () => true,
      }),
    });
    const first = service.snapshot();
    const second = service.snapshot();
    expect(calls).toBe(4);
    release.resolve();
    const [left, right] = await Promise.all([first, second]);
    expect(left.connections[0].snapshot).toEqual(right.connections[0].snapshot);
    expect(left.connections[0].actionable).toBe(true);
  });

  test("promotes a newly selected queued host ahead of inactive work", async () => {
    const release = deferred<void>();
    const started: string[] = [];
    const ids = Array.from({ length: 6 }, (_, index) => `host-${index}`);
    const runtimes = new Map(
      ids.map((id) => [
        id,
        {
          herdr: {
            async call(method: string) {
              if (method === "workspace.list") started.push(id);
              if (id !== "host-0" && id !== "host-5") {
                await release.promise;
              }
              return runtime(id).herdr.call(method);
            },
          },
        },
      ]),
    );
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => ids.map((id) => status(id)),
        readyRuntimeLease: (id) => ({
          connectionId: id,
          generation: 1,
          runtime: runtimes.get(id)!,
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      20,
    );
    try {
      const first = await service.snapshot({
        selected_connection_id: "host-0",
      });
      expect(first.connections[0].actionable).toBe(true);
      expect(started).not.toContain("host-5");
      const second = await service.snapshot({
        selected_connection_id: "host-5",
      });
      expect(second.connections[5].actionable).toBe(true);
      expect(started).toContain("host-5");
      expect(started.indexOf("host-5")).toBeLessThan(
        started.indexOf("host-4") < 0 ? Infinity : started.indexOf("host-4"),
      );
    } finally {
      release.resolve();
    }
  });

  test("restores all four slots for an older client after selected work drains", async () => {
    const release = deferred<void>();
    const started: string[] = [];
    let ids = ["selected"];
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => ids.map((id) => status(id)),
        readyRuntimeLease: (id) => ({
          connectionId: id,
          generation: 1,
          runtime: {
            herdr: {
              async call(method) {
                if (method === "workspace.list") started.push(id);
                if (id !== "selected") await release.promise;
                return runtime(id).herdr.call(method);
              },
            },
          },
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      15,
    );
    await service.snapshot({ selected_connection_id: "selected" });
    ids = Array.from({ length: 5 }, (_, index) => `host-${index}`);
    try {
      await service.snapshot();
      expect(started.filter((id) => id !== "selected")).toEqual(
        ids.slice(0, 4),
      );
    } finally {
      release.resolve();
    }
  });

  test("does not reserve a selected slot for a fully cached hinted request", async () => {
    const release = deferred<void>();
    const started: string[] = [];
    let ids = ["selected"];
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => ids.map((id) => status(id)),
        readyRuntimeLease: (id) => ({
          connectionId: id,
          generation: 1,
          runtime: {
            herdr: {
              async call(method) {
                if (id !== "selected" && method === "workspace.list") {
                  started.push(id);
                }
                if (id !== "selected") await release.promise;
                return runtime(id).herdr.call(method);
              },
            },
          },
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      15,
    );
    await service.snapshot();
    await service.snapshot({ selected_connection_id: "selected" });
    ids = [
      "selected",
      ...Array.from({ length: 4 }, (_, index) => `host-${index}`),
    ];
    try {
      await service.snapshot();
      expect(started).toEqual(ids.slice(1));
    } finally {
      release.resolve();
    }
  });

  test("keeps a host slot until its required RPC siblings settle", async () => {
    const release = deferred<void>();
    const started: string[] = [];
    const ids = Array.from({ length: 6 }, (_, index) => `host-${index}`);
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => ids.map((id) => status(id)),
        readyRuntimeLease: (id) => ({
          connectionId: id,
          generation: 1,
          runtime: {
            herdr: {
              async call(method) {
                if (method === "workspace.list") {
                  started.push(id);
                  throw new Error("synthetic workspace failure");
                }
                await release.promise;
                return runtime(id).herdr.call(method);
              },
            },
          },
          isCurrent: () => true,
        }),
      },
      Date.now,
      undefined,
      15,
    );
    try {
      await service.snapshot();
      expect(started).toEqual(ids.slice(0, 4));
    } finally {
      release.resolve();
    }
  });

  test("marks an unfinished cached host stale and invalidates once when new data arrives", async () => {
    const release = deferred<void>();
    let gate: Promise<void> | null = null;
    let label = "Before";
    let calls = 0;
    const invalidated: string[] = [];
    const value: Runtime = {
      herdr: {
        async call(method) {
          calls += 1;
          if (gate) await gate;
          return runtime(label).herdr.call(method);
        },
      },
    };
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => [status("local")],
        readyRuntimeLease: () => ({
          connectionId: "local",
          generation: 1,
          runtime: value,
          isCurrent: () => true,
        }),
      },
      Date.now,
      (id) => invalidated.push(id),
      15,
    );
    await service.snapshot();
    gate = release.promise;
    label = "After";
    service.invalidate("local");
    const partial = await service.snapshot({ selected_connection_id: "local" });
    expect(partial.connections[0]).toMatchObject({
      snapshot_generation: 1,
      stale: true,
      actionable: false,
      snapshot: { workspaces: [{ label: "Before workspace" }] },
    });
    release.resolve();
    for (let attempt = 0; attempt < 20 && invalidated.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(invalidated).toEqual(["local"]);
    gate = deferred<void>().promise;
    const beforeReuse = calls;
    const fresh = await service.snapshot({ selected_connection_id: "local" });
    expect(fresh.connections[0]).toMatchObject({
      stale: false,
      actionable: true,
      snapshot: { workspaces: [{ label: "After workspace" }] },
    });
    expect(invalidated).toEqual(["local"]);
    expect(calls).toBe(beforeReuse);
  });

  test("re-notifies after an invalidated late result with an unchanged digest", async () => {
    const release = deferred<void>();
    let gate: Promise<void> | null = null;
    const invalidated: string[] = [];
    const value: Runtime = {
      herdr: {
        async call(method) {
          if (gate) await gate;
          return runtime("Same").herdr.call(method);
        },
      },
    };
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => [status("local")],
        readyRuntimeLease: () => ({
          connectionId: "local",
          generation: 1,
          runtime: value,
          isCurrent: () => true,
        }),
      },
      Date.now,
      (id) => invalidated.push(id),
      15,
    );
    await service.snapshot();
    gate = release.promise;
    service.invalidate("local");
    await service.snapshot();
    service.invalidate("local");
    const coalesced = service.snapshot();
    release.resolve();
    await coalesced;
    for (let attempt = 0; attempt < 20 && invalidated.length === 0; attempt++) {
      await Bun.sleep(0);
    }
    expect(invalidated).toEqual(["local"]);
  });

  test("re-notifies a pin that invalidates an identical late observation", async () => {
    const release = deferred<void>();
    let gate: Promise<void> | null = null;
    let watchRevision = 0;
    let watched = false;
    const invalidated: string[] = [];
    const value: Runtime = {
      herdr: {
        async call(method) {
          if (gate) await gate;
          return runtime("Same").herdr.call(method);
        },
      },
    };
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => [status("local")],
        readyRuntimeLease: () => ({
          connectionId: "local",
          generation: 1,
          runtime: value,
          isCurrent: () => true,
        }),
      },
      Date.now,
      (id) => invalidated.push(id),
      15,
      () => ({
        revision: watchRevision,
        records: watched
          ? [
              {
                connection_id: "local",
                connection_generation: 1,
                terminal_id: "shared-terminal",
                label: "Synthetic watch",
              },
            ]
          : [],
      }),
    );
    await service.snapshot();
    gate = release.promise;
    service.invalidate("local");
    await service.snapshot();
    watchRevision = 1;
    watched = true;
    service.invalidate("local");
    const coalesced = service.snapshot();
    release.resolve();
    await coalesced;
    for (let attempt = 0; attempt < 20 && invalidated.length === 0; attempt++) {
      await Bun.sleep(0);
    }
    expect(invalidated).toEqual(["local"]);
    const refreshed = await service.snapshot();
    expect(refreshed.connections[0]).toMatchObject({
      actionable: true,
      snapshot: {
        watch_admission: { revision: 1, registered: 1, admitted: 1 },
      },
    });
  });

  test("does not certify a fetch that was invalidated while in flight", async () => {
    const release = deferred<void>();
    let calls = 0;
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: {
          herdr: {
            async call(method) {
              calls += 1;
              if (calls <= 4) await release.promise;
              return runtime("Current").herdr.call(method);
            },
          },
        },
        isCurrent: () => true,
      }),
    });
    const first = service.snapshot();
    service.invalidate("local");
    release.resolve();
    const uncertain = await first;
    expect(uncertain.connections[0]).toMatchObject({
      stale: true,
      actionable: false,
      snapshot_error: "observation changed during snapshot",
    });
    const refreshed = await service.snapshot();
    expect(refreshed.connections[0].actionable).toBe(true);
    expect(calls).toBe(8);
  });

  test("a replaced generation cannot publish its late result over the new host", async () => {
    const release = deferred<void>();
    const oldBase = runtime("Old");
    const oldRuntime: Runtime = {
      herdr: {
        async call(method) {
          await release.promise;
          return oldBase.herdr.call(method);
        },
      },
    };
    const newRuntime = runtime("New");
    let generation = 1;
    const invalidated: string[] = [];
    const service = new WorldSnapshotService<Runtime>(
      {
        list: () => [status("local", "ready", generation)],
        readyRuntimeLease: () => {
          const captured = generation;
          return {
            connectionId: "local",
            generation: captured,
            runtime: captured === 1 ? oldRuntime : newRuntime,
            isCurrent: () => generation === captured,
          };
        },
      },
      Date.now,
      (id) => invalidated.push(id),
      15,
    );
    try {
      const partial = await service.snapshot({
        selected_connection_id: "local",
      });
      expect(partial.connections[0]).toMatchObject({
        actionable: false,
        snapshot: null,
      });
      generation = 2;
      const newer = await service.snapshot({ selected_connection_id: "local" });
      expect(newer.connections[0]).toMatchObject({
        generation: 2,
        snapshot_generation: 2,
        actionable: true,
        snapshot: { workspaces: [{ label: "New workspace" }] },
      });
      release.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invalidated).toEqual([]);
      const after = await service.snapshot();
      expect(after.connections[0].snapshot?.workspaces[0]?.label).toBe(
        "New workspace",
      );
    } finally {
      release.resolve();
    }
  });
  test("rejects malformed priority hints at the bridge boundary", async () => {
    const service = new WorldSnapshotService<Runtime>({
      list: () => [],
      readyRuntimeLease: () => null,
    });

    await expect(
      service.snapshot({
        priorities: [
          {
            connection_id: "local",
            workspace_id: "workspace",
            pane_id: "",
          },
        ],
      }),
    ).rejects.toThrow("invalid World snapshot priority");
  });

  test("preserves a selected inner candidate and exact topology counts at every bound", async () => {
    const workspaces = Array.from({ length: 513 }, (_, index) => ({
      workspace_id: `workspace-${index}`,
      label: `Workspace ${index}`,
      focused: false,
    }));
    const tabs = Array.from({ length: 2_049 }, (_, index) => ({
      tab_id: `tab-${index}`,
      workspace_id: index === 2_048 ? "workspace-512" : "workspace-0",
      focused: false,
    }));
    const panes = Array.from({ length: 4_097 }, (_, index) => ({
      pane_id: `pane-${index}`,
      terminal_id: `terminal-${index}`,
      workspace_id: index === 4_096 ? "workspace-512" : "workspace-0",
      tab_id: index === 4_096 ? "tab-2048" : "tab-0",
      focused: false,
      ...(index % 2 === 0
        ? { agent: "codex", agent_status: "working" }
        : { agent_status: "idle" }),
    }));
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: {
          herdr: {
            async call(method) {
              if (method === "workspace.list") return { workspaces };
              if (method === "tab.list") return { tabs };
              if (method === "pane.list") return { panes };
              if (method === "agent.list") return { agents: [] };
              throw new Error(`unexpected method: ${method}`);
            },
          },
        },
        isCurrent: () => true,
      }),
    });

    const result = await service.snapshot({
      priorities: [
        {
          connection_id: "local",
          workspace_id: "workspace-512",
          pane_id: "pane-4096",
          terminal_id: "terminal-4096",
        },
      ],
    });
    const snapshot = result.connections[0]?.snapshot;

    expect(snapshot?.workspaces).toHaveLength(512);
    expect(snapshot?.tabs).toHaveLength(2_048);
    expect(snapshot?.panes).toHaveLength(4_096);
    expect(snapshot?.workspaces.at(-1)?.workspace_id).toBe("workspace-512");
    expect(snapshot?.tabs.at(-1)?.tab_id).toBe("tab-2048");
    expect(snapshot?.panes.at(-1)?.pane_id).toBe("pane-4096");
    expect(snapshot?.coverage).toMatchObject({
      workspaces: 513,
      tabs: 2_049,
      panes: 4_097,
      agent_panes: 2_049,
      status: { working: 2_049, unknown: 0 },
    });
    expect(
      snapshot?.coverage.by_workspace.find(
        ({ workspace_id }) => workspace_id === "workspace-512",
      ),
    ).toMatchObject({
      tabs: 1,
      panes: 1,
      agent_panes: 1,
      status: { working: 1 },
    });
  });

  test("preserves attention-requiring agents and their parents before topology caps", async () => {
    const workspaces = Array.from({ length: 514 }, (_, index) => ({
      workspace_id: `workspace-${index}`,
      label: `Workspace ${index}`,
      focused: false,
    }));
    const tabs = Array.from({ length: 2_050 }, (_, index) => ({
      tab_id: `tab-${index}`,
      workspace_id:
        index >= 2_048 ? `workspace-${index - 1_536}` : "workspace-0",
      focused: false,
    }));
    const panes = Array.from({ length: 4_098 }, (_, index) => ({
      pane_id: `pane-${index}`,
      terminal_id: `terminal-${index}`,
      workspace_id:
        index >= 4_096 ? `workspace-${index - 3_584}` : "workspace-0",
      tab_id: index >= 4_096 ? `tab-${index - 2_048}` : `tab-${index % 2_048}`,
      focused: false,
      ...(index >= 4_096
        ? {
            agent: "codex",
            agent_status: index === 4_097 ? "blocked" : "idle",
          }
        : {}),
    }));
    const agents = [
      {
        pane_id: "pane-4096",
        terminal_id: "terminal-4096",
        agent: "codex",
        display_agent: "Idle agent",
      },
      {
        pane_id: "pane-4097",
        terminal_id: "terminal-4097",
        agent: "codex",
        display_agent: "Blocked agent",
      },
    ];
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: {
          herdr: {
            async call(method) {
              if (method === "workspace.list") return { workspaces };
              if (method === "tab.list") return { tabs };
              if (method === "pane.list") return { panes };
              if (method === "agent.list") return { agents };
              throw new Error(`unexpected method: ${method}`);
            },
          },
        },
        isCurrent: () => true,
      }),
    });

    const result = await service.snapshot();
    const snapshot = result.connections[0]?.snapshot;

    expect(snapshot?.workspaces).toHaveLength(512);
    expect(snapshot?.tabs).toHaveLength(2_048);
    expect(snapshot?.panes).toHaveLength(4_096);
    expect(
      snapshot?.workspaces.slice(-2).map(({ workspace_id }) => workspace_id),
    ).toEqual(["workspace-512", "workspace-513"]);
    expect(snapshot?.tabs.slice(-2).map(({ tab_id }) => tab_id)).toEqual([
      "tab-2048",
      "tab-2049",
    ]);
    expect(snapshot?.panes.slice(-2).map(({ pane_id }) => pane_id)).toEqual([
      "pane-4096",
      "pane-4097",
    ]);
    expect(snapshot?.agents).toEqual(agents);
    expect(snapshot?.coverage).toMatchObject({
      workspaces: 514,
      tabs: 2_050,
      panes: 4_098,
      agent_panes: 2,
      status: { blocked: 1, idle: 1 },
    });
  });

  test("does not let one dense space consume another presented space's leaf budget", async () => {
    const workspaces = [
      { workspace_id: "workspace-a", label: "Dense workspace" },
      { workspace_id: "workspace-b", label: "Later workspace" },
    ];
    const tabs = [
      { tab_id: "tab-a", workspace_id: "workspace-a" },
      { tab_id: "tab-b", workspace_id: "workspace-b" },
    ];
    const panes = [
      ...Array.from({ length: 4_096 }, (_, index) => ({
        pane_id: `pane-a-${index}`,
        terminal_id: `terminal-a-${index}`,
        workspace_id: "workspace-a",
        tab_id: "tab-a",
        agent: "codex",
        agent_status: "blocked",
      })),
      ...Array.from({ length: 16 }, (_, index) => ({
        pane_id: `pane-b-${index}`,
        terminal_id: `terminal-b-${index}`,
        workspace_id: "workspace-b",
        tab_id: "tab-b",
        agent: "codex",
        agent_status: "blocked",
      })),
    ];
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: {
          herdr: {
            async call(method) {
              if (method === "workspace.list") return { workspaces };
              if (method === "tab.list") return { tabs };
              if (method === "pane.list") return { panes };
              if (method === "agent.list") return { agents: [] };
              throw new Error(`unexpected method: ${method}`);
            },
          },
        },
        isCurrent: () => true,
      }),
    });

    const result = await service.snapshot();
    const snapshot = result.connections[0]?.snapshot;

    expect(snapshot?.panes).toHaveLength(4_096);
    expect(
      snapshot?.panes.filter(
        ({ workspace_id }) => workspace_id === "workspace-b",
      ),
    ).toHaveLength(16);
    expect(snapshot?.coverage.by_workspace).toEqual([
      expect.objectContaining({ workspace_id: "workspace-a", panes: 4_096 }),
      expect.objectContaining({ workspace_id: "workspace-b", panes: 16 }),
    ]);
  });

  test("does not let one dense space consume another presented space's desk budget", async () => {
    const workspaces = [
      { workspace_id: "workspace-a", label: "Dense workspace" },
      { workspace_id: "workspace-b", label: "Later workspace" },
    ];
    const tabs = [
      ...Array.from({ length: 2_048 }, (_, index) => ({
        tab_id: `tab-a-${index}`,
        workspace_id: "workspace-a",
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        tab_id: `tab-b-${index}`,
        workspace_id: "workspace-b",
      })),
    ];
    const panes = tabs.map(({ tab_id, workspace_id }) => ({
      pane_id: `pane-${tab_id}`,
      terminal_id: `terminal-${tab_id}`,
      workspace_id,
      tab_id,
      agent: "codex",
      agent_status: "working",
    }));
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("local")],
      readyRuntimeLease: () => ({
        connectionId: "local",
        generation: 1,
        runtime: {
          herdr: {
            async call(method) {
              if (method === "workspace.list") return { workspaces };
              if (method === "tab.list") return { tabs };
              if (method === "pane.list") return { panes };
              if (method === "agent.list") return { agents: [] };
              throw new Error(`unexpected method: ${method}`);
            },
          },
        },
        isCurrent: () => true,
      }),
    });

    const result = await service.snapshot();
    const snapshot = result.connections[0]?.snapshot;

    expect(snapshot?.tabs).toHaveLength(2_048);
    expect(
      snapshot?.tabs.filter(
        ({ workspace_id }) => workspace_id === "workspace-b",
      ),
    ).toHaveLength(8);
    expect(snapshot?.coverage.by_workspace).toEqual([
      expect.objectContaining({ workspace_id: "workspace-a", tabs: 2_048 }),
      expect.objectContaining({ workspace_id: "workspace-b", tabs: 8 }),
    ]);
  });

  test("does not discard candidates before view-specific projection", async () => {
    const statuses = Array.from({ length: 129 }, (_, index) =>
      status(`host-${index}`),
    );
    const service = new WorldSnapshotService<Runtime>({
      list: () => statuses,
      readyRuntimeLease: (connectionId) => ({
        connectionId,
        generation: 1,
        runtime: runtime(connectionId),
        isCurrent: () => true,
      }),
    });

    const result = await service.snapshot();

    expect(result.connections).toHaveLength(129);
    expect(result.connections[128]?.snapshot).toMatchObject({
      workspaces: [{ label: "host-128 workspace" }],
      panes: [{ terminal_id: "shared-terminal" }],
    });
  });

  test("keeps colliding native identifiers isolated by connection", async () => {
    const statuses = [status("local"), status("remote")];
    const runtimes = new Map([
      ["local", runtime("Local")],
      ["remote", runtime("Remote")],
    ]);
    const service = new WorldSnapshotService<Runtime>({
      list: () => statuses,
      readyRuntimeLease: (connectionId) => {
        const value = runtimes.get(connectionId);
        return value
          ? {
              connectionId,
              generation: 1,
              runtime: value,
              isCurrent: () => true,
            }
          : null;
      },
    });

    const result = await service.snapshot();

    expect(result.connections).toHaveLength(2);
    expect(
      result.connections.map((connection) => [
        connection.connection_id,
        connection.snapshot?.panes[0]?.pane_id,
        connection.snapshot?.workspaces[0]?.label,
      ]),
    ).toEqual([
      ["local", "shared-pane", "Local workspace"],
      ["remote", "shared-pane", "Remote workspace"],
    ]);
    expect(
      result.connections.every((connection) => connection.actionable),
    ).toBe(true);
  });

  test("retains a failed host as stale without admitting control", async () => {
    let statuses = [status("local"), status("remote")];
    const runtimes = new Map([
      ["local", runtime("Local")],
      ["remote", runtime("Remote")],
    ]);
    const service = new WorldSnapshotService<Runtime>({
      list: () => statuses,
      readyRuntimeLease: (connectionId) => {
        const value = runtimes.get(connectionId);
        return value
          ? {
              connectionId,
              generation: 1,
              runtime: value,
              isCurrent: () => true,
            }
          : null;
      },
    });
    await service.snapshot();
    statuses = [status("local"), status("remote", "error", 2)];
    runtimes.delete("remote");

    const result = await service.snapshot();
    const remote = result.connections.find(
      (connection) => connection.connection_id === "remote",
    );

    expect(remote).toMatchObject({
      state: "error",
      generation: 2,
      snapshot_generation: 1,
      stale: true,
      actionable: false,
      error: { message: "host unavailable" },
    });
    expect(remote?.snapshot?.workspaces[0]?.label).toBe("Remote workspace");
  });

  test("drops a snapshot fetched from a retired generation", async () => {
    let current = true;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heldRuntime = runtime("Retired");
    const originalCall = heldRuntime.herdr.call;
    heldRuntime.herdr.call = async (method) => {
      await held;
      return originalCall(method);
    };
    const service = new WorldSnapshotService<Runtime>({
      list: () => [status("remote")],
      readyRuntimeLease: () => ({
        connectionId: "remote",
        generation: 1,
        runtime: heldRuntime,
        isCurrent: () => current,
      }),
    });

    const pending = service.snapshot();
    current = false;
    release();
    const result = await pending;

    expect(result.connections[0]).toMatchObject({
      connection_id: "remote",
      stale: false,
      actionable: false,
      snapshot: null,
      snapshot_error: "connection changed during snapshot",
    });
  });
});
