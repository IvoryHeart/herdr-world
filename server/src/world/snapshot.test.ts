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

describe("WorldSnapshotService", () => {
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
