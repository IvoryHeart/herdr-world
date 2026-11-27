import { parseWorldSnapshotResult } from "./runtimeStore";
import { buildWorldObject, type WorldObject } from "./worldObject";

/**
 * One World with a room on each runtime (#1430): the Herdr TUI's "Studio"
 * with two tabs, one of them holding a named agent, and herdr-core's "Crew"
 * with three tabs of one terminal each.
 */
export function spacesRoomsWorld(): WorldObject {
  const zero = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
  const connection = (
    id: string,
    label: string,
    runtime: "herdr-core" | undefined,
    workspace: { workspace_id: string; label: string },
    tabs: Array<{ tab_id: string; label: string; number: number }>,
    panes: Array<Record<string, unknown>>,
  ) => ({
    connection_id: id,
    label,
    source: "test",
    is_default: id === "tui",
    state: "ready",
    generation: 1,
    snapshot_generation: 1,
    stale: false,
    actionable: true,
    ...(runtime ? { runtime } : {}),
    snapshot: {
      workspaces: [
        {
          ...workspace,
          number: 1,
          focused: false,
          pane_count: panes.length,
          tab_count: tabs.length,
          agent_status: "idle",
        },
      ],
      tabs: tabs.map((tab) => ({
        ...tab,
        workspace_id: workspace.workspace_id,
        focused: false,
        pane_count: 1,
        agent_status: "idle",
      })),
      panes: panes.map((pane) => ({
        workspace_id: workspace.workspace_id,
        focused: false,
        agent_status: "idle",
        ...pane,
      })),
      // Herdr's agent list names an agent (agentListRecord).
      agents: panes
        .filter((pane) => typeof pane.agent_name === "string")
        .map(({ pane_id, terminal_id, agent, agent_name }) => ({
          pane_id,
          terminal_id,
          agent,
          name: agent_name,
        })),
      coverage: {
        workspaces: 1,
        tabs: tabs.length,
        panes: panes.length,
        agent_panes: 0,
        status: zero,
        by_workspace: [
          {
            workspace_id: workspace.workspace_id,
            tabs: tabs.length,
            panes: panes.length,
            agent_panes: 0,
            status: zero,
          },
        ],
      },
    },
  });
  const core = ["a", "b", "c"];
  const observation = parseWorldSnapshotResult({
    revision: 1,
    observed_at: 1,
    connections: [
      connection(
        "tui",
        "Workstation",
        undefined,
        { workspace_id: "w1", label: "Studio" },
        [
          { tab_id: "w1:t1", label: "Planner", number: 1 },
          { tab_id: "w1:t2", label: "2", number: 2 },
        ],
        [
          {
            pane_id: "w1:p1",
            terminal_id: "tp1",
            tab_id: "w1:t1",
            agent: "claude",
          },
          {
            pane_id: "w1:p2",
            terminal_id: "tp2",
            tab_id: "w1:t2",
            agent: "codex",
            agent_name: "Ada",
            agent_status: "working",
          },
        ],
      ),
      connection(
        "core",
        "Workstation core",
        "herdr-core",
        { workspace_id: "hc:space:crew", label: "Crew" },
        core.map((x, index) => ({
          tab_id: `hc:space:crew:tab:${x}`,
          label: `crew-${x}`,
          number: index + 1,
        })),
        core.map((x, index) => ({
          pane_id: `t${index + 1}`,
          terminal_id: `t${index + 1}`,
          tab_id: `hc:space:crew:tab:${x}`,
          runtime: "herdr-core",
          label: `crew-${x}`,
          ...(x === "c" ? {} : { agent: "claude" }),
        })),
      ),
    ],
  });
  if (!observation) throw new Error("fixture snapshot rejected");
  return buildWorldObject(observation.connections, null);
}
