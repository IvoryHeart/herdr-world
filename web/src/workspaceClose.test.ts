import { describe, expect, it } from "vitest";
import {
  captureWorkspaceCloseConfirmation,
  executeConfirmedWorkspaceClose,
  linkedWorkspaceLabels,
  workspaceCloseConfirmationMatches,
} from "./workspaceClose";
import type { WorkspaceCloseConfirmation } from "./workspaceClose";
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

  it("closes confirmed linked members individually and the primary last", async () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a")!;
    const calls: string[] = [];

    const result = await executeConfirmedWorkspaceClose({
      confirmed,
      fetchCurrent: async () => confirmed,
      isCurrent: () => true,
      closeWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
        return true;
      },
    });

    expect(calls).toEqual(["child", "root"]);
    expect(result).toEqual({ status: "complete", completed: 2, total: 2 });
  });

  it("does not dispatch after cancellation during the confirmation refresh", async () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a")!;
    let resolveCurrent!: (confirmation: WorkspaceCloseConfirmation | null) => void;
    let current = true;
    const calls: string[] = [];
    const resultPromise = executeConfirmedWorkspaceClose({
      confirmed,
      fetchCurrent: () => new Promise((resolve) => { resolveCurrent = resolve; }),
      isCurrent: () => current,
      closeWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
        return true;
      },
    });

    current = false;
    resolveCurrent(confirmed);

    await expect(resultPromise).resolves.toEqual({ status: "cancelled" });
    expect(calls).toEqual([]);
  });

  it("renews the dialog without dispatch when the refreshed membership changed", async () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a")!;
    const changed = captureWorkspaceCloseConfirmation(
      [...workspaces, workspace("new-child", "repo", true)],
      "root",
      "generation-a",
    )!;
    const calls: string[] = [];

    const result = await executeConfirmedWorkspaceClose({
      confirmed,
      fetchCurrent: async () => changed,
      isCurrent: () => true,
      closeWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
        return true;
      },
    });

    expect(result).toEqual({ status: "changed", confirmation: changed });
    expect(calls).toEqual([]);
  });

  it("stops after cancellation during a sequential close", async () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a")!;
    let current = true;
    const calls: string[] = [];

    const result = await executeConfirmedWorkspaceClose({
      confirmed,
      fetchCurrent: async () => confirmed,
      isCurrent: () => current,
      closeWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
        current = false;
        return true;
      },
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(calls).toEqual(["child"]);
  });

  it("cannot include a member that joins after confirmation and reports a partial stop", async () => {
    const confirmed = captureWorkspaceCloseConfirmation(workspaces, "root", "generation-a")!;
    const calls: string[] = [];
    let unseenMemberJoined = false;

    const result = await executeConfirmedWorkspaceClose({
      confirmed,
      fetchCurrent: async () => confirmed,
      isCurrent: () => true,
      closeWorkspace: async (workspaceId) => {
        calls.push(workspaceId);
        if (workspaceId === "child") {
          unseenMemberJoined = true;
          return true;
        }
        // Herdr v0.9.0 rejects close_group=false on the primary while a linked member exists.
        return !unseenMemberJoined;
      },
    });

    expect(calls).toEqual(["child", "root"]);
    expect(calls).not.toContain("new-child");
    expect(result).toEqual({ status: "partial", completed: 1, total: 2 });
  });
});
