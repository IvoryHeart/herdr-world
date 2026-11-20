import { expect, test } from "bun:test";
import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import type { WorldHost } from "../../../shared/hosts";
import type { ConnectionStatus } from "../connections/types";
import { WorldSnapshotService } from "./snapshot";
import { HostConnectionService } from "../connections/host-service";
import { groupHostSnapshots } from "./host-snapshots";
import type { WorldConnectionSnapshot } from "./snapshot";

test("one host retains independently actionable and stale runtime observations", async () => {
  let coreUp = true;
  let generation = 1;
  const status = (id: string): ConnectionStatus => ({
    id,
    label: id,
    source: "test",
    is_default: id === "tui-old",
    state: id === "core-old" && !coreUp ? "error" : "ready",
    generation: id === "core-old" ? generation : 1,
  });
  const catalogue = (): WorldHost[] => [
    {
      host_id: "host-local",
      label: "This computer",
      type: "local",
      auto_connect: true,
      connection_ids: ["tui-old", "core-old"],
      discovery: "complete",
      state: coreUp ? "ready" : "degraded",
      installable_runtimes: [],
      runtimes: ["tui-old", "core-old"].map((id) => ({
        connection_id: id,
        kind: id === "core-old" ? "herdr-core" : "herdr",
        version: "1.2.3",
        installed: true,
        state: status(id).state,
        generation: status(id).generation,
      })),
    },
  ];
  const native = herdrRuntimeFixture({
    async call(method: string) {
      if (method === "workspace.list")
        return {
          workspaces: [{ workspace_id: "same-room", label: "Example room" }],
        };
      if (method === "tab.list") return { tabs: [] };
      if (method === "pane.list") return { panes: [] };
      if (method === "agent.list") return { agents: [] };
      throw new Error("unexpected read");
    },
  });
  const service = new WorldSnapshotService({
    list: () => [
      status("tui-old"),
      { ...status("core-old"), runtime: "herdr-core" as const },
    ],
    hosts: catalogue,
    readyRuntimeLease: (id) => {
      if (id === "core-old" && !coreUp) return null;
      const captured = status(id).generation;
      return {
        connectionId: id,
        generation: captured,
        runtime: native,
        isCurrent: () =>
          status(id).state === "ready" && status(id).generation === captured,
      };
    },
  });
  const initial = await service.snapshot();
  expect(initial.hosts).toHaveLength(1);
  expect(
    initial.hosts![0]!.runtimes.every(
      (runtime) => runtime.actionable && !runtime.stale,
    ),
  ).toBeTrue();
  const cached = initial.connections.find(
    (connection) => connection.connection_id === "core-old",
  )!.snapshot;
  coreUp = false;
  generation++;
  service.invalidate("core-old");
  const degraded = await service.snapshot();
  expect(degraded.hosts![0]).toMatchObject({
    state: "degraded",
    connection_ids: ["tui-old", "core-old"],
  });
  expect(degraded.hosts![0]!.runtimes).toEqual([
    expect.objectContaining({
      connection_id: "tui-old",
      actionable: true,
      stale: false,
      generation: 1,
    }),
    expect.objectContaining({
      connection_id: "core-old",
      actionable: false,
      stale: true,
      generation: 2,
      snapshot_generation: 1,
    }),
  ]);
  expect(
    degraded.connections.find(
      (connection) => connection.connection_id === "core-old",
    )!.snapshot,
  ).toBe(cached);
  expect(
    degraded.connections.map((connection) => connection.connection_id),
  ).toEqual(["tui-old", "core-old"]);
});

test("all sixteen two-runtime lifecycle combinations preserve per-runtime observation authority", () => {
  const states = ["ready", "error", "disconnected", "absent"] as const;
  let cases = 0;
  for (const left of states)
    for (const right of states) {
      const ids = ["runtime-a", "runtime-b"];
      const lifecycle = [left, right];
      const status = (id: string): ConnectionStatus => ({
        id,
        label: id,
        source: "test",
        generation: 2,
        is_default: id === ids[0],
        state:
          lifecycle[ids.indexOf(id)] === "absent"
            ? "disconnected"
            : (lifecycle[ids.indexOf(id)] as ConnectionStatus["state"]),
      });
      const service = new HostConnectionService({
        profiles: () =>
          ids.map((id) => ({
            id,
            label: id,
            type: "local",
            auto_connect: true,
            control_socket_path: `/synthetic/${id}.sock`,
            client_socket_path: `/synthetic/${id}-client.sock`,
          })),
        saved: () => [
          {
            id: "host-local",
            label: "This computer",
            type: "local",
            auto_connect: true,
            discovered: ids.map((id, index) => ({
              connection_id: id,
              version: null,
              present: lifecycle[index] !== "absent",
            })),
          },
        ],
        defaultId: () => ids[0]!,
        status,
        mutate: (operation) => operation(),
        persist: async () => {},
        start: async () => {},
        stop: async () => {},
      });
      const connections: WorldConnectionSnapshot[] = ids.map((id, index) => ({
        connection_id: id,
        label: id,
        source: "test",
        is_default: index === 0,
        state: status(id).state,
        generation: 2,
        snapshot_generation: lifecycle[index] === "ready" ? 2 : 1,
        stale: lifecycle[index] !== "ready",
        actionable: lifecycle[index] === "ready",
        snapshot: null,
      }));
      const [host] = groupHostSnapshots(service.list(), connections);
      expect(host!.connection_ids).toEqual(ids);
      expect(host!.runtimes.map((runtime) => runtime.actionable)).toEqual([
        left === "ready",
        right === "ready",
      ]);
      expect(host!.runtimes.map((runtime) => runtime.stale)).toEqual([
        left !== "ready",
        right !== "ready",
      ]);
      if (left === "ready" || right === "ready")
        expect(host!.state).toBe(
          left === "ready" && right === "ready" ? "ready" : "degraded",
        );
      if (left === "absent" && right === "absent")
        expect(host!.state).toBe("empty");
      cases++;
    }
  expect(cases).toBe(16);
});
