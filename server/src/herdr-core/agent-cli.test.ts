import { expect, test } from "bun:test";
import { createAgentCommands } from "../world/agent-commands";
import { WorldSnapshotService } from "../world/snapshot";
import { defaultGuiSettings } from "../config/gui-settings";
import { CORE_AGENT_CAPABILITIES, createCoreHostRuntime } from "./host-runtime";
import { coreWorld } from "./testing/core-world";

test("World agent reads use core's real typed ports and screen-only framed read", async () => {
  const world = await coreWorld();
  try {
    await world.connect();
    const address = world.fake.create({
      name: "builder",
      argv: ["/opt/example/bin/claude"],
      foreground: {
        pid: 4242,
        name: "claude",
        argv: ["claude"],
        cwd: "/tmp/example",
      },
    });
    await world.settle();
    const snapshots = new WorldSnapshotService({
      list: () =>
        world.core.manager
          .list()
          .map((row) => ({ ...row, runtime: "herdr-core" as const })),
      readyRuntimeLease: (id) => world.core.manager.readyRuntimeLease(id),
    });
    const service = createAgentCommands({
      snapshot: () => snapshots.snapshot(),
      capabilities: () => CORE_AGENT_CAPABILITIES,
      lease: (id) => {
        const lease = world.core.manager.readyRuntimeLease(id);
        return (
          lease && {
            ...lease,
            operations: createCoreHostRuntime({
              lease,
              host: null,
              readSettings: async () => defaultGuiSettings(),
            }).operations,
            version: lease.runtime.core.version,
          }
        );
      },
    });
    expect(await service.call("agent ls", {}, () => {})).toMatchObject({
      agents: [{ target: `box/${address}`, address, agent: "claude" }],
    });
    expect(
      await service.call(
        "agent read",
        { target: `box/${address}`, lines: 2 },
        () => {},
      ),
    ).toMatchObject({ text: "$", target: `box/${address}` });
    expect(
      world.fake.calls
        .filter((call) => call.method === "terminal.read")
        .map((call) => call.params),
    ).toEqual([{ terminal: address, lines: 0 }]);
  } finally {
    await world.dispose();
  }
});
