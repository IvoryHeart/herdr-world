import { describe, expect, test } from "bun:test";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject, worldObjectId } from "./worldObject";

function connection(
  connectionId: string,
  options: Partial<WorldRuntimeConnection> = {},
): WorldRuntimeConnection {
  return {
    connectionId,
    label: connectionId,
    source: connectionId === "local" ? "startup-config" : "saved-profile",
    isDefault: connectionId === "local",
    state: "ready",
    generation: 4,
    snapshotGeneration: 4,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [
        {
          workspace_id: "shared-workspace",
          number: 1,
          label: "Space",
          focused: true,
          pane_count: 2,
          tab_count: 1,
          agent_status: "working",
        },
      ],
      tabs: [
        {
          tab_id: "shared-tab",
          workspace_id: "shared-workspace",
          number: 1,
          label: "Tab",
          focused: true,
          pane_count: 2,
          agent_status: "working",
        },
      ],
      panes: [
        {
          pane_id: "shared-pane",
          terminal_id: "shared-terminal",
          workspace_id: "shared-workspace",
          tab_id: "shared-tab",
          focused: true,
          agent: "codex",
          agent_status: "working",
          revision: 1,
        },
        {
          pane_id: "shell-pane",
          terminal_id: "shell-terminal",
          workspace_id: "shared-workspace",
          tab_id: "shared-tab",
          focused: false,
          agent_status: "idle",
          revision: 1,
        },
      ],
      agents: [],
    },
    ...options,
  };
}

describe("WorldObject", () => {
  test("projects deterministic host-space-agent-or-terminal hierarchy", () => {
    const world = buildWorldObject(
      [connection("local"), connection("remote")],
      "local",
    );

    expect(world.hosts).toHaveLength(2);
    expect(world.spaces).toHaveLength(2);
    expect(world.leaves).toHaveLength(4);
    expect(world.leaves.map((leaf) => leaf.kind)).toEqual([
      "agent",
      "terminal",
      "agent",
      "terminal",
    ]);
    expect(
      world.nodeById.get(worldObjectId("remote", "pane", "shared-pane")),
    ).toMatchObject({
      connectionId: "remote",
      nativeId: "shared-pane",
      hostState: "ready-inactive",
      selectedHost: false,
      actionable: false,
      capabilities: {
        activateHost: true,
        openTerminal: false,
        openSpaces: false,
      },
    });
    expect(world.hosts[0]).toMatchObject({
      connectionId: "local",
      hostState: "active",
      selectedHost: true,
      actionable: true,
    });
  });

  test("never aliases colliding native ids and does not admit stale hosts", () => {
    const world = buildWorldObject(
      [
        connection("local"),
        connection("remote", {
          state: "error",
          generation: 5,
          snapshotGeneration: 4,
          stale: true,
          actionable: false,
        }),
      ],
      "local",
    );
    const local = world.nodeById.get(
      worldObjectId("local", "pane", "shared-pane"),
    );
    const remote = world.nodeById.get(
      worldObjectId("remote", "pane", "shared-pane"),
    );

    expect(local?.id).not.toBe(remote?.id);
    expect(local?.actionable).toBe(true);
    expect(remote).toMatchObject({ stale: true, actionable: false });
  });

  test("keeps terminal-backed identity when agent classification changes", () => {
    const first = buildWorldObject([connection("local")], "local").leaves[0];
    const changed = connection("local");
    if (changed.snapshot) {
      changed.snapshot.panes[0] = {
        ...changed.snapshot.panes[0],
        agent: undefined,
      };
    }
    const second = buildWorldObject([changed], "local").leaves[0];

    expect(first.kind).toBe("agent");
    expect(second.kind).toBe("terminal");
    expect(second.id).toBe(first.id);
  });

  test("admits bounded agent, task, state, focus, and tab metadata without inference", () => {
    const source = connection("local");
    if (!source.snapshot) throw new Error("fixture snapshot missing");
    source.snapshot.tabs[0] = {
      ...source.snapshot.tabs[0],
      label: "Implementation",
      number: 4,
    };
    source.snapshot.panes[0] = {
      ...source.snapshot.panes[0],
      focused: true,
      display_agent: "Codex Reviewer",
      model_name: "gpt-test",
      task_summary: `  ${"Reviewing ".repeat(80)}\u0000  `,
      state_labels: {
        working: "Investigating",
        blocked: "Needs input",
        invalid: "not admitted",
      },
    };

    const [agent, terminal] = buildWorldObject([source], "local").leaves;

    expect(agent).toMatchObject({
      agentLabel: "Codex Reviewer",
      modelLabel: "gpt-test",
      focused: true,
      tabLabel: "Implementation",
      tabNumber: 4,
      stateLabels: {
        working: "Investigating",
        blocked: "Needs input",
      },
      capabilities: {
        openTerminal: true,
        openSpaces: true,
        files: true,
        changes: true,
        agentHistory: true,
      },
    });
    expect(agent.taskSummary?.length).toBeLessThanOrEqual(240);
    expect(agent.taskSummary).not.toContain("\u0000");
    expect(terminal).not.toHaveProperty("agentLabel");
    expect(terminal).not.toHaveProperty("modelLabel");
    expect(terminal).not.toHaveProperty("taskSummary");
  });

  test("labels reconnecting and offline retained hosts without making them operational", () => {
    const world = buildWorldObject(
      [
        connection("reconnecting", {
          state: "reconnecting",
          actionable: false,
        }),
        connection("offline", {
          state: "error",
          generation: 5,
          snapshotGeneration: 4,
          stale: true,
          actionable: false,
        }),
      ],
      "reconnecting",
    );

    expect(world.hosts.map(({ hostState }) => hostState)).toEqual([
      "offline-stale",
      "reconnecting",
    ]);
    expect(world.hosts.every(({ actionable }) => !actionable)).toBe(true);
  });
});
