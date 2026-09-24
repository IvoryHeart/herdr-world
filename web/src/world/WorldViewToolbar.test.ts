import { describe, expect, test } from "bun:test";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject, worldObjectForConnection } from "./worldObject";
import { worldSearchMatches } from "./WorldViewToolbar";

function connection(
  connectionId: string,
  label: string,
  taskSummary: string,
): WorldRuntimeConnection {
  return {
    connectionId,
    label,
    source: "saved-profile",
    isDefault: connectionId === "alpha",
    state: "ready",
    generation: 1,
    snapshotGeneration: 1,
    stale: false,
    actionable: true,
    snapshot: {
      workspaces: [
        {
          workspace_id: "studio",
          number: 1,
          label: `${label} Studio`,
          focused: true,
          pane_count: 1,
          tab_count: 1,
          agent_status: "working",
        },
      ],
      tabs: [],
      panes: [
        {
          pane_id: "agent",
          terminal_id: "terminal",
          workspace_id: "studio",
          tab_id: "tab",
          focused: true,
          agent: "codex",
          agent_status: "working",
          task_summary: taskSummary,
          revision: 1,
        },
      ],
      agents: [],
    },
  };
}

describe("shared World search", () => {
  test("searches only the selected-host projection", () => {
    const aggregate = buildWorldObject(
      [
        connection("alpha", "Linux", "Repair billing"),
        connection("beta", "MacBook", "Publish release"),
      ],
      "alpha",
    );
    const visible = worldObjectForConnection(aggregate, "alpha");

    expect(worldSearchMatches(visible, "billing")).toHaveLength(1);
    expect(worldSearchMatches(visible, "release")).toEqual([]);
    expect(worldSearchMatches(visible, "linux").length).toBeGreaterThan(0);
  });
});
