import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { expect, test } from "bun:test";
import { WorldSnapshotService } from "./snapshot";
import type { ConnectionStatus } from "../connections/types";
import type { Scheduler } from "../service/clock";

function fixture(scheduler?: Scheduler) {
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
    ...herdrRuntimeFixture({
      call: async (method: string) => raw[method as keyof typeof raw],
    }),
  };
  const registry = {
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
    readyRuntimeLease: (connectionId: string) => {
      leases++;
      return { connectionId, generation, runtime, isCurrent: () => true };
    },
  };
  const service = new WorldSnapshotService(
    registry,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    scheduler,
  );
  return {
    service,
    leases: () => leases,
    replace: () => {
      generation++;
    },
  };
}

test("a snapshot yields a task turn without depending on manually advanced time", async () => {
  const delays: number[] = [];
  const { service } = fixture({
    schedule(_callback, delayMs) {
      delays.push(delayMs);
      // A stopped scheduler deliberately never calls its callbacks.
      if (delayMs === 0)
        throw new Error("a task turn must not await fixture time");
      return { cancel() {} };
    },
  });
  const snapshot = await service.snapshot();
  expect(snapshot.connections[0]!.actionable).toBe(true);
  expect(delays).toEqual([20_000]);
});

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
