import { describe, expect, it } from "vitest";

import { hostProfile } from "../../hostProfile";
import type { AgentStatus, PaneInfo, Snapshot, WorkspaceInfo } from "../../types";
import type { HerdrOfficeSourceHost } from "../herdrOfficeProjection";
import {
  GRAPH_PRESENTATION_BOUNDS,
  projectHerdrGraph,
} from "./herdrGraphProjection";

describe("Herdr Graph projection", () => {
  it("keeps runtime-qualified duplicate spaces distinct, includes empty spaces, and excludes ordinary panes", () => {
    const sources = ["host-a", "host-b"].map((hostId, index) => source(
      hostId,
      index,
      [workspace("main", 1, "main", {
        repo_key: "repo-key",
        repo_name: "herdr-world",
        repo_root: "/private/repo",
        checkout_path: "/private/worktree",
        is_linked_worktree: false,
      })],
      index === 0
        ? [
            pane("agent", "main", "working", { display_agent: "Codex", task_summary: "Reviewing Graph" }),
            pane("shell", "main", "unknown"),
          ]
        : [],
      "Duplicate host",
    ));

    const graph = projectHerdrGraph(sources);

    expect(graph.spaces).toHaveLength(2);
    expect(new Set(graph.spaces.map(({ node }) => node.id)).size).toBe(2);
    expect(graph.spaces.map(({ node }) => node.hostKey)).toEqual(["host-a", "host-b"]);
    expect(graph.spaces[0]?.node).toMatchObject({ label: "main", subtitle: "herdr-world" });
    expect(graph.spaces[0]?.agents).toHaveLength(1);
    expect(graph.spaces[1]?.agents).toHaveLength(0);
    expect(graph.nodes.some(({ searchText }) => searchText.includes("/private"))).toBe(false);
  });

  it("keeps stable source IDs through status, label, focus, and summary changes", () => {
    const first = projectHerdrGraph([source(
      "host-a",
      0,
      [workspace("space-a", 1, "Alpha")],
      [pane("agent-a", "space-a", "working", { display_agent: "Codex", task_summary: "First" })],
    )]);
    const changed = projectHerdrGraph([source(
      "host-a",
      0,
      [workspace("space-a", 1, "Renamed", undefined, true)],
      [pane("agent-a", "space-a", "blocked", { display_agent: "Renamed", task_summary: "Second", focused: true })],
    )]);

    expect(changed.spaces[0]?.node.id).toBe(first.spaces[0]?.node.id);
    expect(changed.spaces[0]?.agents[0]?.id).toBe(first.spaces[0]?.agents[0]?.id);
    expect(changed.spaces[0]?.agents[0]?.selectionKey).toBe(first.spaces[0]?.agents[0]?.selectionKey);
    expect(changed.spaces[0]?.agents[0]).toMatchObject({
      status: "blocked",
      focused: true,
      taskSummary: "Second",
    });
  });

  it("prioritizes focused and active entities at exact presentation bounds", () => {
    const workspaces = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.spaces + 1 }, (_, index) =>
      workspace(`space-${index}`, index + 1, `Space ${index}`, undefined, index === 128),
    );
    const panes = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.agentsPerSpace + 3 }, (_, index) =>
      pane(
        `agent-${index}`,
        "space-0",
        index === 18 ? "blocked" : index === 17 ? "working" : "idle",
        { display_agent: `Agent ${index}`, focused: index === 16 },
      ),
    );
    const graph = projectHerdrGraph([source("host-a", 0, workspaces, panes)]);

    expect(graph.spaces).toHaveLength(128);
    expect(graph.spaces.some(({ node }) => node.label === "Space 128")).toBe(true);
    expect(graph.spaces.some(({ node }) => node.label === "Space 127")).toBe(false);
    const firstSpace = graph.spaces.find(({ node }) => node.label === "Space 0");
    expect(firstSpace?.agents).toHaveLength(16);
    expect(firstSpace?.agents.slice(0, 3).map(({ label }) => label)).toEqual([
      "Agent 16",
      "Agent 17",
      "Agent 18",
    ]);
    expect(firstSpace?.omittedAgentCount).toBe(3);
    expect(graph.omittedSpaceCount).toBe(1);
    expect(graph.coverage).toMatchObject({
      observedSpaces: 129,
      presentedSpaces: 128,
      observedAgents: 19,
      presentedAgents: 16,
      omittedAgents: 3,
      omittedAgentsInPresentedSpaces: 3,
      omittedAgentsInOmittedSpaces: 0,
    });
  });

  it("retains stale snapshot topology but disables actions and marks it disconnected", () => {
    const stale = source(
      "host-a",
      0,
      [workspace("space-a", 1, "Alpha")],
      [pane("agent-a", "space-a", "done", { display_agent: "Codex" })],
    );
    stale.connectionState = "offline";
    const graph = projectHerdrGraph([stale]);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.every((node) => node.stale && node.disconnected)).toBe(true);
    expect(graph.nodes.every((node) => !node.actionable && node.handoff === null)).toBe(true);
  });
});

function source(
  id: string,
  order: number,
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
  label = id,
): HerdrOfficeSourceHost {
  return {
    profile: hostProfile(id, label, `http://${id}.example`, true, order),
    location: "remote",
    connectionState: "compatible",
    generationKey: `${id}:generation`,
    features: ["snapshot", "terminal_attach"],
    snapshot: snapshot(workspaces, panes),
  };
}

function snapshot(workspaces: WorkspaceInfo[], panes: PaneInfo[]): Snapshot {
  return {
    workspaces,
    tabs: workspaces.map((item) => ({
      tab_id: `tab-${item.workspace_id}`,
      workspace_id: item.workspace_id,
      number: 1,
      label: "Agents",
      focused: item.focused,
      pane_count: panes.filter(({ workspace_id }) => workspace_id === item.workspace_id).length,
      agent_status: "unknown" as const,
    })),
    panes,
    layouts: [],
  };
}

function workspace(
  id: string,
  number: number,
  label: string,
  worktree?: WorkspaceInfo["worktree"],
  focused = number === 1,
): WorkspaceInfo {
  return {
    workspace_id: id,
    number,
    label,
    focused,
    pane_count: 0,
    tab_count: 1,
    active_tab_id: `tab-${id}`,
    agent_status: "unknown",
    ...(worktree ? { worktree } : {}),
  };
}

function pane(
  id: string,
  workspaceId: string,
  status: AgentStatus,
  extra: Partial<PaneInfo> = {},
): PaneInfo {
  return {
    pane_id: `pane-${id}`,
    terminal_id: `terminal-${id}`,
    workspace_id: workspaceId,
    tab_id: `tab-${workspaceId}`,
    focused: false,
    agent_status: status,
    revision: 1,
    ...extra,
  };
}
