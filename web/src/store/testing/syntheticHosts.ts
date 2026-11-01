/** Synthetic Herdr hosts for the simulated World service. */
import type { Pane, PaneLayout } from "../../types";
import type { SimulatedHost } from "./simulatedWorld";

export function gitStatus(branch: string, dirty = false) {
  return {
    branch,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: dirty ? 1 : 0,
    untracked: 0,
    conflicted: 0,
    dirty,
  };
}

export function layoutFor(
  host: string,
  tabId: string,
  panes: Pane[],
  width: number,
): PaneLayout {
  return {
    workspace_id: `w-${host}`,
    tab_id: tabId,
    zoomed: false,
    area: { x: 0, y: 0, width, height: 24 * panes.length },
    focused_pane_id: panes.find((pane) => pane.focused)!.pane_id,
    panes: panes.map((pane, index) => ({
      pane_id: pane.pane_id,
      focused: pane.focused,
      rect: { x: 0, y: index * 24, width, height: 24 },
    })),
    splits: [],
  };
}

export function agentPane(
  host: string,
  name: string,
  agent: string,
  status: string,
): Pane {
  return {
    pane_id: `p-${host}-${name}`,
    terminal_id: `term-${host}-${name}`,
    workspace_id: `w-${host}`,
    tab_id: `t-${host}`,
    focused: false,
    agent,
    agent_session: { value: `s-${host}-${name}` },
    agent_status: status,
    revision: 1,
  };
}

/**
 * One workspace and tab: a focused shell, idle agents "a" (older activity),
 * "b" (newer) and "status", and a working agent "task".
 */
export function hostFixture(id: string, generation: number): SimulatedHost {
  const tabId = `t-${id}`;
  const panes: Pane[] = [
    {
      pane_id: `p-${id}-shell`,
      terminal_id: `term-${id}-shell`,
      workspace_id: `w-${id}`,
      tab_id: tabId,
      focused: true,
      agent_status: "unknown",
      revision: 1,
    },
    agentPane(id, "a", "claude", "idle"),
    agentPane(id, "b", "codex", "idle"),
    agentPane(id, "status", "claude", "idle"),
    agentPane(id, "task", "codex", "working"),
  ];
  return {
    id,
    generation,
    workspaces: [
      {
        workspace_id: `w-${id}`,
        number: 1,
        label: `Synthetic ${id} workspace`,
        focused: true,
        pane_count: panes.length,
        tab_count: 1,
        active_tab_id: tabId,
        agent_status: "working",
        worktree: {
          repo_key: `repo-${id}`,
          repo_name: "synthetic",
          repo_root: `/synthetic/${id}`,
          checkout_path: `/synthetic/${id}`,
          is_linked_worktree: false,
          git_status: gitStatus("main"),
        },
      },
    ],
    tabs: [
      {
        tab_id: tabId,
        workspace_id: `w-${id}`,
        number: 1,
        label: "Synthetic tab",
        focused: true,
        pane_count: panes.length,
        agent_status: "working",
      },
    ],
    panes,
    layouts: new Map([[tabId, layoutFor(id, tabId, panes, 80)]]),
    activity: new Map([
      [`p-${id}-a`, 1_000],
      [`p-${id}-b`, 2_000],
    ]),
    endpointAvailability: {},
  };
}
