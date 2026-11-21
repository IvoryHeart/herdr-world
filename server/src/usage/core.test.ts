import { expect, test } from "bun:test";
import type { ReadyRuntimeLease } from "../connections/manager";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import { createCoreUsageRuntime } from "./core";
import { usageDigest } from "./host";

test("core numeric adapter binds explicit resume evidence on its exact host and retires with the lease", async () => {
  const abort = new AbortController();
  let current = true;
  const pane = {
    pane_id: "1",
    terminal_id: "1",
    tab_id: "desk",
    workspace_id: "room",
  };
  const lease = {
    generation: 2,
    isCurrent: () => current,
    runtime: {
      signal: abort.signal,
      operations: {
        listAgents: async () => ({
          agents: [{ pane_id: "1", terminal_id: "1", agent: "claude" }],
        }),
        listTerminals: async () => ({ panes: [pane] }),
      },
      core: {
        terminal: () => ({
          argv: ["claude", "--session-id", "synthetic"],
          foreground: null,
        }),
      },
    },
  } as unknown as ReadyRuntimeLease<CoreConnectionRuntime>;
  const hosts: (string | undefined)[] = [];
  const runtime = createCoreUsageRuntime(
    lease,
    "operator@example.test",
    async (_options, host) => {
      hosts.push(host);
      return { rows: [], sources: [], truncated: false };
    },
  );
  try {
    const agents = (await runtime.operations.listAgents()).agents;
    expect(agents[0]).toMatchObject({
      ...pane,
      agent_session: { kind: "id", value: "synthetic" },
    });
    const result = await runtime.usage(agents, Date.now(), () => current);
    expect(result.bindings[0]?.session_key).toBe(
      usageDigest("claude\0synthetic"),
    );
    expect(hosts).toEqual(["operator@example.test"]);
    current = false;
    abort.abort();
    await expect(runtime.operations.listAgents()).rejects.toThrow("retired");
    await expect(
      runtime.usage(agents, Date.now(), () => current),
    ).rejects.toThrow();
  } finally {
    await runtime.usage.close();
  }
});
