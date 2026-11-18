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
    const argv = [
      "/opt/example/bin/codex",
      "-a",
      "never",
      "-s",
      "danger-full-access",
      "-m",
      "example-model",
    ];
    world.fake.foreground(started.pane_id, {
      pid: 101,
      name: "codex",
      cwd: "/work/example",
      argv,
    });
    await world.settle();
    expect(await runtime.foreground(original, "codex")).toEqual({
      group: 101,
      cwd: "/work/example",
      argv,
    });
    // Missing foreground argv must never fall back to the stale terminal launch.
    world.fake.foreground(started.pane_id, {
      pid: 101,
      name: "codex",
      cwd: "/work/example",
    });
    await world.settle();
    expect((await runtime.foreground(original, "codex")).argv).toBeUndefined();
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

test("TUI foreground argv retains custom agents and selects the harness folder", async () => {
  const argv = [
    "claude",
    "--model",
    "sonnet",
    "--permission-mode",
    "auto",
    "--agents",
    '{"reviewer":{"prompt":"Check carefully"}}',
  ];
  let processes: Record<string, unknown>[] = [
    { pid: 10, name: "sh", cwd: "/wrong", argv: ["sh"] },
    { pid: 11, name: "claude", cwd: "/work/example", argv },
  ];
  const services = {
    connectionManager: {
      has: () => true,
      readyRuntimeLease: () => ({
        generation: 1,
        isCurrent: () => true,
        runtime: {
          sshHost: () => undefined,
          tui: {
            call: async (method: string, params: unknown) => {
              expect(method).toBe("pane.process_info");
              expect(params).toEqual({ pane_id: "w1:p1" });
              return {
                process_info: {
                  foreground_process_group_id: 10,
                  foreground_processes: processes,
                },
              };
            },
          },
        },
      }),
    },
  } as unknown as RpcServices;
  const runtime = moveRuntime(services, "example", 1);
  const address = { pane_id: "w1:p1" } as Parameters<
    typeof runtime.foreground
  >[0];
  expect(await runtime.foreground(address, "claude")).toEqual({
    group: 10,
    cwd: "/work/example",
    argv,
  });
  processes = [
    { pid: 11, name: "claude", cwd: "/work/example", cmdline: argv.join(" ") },
  ];
  await expect(runtime.foreground(address, "claude")).rejects.toThrow(
    "launch arguments",
  );
  processes = [
    { pid: 11, cwd: "/work/example", argv },
    { pid: 12, cwd: "/work/example", argv: ["claude", "--model", "other"] },
  ];
  await expect(runtime.foreground(address, "claude")).rejects.toThrow(
    "unambiguous",
  );
  processes[0]!.pid = 10;
  await expect(runtime.foreground(address, "claude")).rejects.toThrow(
    "unambiguous",
  );
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
