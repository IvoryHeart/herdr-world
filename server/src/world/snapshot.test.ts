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
  test("observes the full view bound and reports exact additional hosts", async () => {
    const statuses = Array.from({ length: 131 }, (_, index) =>
      status(`host-${index}`, "disconnected"),
    );
    const service = new WorldSnapshotService<Runtime>({
      list: () => statuses,
      readyRuntimeLease: () => null,
    });

    const result = await service.snapshot();

    expect(result.connections).toHaveLength(128);
    expect(result.truncated_connections).toBe(true);
    expect(result.omitted_connections).toBe(3);
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
