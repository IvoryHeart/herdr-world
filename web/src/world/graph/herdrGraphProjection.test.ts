import { describe, expect, it, vi } from "vitest";

import { hostProfile } from "../../hostProfile";
import type { AgentStatus, PaneInfo, Snapshot, WorkspaceInfo } from "../../types";
import { buildWorldModel } from "../worldModel";
import type { WorldRuntimeSource } from "../worldModel";
import {
  GRAPH_PRESENTATION_BOUNDS,
  projectHerdrGraph as projectGraphModel,
} from "./herdrGraphProjection";

function projectHerdrGraph(sources: readonly WorldRuntimeSource[]) {
  return projectGraphModel(buildWorldModel(sources));
}

describe("Herdr Graph projection", () => {
  it("keeps duplicate spaces distinct and presents both agent terminals and empty shells", () => {
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

    expect(graph.hosts).toHaveLength(2);
    expect(graph.hosts.map(({ node }) => node.kind)).toEqual(["host", "host"]);
    expect(graph.spaces).toHaveLength(2);
    expect(new Set(graph.spaces.map(({ node }) => node.id)).size).toBe(2);
    expect(graph.spaces.map(({ node }) => node.hostKey)).toEqual(["host-a", "host-b"]);
    expect(graph.spaces[0]?.node).toMatchObject({ label: "main", subtitle: "herdr-world" });
    expect(graph.spaces[0]?.children).toHaveLength(2);
    expect(graph.spaces[0]?.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "agent", label: "Codex", agentKind: "codex" }),
      expect.objectContaining({ kind: "terminal", label: "Shell", agentKind: null }),
    ]));
    expect(graph.spaces[1]?.children).toHaveLength(0);
    expect(graph.coverage).toMatchObject({
      observedTerminals: 2,
      presentedTerminals: 2,
      observedAgents: 1,
      observedShells: 1,
    });
    expect(graph.nodes.some(({ searchText }) => searchText.includes("/private"))).toBe(false);
  });

  it("keeps unavailable configured hosts as primary nodes without invented children", () => {
    const unavailable = source("host-offline", 0, [], []);
    unavailable.snapshot = null;
    unavailable.generationKey = null;
    unavailable.connectionState = "offline";

    const graph = projectHerdrGraph([unavailable]);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.hosts[0]).toMatchObject({
      node: {
        kind: "host",
        hostKey: "host-offline",
        disconnected: true,
        actionable: false,
      },
      spaces: [],
      observedSpaceCount: 0,
    });
  });

  it("applies an exact configured-host presentation bound", () => {
    const sources = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.hosts + 1 }, (_, index) =>
      source(`host-${index}`, index, [], []));

    const graph = projectHerdrGraph(sources);

    expect(graph.hosts).toHaveLength(GRAPH_PRESENTATION_BOUNDS.hosts);
    expect(graph.omittedHostCount).toBe(1);
    expect(graph.coverage).toMatchObject({
      configuredHosts: 129,
      presentedHosts: 128,
      omittedHosts: 1,
    });
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
    expect(changed.spaces[0]?.children[0]?.id).toBe(first.spaces[0]?.children[0]?.id);
    expect(changed.spaces[0]?.children[0]?.selectionKey).toBe(first.spaces[0]?.children[0]?.selectionKey);
    expect(changed.spaces[0]?.children[0]).toMatchObject({
      status: "blocked",
      focused: true,
      taskSummary: "Second",
    });
  });

  it("marks an unrecognized detected agent for the generic icon fallback", () => {
    const graph = projectHerdrGraph([source(
      "host-a",
      0,
      [workspace("space-a", 1, "Alpha")],
      [pane("agent-a", "space-a", "working", { agent: "aider", display_agent: "Aider" })],
    )]);

    expect(graph.spaces[0]?.children[0]).toMatchObject({
      kind: "agent",
      label: "Aider",
      agentKind: null,
    });
  });

  it("prioritizes focused and active entities at exact presentation bounds", () => {
    const workspaces = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.spaces + 1 }, (_, index) =>
      workspace(`space-${index}`, index + 1, `Space ${index}`, undefined, index === 128),
    );
    const panes = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.childrenPerSpace + 3 }, (_, index) =>
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
    expect(firstSpace?.children).toHaveLength(16);
    expect(firstSpace?.children.slice(0, 3).map(({ label }) => label)).toEqual([
      "Agent 16",
      "Agent 17",
      "Agent 18",
    ]);
    expect(firstSpace?.omittedChildCount).toBe(3);
    expect(graph.omittedSpaceCount).toBe(1);
    expect(graph.coverage).toMatchObject({
      observedSpaces: 129,
      presentedSpaces: 128,
      observedAgents: 19,
      presentedAgents: 16,
      omittedAgents: 3,
      omittedAgentsInPresentedSpaces: 3,
      omittedAgentsInOmittedSpaces: 0,
      observedTerminals: 19,
      presentedTerminals: 16,
      omittedTerminals: 3,
    });
  });

  it("retains a detected agent when its unfocused space is last in source order", () => {
    const workspaces = Array.from({ length: GRAPH_PRESENTATION_BOUNDS.spaces + 1 }, (_, index) =>
      workspace(`space-${index}`, index + 1, `Space ${index}`, undefined, false),
    );
    const graph = projectHerdrGraph([source(
      "host-a",
      0,
      workspaces,
      [pane("last-agent", "space-128", "idle", { agent: "codex", display_agent: "Codex" })],
    )]);

    expect(graph.spaces).toHaveLength(GRAPH_PRESENTATION_BOUNDS.spaces);
    expect(graph.spaces.some(({ node }) => node.label === "Space 128")).toBe(true);
    expect(graph.spaces.some(({ node }) => node.label === "Space 127")).toBe(false);
    expect(graph.coverage).toMatchObject({
      observedAgents: 1,
      presentedAgents: 1,
      omittedAgentsInOmittedSpaces: 0,
    });
  });

  it("indexes panes in bounded passes instead of rescanning them for every workspace", () => {
    const workspaces = Array.from({ length: 512 }, (_, index) =>
      workspace(`space-${index}`, index + 1, `Space ${index}`, undefined, false),
    );
    const panes = workspaces.map((item, index) =>
      pane(`agent-${index}`, item.workspace_id, index % 2 === 0 ? "working" : "idle"),
    );
    const host = source("host-a", 0, workspaces, panes);
    if (!host.snapshot) throw new Error("Snapshot missing");
    const paneMap = vi.spyOn(host.snapshot.panes, "map");

    const graph = projectHerdrGraph([host]);

    expect(graph.coverage).toMatchObject({ observedSpaces: 512, observedTerminals: 512 });
    expect(paneMap.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("retains an offline snapshot but reserves disconnected for the offline state", () => {
    const stale = source(
      "host-a",
      0,
      [workspace("space-a", 1, "Alpha")],
      [pane("agent-a", "space-a", "done", { display_agent: "Codex" })],
    );
    stale.connectionState = "offline";
    const graph = projectHerdrGraph([stale]);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.every((node) =>
      node.stale && node.disconnected && node.connectionState === "offline"
    )).toBe(true);
    expect(graph.nodes.every((node) => !node.actionable && node.handoff === null)).toBe(true);
  });

  it.each(["degraded", "connecting"] as const)(
    "retains a %s snapshot without reporting its nodes as disconnected",
    (connectionState) => {
      const retained = source(
        "host-a",
        0,
        [workspace("space-a", 1, "Alpha")],
        [pane("agent-a", "space-a", "working", { display_agent: "Codex" })],
      );
      retained.connectionState = connectionState;

      const graph = projectHerdrGraph([retained]);

      expect(graph.nodes).toHaveLength(3);
      expect(graph.nodes.every((node) =>
        node.stale && !node.disconnected && node.connectionState === connectionState
      )).toBe(true);
      expect(graph.nodes.every((node) => !node.actionable && node.handoff === null)).toBe(true);
    },
  );
});

function source(
  id: string,
  order: number,
  workspaces: WorkspaceInfo[],
  panes: PaneInfo[],
  label = id,
): WorldRuntimeSource {
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
