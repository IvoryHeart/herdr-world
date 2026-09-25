import { describe, expect, test } from "bun:test";
import type { WorldRuntimeConnection } from "./runtimeStore";
import {
  buildWorldObject,
  taskSummarySessionFingerprint,
  worldObjectForConnection,
  worldObjectId,
} from "./worldObject";

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
      world.nodeById.get(
        worldObjectId("remote", "terminal", "shared-terminal"),
      ),
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

  test("projects one selected host without discarding the aggregate", () => {
    const aggregate = buildWorldObject(
      [connection("local"), connection("remote")],
      "remote",
    );

    const visible = worldObjectForConnection(aggregate, "remote");

    expect(aggregate.hosts.map(({ connectionId }) => connectionId)).toEqual([
      "local",
      "remote",
    ]);
    expect(visible.hosts.map(({ connectionId }) => connectionId)).toEqual([
      "remote",
    ]);
    expect(
      visible.nodes.every(({ connectionId }) => connectionId === "remote"),
    ).toBe(true);
    expect(visible.coverage).toEqual(aggregate.hosts[1]?.coverage);
    expect(visible.nodeById.has(aggregate.hosts[0]!.id)).toBe(false);
    expect(worldObjectForConnection(aggregate, "missing").nodes).toEqual([]);
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
      worldObjectId("local", "terminal", "shared-terminal"),
    );
    const remote = world.nodeById.get(
      worldObjectId("remote", "terminal", "shared-terminal"),
    );

    expect(local?.id).not.toBe(remote?.id);
    expect(local?.actionable).toBe(true);
    expect(remote).toMatchObject({ stale: true, actionable: false });
  });

  test("keeps cached topology on its observed snapshot generation", () => {
    const world = buildWorldObject(
      [
        connection("local", {
          state: "reconnecting",
          generation: 5,
          snapshotGeneration: 4,
          stale: true,
          actionable: false,
        }),
      ],
      "local",
    );

    expect(world.hosts[0]?.generation).toBe(5);
    expect(world.spaces[0]?.generation).toBe(4);
    expect(world.leaves[0]?.generation).toBe(4);
  });

  test("keeps terminal-backed identity when agent classification changes", () => {
    const first = buildWorldObject([connection("local")], "local").leaves[0];
    const changed = connection("local");
    if (changed.snapshot) {
      changed.snapshot.panes[0] = {
        ...changed.snapshot.panes[0],
        pane_id: "replacement-pane",
        agent: undefined,
      };
    }
    const second = buildWorldObject([changed], "local").leaves[0];

    expect(first.kind).toBe("agent");
    expect(second.kind).toBe("terminal");
    expect(second.id).toBe(first.id);
    expect(second.nativeId).toBe("replacement-pane");
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
      task_summary: `  ${"a".repeat(159)}😀truncated\u0000  `,
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
    expect(Array.from(agent.taskSummary ?? "")).toHaveLength(160);
    expect(agent.taskSummary?.endsWith("😀")).toBe(true);
    expect(agent.taskSummary).not.toContain("\u0000");
    expect(terminal).not.toHaveProperty("agentLabel");
    expect(terminal).not.toHaveProperty("modelLabel");
    expect(terminal).not.toHaveProperty("taskSummary");
  });

  test("qualifies resource identity by the admitted agent session", () => {
    const first = connection("local");
    const second = connection("local");
    if (!first.snapshot || !second.snapshot) {
      throw new Error("fixture snapshot missing");
    }
    first.snapshot.agents = [
      {
        pane_id: "shared-pane",
        terminal_id: "shared-terminal",
        agent: "codex",
        agent_session: {
          source: "herdr:codex",
          agent: "codex",
          kind: "id",
          value: "session-a",
        },
      },
    ];
    second.snapshot.agents = [
      {
        pane_id: "shared-pane",
        terminal_id: "shared-terminal",
        agent: "codex",
        agent_session: {
          source: "herdr:codex",
          agent: "codex",
          kind: "id",
          value: "session-b",
        },
      },
    ];

    const firstLeaf = buildWorldObject([first], "local").leaves[0];
    const secondLeaf = buildWorldObject([second], "local").leaves[0];

    expect(firstLeaf?.id).toBe(secondLeaf?.id);
    expect(firstLeaf?.agentSessionIdentity).not.toBe(
      secondLeaf?.agentSessionIdentity,
    );
  });

  test("admits a producer token only for the exact current session", () => {
    const source = connection("local");
    if (!source.snapshot) throw new Error("fixture snapshot missing");
    const session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: "session-a",
    };
    const fingerprint = taskSummarySessionFingerprint(session);
    expect(fingerprint).toBe(
      "5e1cd9d951b5d79f43f31e4c8bbe940b94860a3f9695d6a36794e3a4f84e0cc2",
    );
    source.snapshot.panes[0] = {
      ...source.snapshot.panes[0],
      agent_session: session,
      tokens: {
        task_summary: "Reviewing CI",
        task_summary_session: fingerprint,
      },
    } as never;
    source.snapshot.agents = [
      {
        pane_id: "shared-pane",
        terminal_id: "shared-terminal",
        agent: "codex",
        agent_session: session,
      },
    ];

    expect(buildWorldObject([source], "local").leaves[0]?.taskSummary).toBe(
      "Reviewing CI",
    );
  });

  test("hides producer text after session replacement, mismatch, or absence", () => {
    const source = connection("local");
    if (!source.snapshot) throw new Error("fixture snapshot missing");
    const reported = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: "session-a",
    };
    source.snapshot.panes[0] = {
      ...source.snapshot.panes[0],
      agent_session: { ...reported, value: "session-b" },
      tokens: {
        task_summary: "Old report",
        task_summary_session: taskSummarySessionFingerprint(reported),
      },
    } as never;
    source.snapshot.agents = [
      {
        pane_id: "shared-pane",
        terminal_id: "shared-terminal",
        agent: "codex",
        agent_session: { ...reported, value: "session-b" },
      },
    ];

    expect(
      buildWorldObject([source], "local").leaves[0]?.taskSummary,
    ).toBeUndefined();

    source.snapshot.panes[0] = {
      ...source.snapshot.panes[0],
      agent_session: reported,
    } as never;
    source.snapshot.agents[0] = {
      ...source.snapshot.agents[0],
      agent_session: { ...reported, value: "session-b" },
    };
    expect(
      buildWorldObject([source], "local").leaves[0]?.taskSummary,
    ).toBeUndefined();
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
