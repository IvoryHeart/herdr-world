import { expect, test } from "bun:test";
import { coreWorld } from "../../herdr-core/testing/core-world";
import { launchCore } from "../../herdr-core/operations";
import { moveRuntime } from "./runtime";
import type { RpcServices } from "../../rpc/context";

test("real core provider prepares a shell in the original tab and preserves it after source ends", async () => {
  const world = await coreWorld();
  try {
    await world.connect();
    const lease = world.lease();
    const started = await launchCore(
      lease,
      { workspaceId: "hc:unplaced", kind: "codex", label: "Builder", text: "" },
      {
        topology: world.topology,
        resolveExecutable: async () => "/opt/example/bin/codex",
      },
    );
    if (!("pane_id" in started)) throw new Error("start failed");
    await world.settle();
    const services = {
      connectionManager: { has: () => false },
      coreControl: {
        manager: world.core.manager,
        topology: world.topology,
        hostRuntime: () => ({ sshHost: () => undefined }),
      },
    } as unknown as RpcServices;
    const runtime = moveRuntime(services, "box", lease.generation);
    const original = await runtime.address(started.pane_id);
    const recovery = await runtime.openShell(
      original.workspace_id,
      "Builder",
      "/work/example",
      original,
    );
    expect(recovery.tab_id).toBe(original.tab_id);
    expect(recovery.terminal_id).not.toBe(original.terminal_id);
    const run = world.fake.calls
      .filter((c) => c.method === "terminal.run")
      .at(-1)!;
    const params = run.params as Record<string, unknown>;
    expect(params.argv).toEqual([]);
    expect(params.no_parent).toBe(true);
    expect(params.no_notify).toBe(true);
    await runtime.close(original);
    expect((await runtime.address(recovery.pane_id)).tab_id).toBe(
      original.tab_id,
    );
    await runtime.favourite(recovery, true);
    await world.settle();
    expect(
      lease.runtime.core.mirror.terminal(recovery.pane_id)?.labels[
        "herdr.pinned"
      ],
    ).toBe("1");
    await runtime.close(recovery);
  } finally {
    await world.dispose();
  }
});

test("a retired core generation cannot prepare or close anything", async () => {
  const world = await coreWorld();
  try {
    await world.connect();
    const lease = world.lease();
    const services = {
      connectionManager: { has: () => false },
      coreControl: {
        manager: world.core.manager,
        topology: world.topology,
        hostRuntime: () => ({ sshHost: () => undefined }),
      },
    } as unknown as RpcServices;
    expect(() => moveRuntime(services, "box", lease.generation + 1)).toThrow(
      "reconnected",
    );
    expect(
      world.fake.calls.filter((c) => c.method === "terminal.run"),
    ).toHaveLength(0);
  } finally {
    await world.dispose();
  }
});
