import { expect, test } from "bun:test";
import type { ConnectionStatus } from "../connections/types";
import { WorldSnapshotService } from "./snapshot";

function fixture() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let title = "Working";
  const runtime = {
    herdr: {
      async call(method: string) {
        calls++;
        const results: Record<string, unknown> = {
          "workspace.list": { workspaces: [{ workspace_id: "room" }] },
          "tab.list": { tabs: [{ tab_id: "tab", workspace_id: "room" }] },
          "pane.list": {
            panes: [
              {
                pane_id: "pane",
                workspace_id: "room",
                tab_id: "tab",
                terminal_title: title,
              },
            ],
          },
          "agent.list": { agents: [] },
        };
        await gate;
        return results[method];
      },
    },
  };
  const service = new WorldSnapshotService(
    {
      list: (): ConnectionStatus[] => [
        {
          id: "local",
          label: "Local",
          source: "startup-config",
          is_default: true,
          state: "ready",
          generation: 1,
        },
      ],
      readyRuntimeLease: (connectionId) => ({
        connectionId,
        generation: 1,
        runtime,
        isCurrent: () => true,
      }),
    },
    () => 1,
  );
  return {
    service,
    release,
    calls: () => calls,
    repaint: () => {
      title = "Working ⠴";
    },
  };
}

test("activity during a read stays actionable but forces a follow-up acquisition", async () => {
  const { service, release, calls, repaint } = fixture();
  const pending = service.snapshot();
  expect(calls()).toBe(4);
  repaint();
  expect(service.invalidate("local", "activity")).toBe(1);
  release();
  const first = await pending;
  expect(first.revision).toBe(1);
  expect(first.connections[0]).toMatchObject({
    stale: false,
    actionable: true,
    snapshot: { panes: [{ terminal_title: "Working" }] },
  });
  const refreshed = await service.snapshot();
  expect(calls()).toBe(8);
  expect(refreshed.connections[0]).toMatchObject({
    stale: false,
    actionable: true,
    snapshot: { panes: [{ terminal_title: "Working ⠴" }] },
  });
  await service.snapshot();
  expect(calls()).toBe(8);
});

test("activity dirties an already fresh cache and advances its revision", async () => {
  const { service, release, calls, repaint } = fixture();
  release();
  const first = await service.snapshot();
  repaint();
  service.invalidate("local", "activity");
  const next = await service.snapshot();
  expect(next.revision).toBe(first.revision + 1);
  expect(calls()).toBe(8);
  expect(next.connections[0]).toMatchObject({
    stale: false,
    actionable: true,
    snapshot: { panes: [{ terminal_title: "Working ⠴" }] },
  });
});

test.each([true, false])(
  "a real change still voids the read (activity first: %s)",
  async (activityFirst) => {
    const { service, release } = fixture();
    const pending = service.snapshot();
    if (activityFirst) service.invalidate("local", "activity");
    service.invalidate("local");
    if (!activityFirst) service.invalidate("local", "activity");
    release();
    const result = await pending;
    expect(result.connections[0]).toMatchObject({
      actionable: false,
      snapshot_error: "observation changed during snapshot",
    });
  },
);
