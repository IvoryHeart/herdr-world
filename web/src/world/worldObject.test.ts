import { describe, expect, test } from "bun:test";
import type { WorldRuntimeConnection } from "./runtimeStore";
import {
  buildWorldObject,
  prepareWorldObject,
  taskSummarySessionFingerprint,
  worldObjectForConnection,
  worldObjectForHosts,
  worldObjectForWatches,
  worldObjectId,
} from "./worldObject";

test("aggregate indexing yields and retires before indexing every dense leaf", async () => {
  const owner = connection("alpha");
  const pane = owner.snapshot!.panes[0]!;
  owner.snapshot!.panes = Array.from({ length: 4096 }, (_, index) => ({
    ...pane,
    pane_id: `pane-${index}`,
    terminal_id: `terminal-${index}`,
  }));
  const slices: { checkpoint: string; count: number }[] = [];
  let current = true;
  expect(
    await prepareWorldObject([owner], () => current, {
      yieldTask: async (checkpoint, count) => {
        if (checkpoint !== "host-batch") slices.push({ checkpoint, count });
        if (checkpoint === "node-batch") current = false;
      },
    }),
  ).toBeNull();
  expect(slices).toEqual([
    { checkpoint: "host", count: 1 },
    { checkpoint: "node-batch", count: 256 },
  ]);
});

test("dense host construction yields and cancels before allocating every leaf", async () => {
  const owner = connection("construction");
  const pane = owner.snapshot!.panes[0]!;
  let constructed = 0;
  owner.snapshot!.panes = Array.from({ length: 4096 }, (_, index) => ({
    ...pane,
    pane_id: `construction-${index}`,
    terminal_id: `construction-terminal-${index}`,
    get agent() {
      constructed += 1;
      return "synthetic";
    },
  }));
  let current = true;
  const batches: number[] = [];
  const prepared = await prepareWorldObject([owner], () => current, {
    yieldTask: async (checkpoint, count) => {
      if (checkpoint === "host-batch") {
        batches.push(count);
        if (constructed > 0) current = false;
      }
    },
  });
  expect(prepared).toBeNull();
  expect(constructed).toBeGreaterThan(0);
  expect(constructed).toBeLessThan(4096);
  expect(batches.length).toBeGreaterThan(0);
  expect(Math.max(...batches)).toBeLessThanOrEqual(256);
  // Cancellation must not publish an incomplete host in the semantic cache.
  expect(buildWorldObject([owner]).leaves).toHaveLength(4096);
});

test("chunked aggregate indexing preserves complete ordered topology and stale hosts", async () => {
  const alpha = connection("alpha");
  const beta = connection("beta", { stale: true, actionable: false });
  const pane = alpha.snapshot!.panes[0]!;
  alpha.snapshot!.panes = Array.from({ length: 1024 }, (_, index) => ({
    ...pane,
    pane_id: `dense-pane-${index}`,
    terminal_id: `dense-terminal-${index}`,
  }));
  const expected = buildWorldObject([beta, alpha]);
  const prepared = await prepareWorldObject([beta, alpha], undefined, {
    yieldTask: async () => {},
  });

  expect(prepared).not.toBeNull();
  expect(prepared!.hosts.map(({ id }) => id)).toEqual(
    expected.hosts.map(({ id }) => id),
  );
  expect(prepared!.spaces.map(({ id }) => id)).toEqual(
    expected.spaces.map(({ id }) => id),
  );
  expect(prepared!.leaves.map(({ id }) => id)).toEqual(
    expected.leaves.map(({ id }) => id),
  );
  expect(prepared!.nodes.map(({ id }) => id)).toEqual(
    expected.nodes.map(({ id }) => id),
  );
  expect(prepared!.coverage).toEqual(expected.coverage);
  expect(prepared).toEqual(expected);
  expect(
    prepared!.hosts.find(({ connectionId }) => connectionId === "beta")?.stale,
  ).toBe(true);
  expect(prepared!.nodeById.size).toBe(expected.nodeById.size);
  for (const node of expected.nodes) {
    expect(prepared!.nodeById.get(node.id)).toBe(
      prepared!.nodes.find((item) => item.id === node.id),
    );
  }
});

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
  test("Pinned only intersects Hosts and recomputes matching coverage instead of reporting unrelated observations", () => {
    const aggregate = buildWorldObject(
      [connection("alpha"), connection("beta")],
      "alpha",
    );
    const filtered = worldObjectForHosts(aggregate, ["beta"]);
    const pinned = worldObjectForWatches(filtered, [
      { connectionId: "alpha", generation: 4, terminalId: "shared-terminal" },
      { connectionId: "beta", generation: 4, terminalId: "shell-terminal" },
    ]);
    expect(pinned.leaves.map((leaf) => leaf.connectionId)).toEqual(["beta"]);
    expect(pinned.coverage).toMatchObject({
      spaces: 1,
      leaves: 1,
      agents: 0,
      shells: 1,
    });
    expect(pinned.hosts[0]!.coverage.leaves).toBe(1);
    expect(pinned.spaces[0]!.coverage.leaves).toBe(1);
    expect(filtered.coverage.agents).toBe(1);
    expect(aggregate.coverage.agents).toBe(2);
  });
  test("current ready hosts admit independent actions without an operational host selection", () => {
    for (const focused of [null, "alpha", "beta"]) {
      const world = buildWorldObject(
        [connection("alpha"), connection("beta")],
        focused,
      );
      expect(world.spaces.map(({ actionable }) => actionable)).toEqual([
        true,
        true,
      ]);
      expect(
        world.leaves.every(
          ({ capabilities }) =>
            capabilities.openTerminal &&
            capabilities.files &&
            capabilities.changes,
        ),
      ).toBe(true);
      expect(new Set(world.leaves.map(({ id }) => id)).size).toBe(4);
    }
  });

  test("aggregate admission rejects only stale or replaced owners while retaining their qualified roots", () => {
    const world = buildWorldObject(
      [
        connection("alpha"),
        connection("beta", { stale: true, actionable: false }),
        connection("gamma", { generation: 5, snapshotGeneration: 4 }),
        connection("offline", {
          state: "disconnected",
          snapshot: null,
          snapshotGeneration: null,
          actionable: false,
        }),
      ],
      null,
    );
    expect(world.hosts).toHaveLength(4);
    expect(
      world.leaves
        .filter(({ actionable }) => actionable)
        .map(({ connectionId }) => connectionId),
    ).toEqual(["alpha", "alpha"]);
    expect(
      world.hosts.find(({ connectionId }) => connectionId === "offline")
        ?.spaces,
    ).toEqual([]);
    expect(
      world.leaves
        .filter(({ connectionId }) => connectionId !== "alpha")
        .every(({ actionable }) => !actionable),
    ).toBe(true);
  });
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
      actionable: true,
      capabilities: {
        activateHost: true,
        openTerminal: true,
        openSpaces: true,
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

  test("derives the checkout session fingerprint from an actionable pane without agent observation", () => {
    const source = connection("local");
    if (!source.snapshot) throw new Error("fixture snapshot missing");
    const session = {
      source: "herdr:codex",
      agent: "codex",
      kind: "id",
      value: "pane-only-session",
    };
    source.snapshot.panes[0] = {
      ...source.snapshot.panes[0],
      agent_session: session,
    } as never;
    source.snapshot.agents = [];

    expect(
      buildWorldObject([source], "local").leaves[0]?.agentSessionFingerprint,
    ).toBe(taskSummarySessionFingerprint(session));
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
