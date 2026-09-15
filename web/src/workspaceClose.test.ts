import { describe, expect, it } from "vitest";
import {
  captureWorkspaceCloseConfirmation,
  linkedWorkspaceLabels,
  workspaceCloseConfirmationMatches,
} from "./workspaceClose";
import type { WorkspaceInfo } from "./types";

function workspace(id: string, repoKey?: string, linked = false): WorkspaceInfo {
  return {
    workspace_id: id, label: id, number: 1, focused: false, pane_count: 1,
    tab_count: 1, active_tab_id: "tab", agent_status: "idle",
    worktree: repoKey ? {
      repo_key: repoKey, repo_name: repoKey, repo_root: "/repo", checkout_path: "/repo",
      is_linked_worktree: linked,
    } : undefined,
  };
}

describe("workspace group close confirmation", () => {
  const workspaces = [
    workspace("root", "repo"), workspace("child", "repo", true),
    workspace("other-root", "other"), workspace("other-child", "other", true),
    workspace("plain"), workspace("standalone", "standalone"),
  ];

  it("names only linked workspaces of the selected primary checkout", () => {
    expect(linkedWorkspaceLabels(workspaces, "root")).toEqual(["child"]);
  });

  it("does not authorize group closure for linked, plain, missing or standalone spaces", () => {
    for (const id of ["child", "plain", "missing", "standalone"]) {
      expect(linkedWorkspaceLabels(workspaces, id)).toEqual([]);
    }
  });

  it("includes every same-repository workspace that upstream would close", () => {
    expect(linkedWorkspaceLabels([
      ...workspaces, workspace("another-primary", "repo"),
    ], "root")).toEqual(["child", "another-primary"]);
  });

  it("accepts the same generation and exact group membership regardless of snapshot order", () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a");
    const current = captureWorkspaceCloseConfirmation(
      [workspaces[1], workspaces[0], ...workspaces.slice(2)],
      "root",
      "generation-a",
    );

    expect(workspaceCloseConfirmationMatches(confirmed, current)).toBe(true);
  });

  it("requires renewed confirmation when a workspace joins or leaves the group", () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a");
    const added = captureWorkspaceCloseConfirmation(
      [...workspaces, workspace("new-child", "repo", true)],
      "root",
      "generation-a",
    );
    const removed = captureWorkspaceCloseConfirmation(
      workspaces.filter((item) => item.workspace_id !== "child"),
      "root",
      "generation-a",
    );

    expect(workspaceCloseConfirmationMatches(confirmed, added)).toBe(false);
    expect(workspaceCloseConfirmationMatches(confirmed, removed)).toBe(false);
    expect(added?.linkedWorkspaceLabels).toEqual(["child", "new-child"]);
    expect(removed?.linkedWorkspaceLabels).toEqual([]);
  });

  it("requires renewed confirmation after a runtime generation change", () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a");
    const replacement = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-b");

    expect(workspaceCloseConfirmationMatches(confirmed, replacement)).toBe(false);
  });

  it("cannot confirm a workspace that is absent from the current snapshot", () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a");

    expect(captureWorkspaceCloseConfirmation(workspaces, "missing", "generation-a")).toBeNull();
    expect(workspaceCloseConfirmationMatches(confirmed, null)).toBe(false);
  });
});
