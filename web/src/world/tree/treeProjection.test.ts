import { describe, expect, it } from "vitest";
import { hostProfile } from "../../hostProfile";
import type { Snapshot } from "../../types";
import { buildWorldModel } from "../worldModel";
import type { WorldRuntimeSource } from "../worldModel";
import { projectHerdrTree, TREE_PRESENTATION_BOUNDS } from "./treeProjection";

describe("Tree projection", () => {
  it("preserves qualified three-tier identity for colliding native IDs", () => {
    const tree = projectHerdrTree(buildWorldModel([source("a"), source("b")]));
    expect(tree.hosts).toHaveLength(2);
    expect(new Set(tree.spaces.map(({ node }) => node.id)).size).toBe(2);
    expect(new Set(tree.spaces.flatMap(({ children }) => children.map(({ id }) => id))).size).toBe(2);
    expect(tree.edges).toHaveLength(4);
    for (const host of tree.hosts) {
      expect(host.node.parentId).toBeNull();
      expect(host.spaces[0]?.node.parentId).toBe(host.node.id);
      expect(host.spaces[0]?.children[0]?.parentId).toBe(host.spaces[0]?.node.id);
      expect(host.spaces[0]?.children[0]?.hostKey).toBe(host.node.hostKey);
    }
    expect(tree.presentationBounds).toBe(TREE_PRESENTATION_BOUNDS);
  });
});

function source(profileId: string): WorldRuntimeSource {
  const snapshot: Snapshot = {
    workspaces: [{ workspace_id: "shared", number: 1, label: "Repository-looking label", focused: true,
      pane_count: 1, tab_count: 1, active_tab_id: "tab", agent_status: "working" }],
    tabs: [{ tab_id: "tab", workspace_id: "shared", number: 1, label: "Task-looking tab", focused: true,
      pane_count: 1, agent_status: "working" }],
    panes: [{ pane_id: "pane", terminal_id: "terminal", workspace_id: "shared", tab_id: "tab",
      focused: true, display_agent: "Codex", agent: "codex", agent_status: "working", revision: 1,
      task_summary: "Bounded task text" }],
    layouts: [], selected_pane_id: "pane",
  };
  return {
    profile: hostProfile(profileId, `Host ${profileId}`, `https://${profileId}.example.invalid`, true, 0),
    location: "remote", connectionState: "compatible", generationKey: `${profileId}:generation`,
    features: ["snapshot", "terminal_attach"], snapshot,
  };
}
