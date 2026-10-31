import { expect, test } from "bun:test";
import { WorldSnapshotService } from "./snapshot";
import type { ConnectionStatus } from "../connections/types";

function fixture() {
  let generation = 1,
    leases = 0;
  const raw = {
    "workspace.list": {
      workspaces: Array.from({ length: 513 }, (_, i) => ({
        workspace_id: `room-${i}`,
      })),
    },
    "tab.list": { tabs: [] },
    "pane.list": { panes: [] },
    "agent.list": { agents: [] },
  };
  const runtime = {
    herdr: { call: async (method: string) => raw[method as keyof typeof raw] },
  };
  const service = new WorldSnapshotService({
    list: (): ConnectionStatus[] => [
      {
        id: "alpha",
        label: "Alpha",
        source: "saved-profile",
        is_default: true,
        state: "ready",
        generation,
      },
    ],
    readyRuntimeLease: (connectionId) => {
      leases++;
      return { connectionId, generation, runtime, isCurrent: () => true };
    },
  });
  return {
    service,
    leases: () => leases,
    replace: () => {
      generation++;
    },
  };
}

test("real snapshot projections reuse identity and digest only the actual admitted projection", async () => {
  const { service, replace } = fixture();
  const preferred = {
    priorities: [{ connection_id: "alpha", workspace_id: "room-512" }],
  };
  const [ordinary, selected, selectedAgain] = await Promise.all([
    service.snapshot(),
    service.snapshot(preferred),
    service.snapshot(preferred),
  ]);
  expect(selected.connections[0]!.snapshot).toBe(
    selectedAgain.connections[0]!.snapshot,
  );
  const first = service.observation.reply(ordinary);
  const other = service.observation.reply(selected);
  expect(
    other.connections[0]!.snapshot!.workspaces.some(
      (w) => w.workspace_id === "room-512",
    ),
  ).toBe(true);
  expect(
    first.connections[0]!.snapshot!.workspaces.some(
      (w) => w.workspace_id === "room-512",
    ),
  ).toBe(false);
  expect(first.connections[0]!.token).not.toBe(other.connections[0]!.token);
  const cached = await service.snapshot();
  expect(cached.connections[0]!.snapshot).toBe(
    ordinary.connections[0]!.snapshot,
  );
  const oldToken = first.connections[0]!.token;
  replace();
  const replaced = service.observation.reply(await service.snapshot());
  expect(replaced.connections[0]!.token).not.toBe(oldToken);
});

test("malformed base fails before any runtime acquisition", async () => {
  const { service, leases } = fixture();
  await expect(
    service.snapshot({ base: { service_incarnation: "old", hosts: [{}] } }),
  ).rejects.toThrow("invalid World observation base");
  expect(leases()).toBe(0);
});
