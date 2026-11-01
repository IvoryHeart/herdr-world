import { expect, test } from "bun:test";
import { groupSnapshotObservations } from "../server/src/world/group-observations";
import { groupRuntimeObservations } from "../web/src/world/groupObservations";
import type { WorldRuntimeConnection } from "../web/src/world/runtimeStore";

const session = {
  source: "herdr",
  agent: "codex",
  kind: "thread",
  value: "example-session",
};
function observed(): WorldRuntimeConnection {
  return {
    connectionId: "connection-a",
    label: "Example",
    source: "saved-profile",
    isDefault: false,
    state: "ready",
    generation: 4,
    snapshotGeneration: 4,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [
        {
          workspace_id: "workspace-1",
          label: "Workshop",
          number: 1,
          focused: false,
          pane_count: 1,
          tab_count: 1,
          agent_status: "working",
        },
      ],
      tabs: [
        {
          tab_id: "tab-1",
          workspace_id: "workspace-1",
          label: "Review",
          number: 1,
          focused: false,
          pane_count: 1,
          agent_status: "working",
        },
      ],
      panes: [
        {
          pane_id: "pane-1",
          terminal_id: "terminal-1",
          workspace_id: "workspace-1",
          tab_id: "tab-1",
          agent: "codex",
          agent_name: "display-only",
          agent_status: "working",
          agent_session: session,
          focused: false,
          revision: 1,
        },
      ],
      agents: [
        {
          pane_id: "pane-1",
          terminal_id: "terminal-1",
          agent: "codex",
          name: "builder",
          agent_session: session,
        },
      ],
    },
  };
}
function both(connection: WorldRuntimeConnection) {
  const server = groupSnapshotObservations([
    {
      connection_id: connection.connectionId,
      generation: connection.generation,
      snapshot_generation: connection.snapshotGeneration,
      state: connection.state,
      stale: connection.stale,
      actionable: connection.actionable,
      snapshot: connection.snapshot,
    },
  ]);
  const browser = groupRuntimeObservations([connection]);
  expect(browser).toEqual(server);
  return browser[0]!;
}

test("service and browser project the same qualified actual identity and session", () => {
  const result = both(observed());
  expect(result.current).toBe(true);
  expect(result.terminals[0]?.name).toBe("builder");
  expect(result.terminals[0]?.sessionFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(result.desks[0]).toEqual({
    id: "tab-1",
    roomId: "workspace-1",
    label: "Review",
  });
});

test.each([
  { stale: true },
  { actionable: false },
  { snapshotGeneration: 3 },
  { state: "reconnecting" as const },
  { snapshot: null },
])("cached or unleased topology is noncurrent: %j", (patch) => {
  expect(both({ ...observed(), ...patch }).current).toBe(false);
});

test("names never fall back to a display label or harness, or another terminal", () => {
  const owner = observed();
  owner.snapshot!.agents[0]!.terminal_id = "previous-terminal";
  expect(both(owner).terminals[0]?.name).toBeUndefined();
  owner.snapshot!.agents = [];
  expect(both(owner).terminals[0]?.name).toBeUndefined();
});

test("stale session metadata cannot name the replacement occupant", () => {
  const owner = observed();
  owner.snapshot!.agents[0]!.agent_session = {
    ...session,
    value: "old-session",
  };
  const terminal = both(owner).terminals[0]!;
  expect(terminal.name).toBeUndefined();
  expect(terminal.sessionFingerprint).toBeUndefined();
});

test("identity is never shortened to the display-name length", () => {
  const owner = observed();
  const name = "named-agent-".repeat(12);
  owner.snapshot!.agents[0]!.name = name;
  expect(both(owner).terminals[0]?.name).toBe(name);
});

test("conflicting current names on one pane do not pick an occupant", () => {
  const owner = observed();
  owner.snapshot!.agents.push({
    ...owner.snapshot!.agents[0]!,
    name: "another-name",
  });
  expect(both(owner).terminals[0]?.name).toBeUndefined();
});
