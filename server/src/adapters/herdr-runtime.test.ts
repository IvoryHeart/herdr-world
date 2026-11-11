import { expect, test } from "bun:test";
import { createHerdrRuntimePorts, createTuiPassThrough } from "./herdr-runtime";
import { readRuntimeSnapshot } from "./runtime-ports";

function fixture() {
  const calls: unknown[][] = [];
  const bridge = {
    async handleTerminalRpc(...args: unknown[]) {
      calls.push(args);
      return { ok: true };
    },
    cleanupWs(viewer: object) {
      calls.push(["closeViewer", viewer]);
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const client = {
    async call(...args: unknown[]) {
      calls.push(args);
      return { native: true };
    },
  };
  return {
    calls,
    bridge,
    client,
    ports: createHerdrRuntimePorts({ client, terminalBridge: () => bridge }),
  };
}

test("typed reads and session writes retain TUI arguments and send controls", async () => {
  const { calls, ports } = fixture();
  const beforeSend = () => {};
  const signal = new AbortController().signal;
  const options = { timeoutMs: 1234, beforeSend, signal };
  expect(
    await ports.operations.getTerminal({ pane_id: "p-example" }, options),
  ).toEqual({ native: true });
  await ports.sessions.reportMetadata(
    {
      pane_id: "p-example",
      source: "world-test",
      tokens: { step: "testing" },
      ttl_ms: 100,
    },
    options,
  );
  await ports.resources.listWorktrees({ workspace_id: "w-example" });
  expect(calls).toEqual([
    ["pane.get", { pane_id: "p-example" }, 1234, beforeSend, signal],
    [
      "pane.report_metadata",
      {
        pane_id: "p-example",
        source: "world-test",
        tokens: { step: "testing" },
        ttl_ms: 100,
      },
      1234,
      beforeSend,
      signal,
    ],
    ["worktree.list", { workspace_id: "w-example" }],
  ]);
});

test("terminal attachments keep viewer identity and current-generation guard", async () => {
  const { ports, calls } = fixture();
  const viewer = {};
  const current = () => false;
  await ports.terminals.dispatch(
    viewer,
    "request",
    "input",
    { text: "hello" },
    current,
  );
  ports.terminals.closeViewer(viewer);
  ports.terminals.dispose();
  expect(calls).toEqual([
    [viewer, "request", "terminal.input", { text: "hello" }, current],
    ["closeViewer", viewer],
    ["dispose"],
  ]);
});

test("snapshot waits for all typed reads and tolerates only missing agents", async () => {
  const pending = Promise.withResolvers<{ panes: [] }>();
  const { ports } = fixture();
  ports.operations.listWorkspaces = async () => ({ workspaces: [] });
  ports.operations.listTabs = async () => ({ tabs: [] });
  ports.operations.listTerminals = () => pending.promise;
  ports.operations.listAgents = async () => {
    throw new Error("optional");
  };
  const reading = readRuntimeSnapshot(ports.operations);
  pending.resolve({ panes: [] });
  expect(await reading).toEqual([
    { workspaces: [] },
    { tabs: [] },
    { panes: [] },
    null,
  ]);
});

test("raw pass-through is explicitly restricted to TUI runtimes", async () => {
  const { client, calls } = fixture();
  expect(() => createTuiPassThrough("core", client)).toThrow("TUI-only");
  await createTuiPassThrough("herdr", client).call("integration.list", {});
  expect(calls).toEqual([["integration.list", {}]]);
});

test("session producers translate session identity and never replay uncertain writes", async () => {
  const { ports, calls } = fixture();
  await ports.sessions.reportSession({
    pane_id: "seat",
    source: "herdr:codex",
    agent: "codex",
    sessionId: "session-example",
  });
  expect(calls[0]).toEqual([
    "pane.report_agent_session",
    {
      pane_id: "seat",
      source: "herdr:codex",
      agent: "codex",
      agent_session_id: "session-example",
    },
  ]);
  let attempts = 0;
  const uncertain = createHerdrRuntimePorts({
    client: {
      async call() {
        attempts++;
        throw new Error("reply lost after send");
      },
    },
    terminalBridge: () => fixture().bridge,
  });
  await expect(
    uncertain.sessions.reportMetadata({
      pane_id: "seat",
      source: "test",
      tokens: {},
    }),
  ).rejects.toThrow("reply lost after send");
  expect(attempts).toBe(1);
});
