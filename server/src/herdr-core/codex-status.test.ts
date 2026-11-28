import { expect, test } from "bun:test";
import { launchCore } from "./operations";
import { coreWorld } from "./testing/core-world";

test("a shell-launched Codex shows core's real status, including a missing report", async () => {
  const w = await coreWorld();
  try {
    await w.connect();
    const outcome = await launchCore(
      w.lease(),
      {
        workspaceId: "hc:unplaced",
        kind: "codex",
        label: "Review",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async () => "/opt/example/bin/codex",
      },
    );
    expect(outcome.status).toBe("started");
    if (outcome.status !== "started") throw new Error("not started");
    const address = outcome.terminal_id;
    const status = async () => {
      await w.synchronize();
      return (await w.rows()).panes.find((pane) => pane.pane_id === address);
    };
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "unknown",
    });
    w.fake.report(address, { app: "codex", state: "working" });
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "working",
    });
    // Codex's own start: working for a moment, then idle with nothing to
    // review (#1310). Core counts a turn; World shows it ready.
    w.fake.report(address, { app: "codex", state: "idle" });
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "idle",
    });
    // A real turn ends with done and stays done until someone sees it.
    w.fake.report(address, { app: "codex", state: "working" });
    w.fake.report(address, { app: "codex", state: "done" });
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "done",
    });
    w.fake.label(address, { "herdr.seen": "2" });
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "idle",
    });
    w.fake.report(address, null);
    expect(await status()).toMatchObject({
      agent: "codex",
      agent_status: "unknown",
    });
  } finally {
    await w.dispose();
  }
});
