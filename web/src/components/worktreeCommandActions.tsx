import { FolderOpen, GitBranch, GitCommitHorizontal, X } from "lucide-react";
import type { Workspace } from "../types";
import type { ActionDefinition } from "./CommandCombobox";

/**
 * The command menu's entries for the focused workspace's worktrees. Herdr
 * resolves the repository from the workspace on demand, so opening a worktree
 * and choosing the worktree location work for a plain workspace in a Git
 * checkout too (see ContextMenu).
 */
export function worktreeCommandActions(
  workspace: Workspace,
  workspaceName: (workspace?: Workspace) => string,
  open: {
    worktree: (workspaceId: string) => void;
    location: (workspaceId: string) => void;
    lifecycle: (workspaceId: string) => void;
    hooks: (workspaceId: string) => void;
    remove: (workspace: Workspace) => void;
  },
): ActionDefinition[] {
  const actions: ActionDefinition[] = [
    {
      key: "current-open-worktree",
      icon: <FolderOpen size={15} />,
      title: "Open worktree",
      detail: workspaceName(workspace),
      keywords: ["existing worktree", "open existing", "checkout", "branch"],
      run: () => open.worktree(workspace.workspace_id),
    },
    {
      key: "current-worktree-location",
      icon: <FolderOpen size={15} />,
      title: "Worktree location",
      detail: workspaceName(workspace),
      keywords: [
        "worktree directory",
        "worktree path",
        "where worktrees are created",
        "worktree folder",
      ],
      run: () => open.location(workspace.workspace_id),
    },
  ];
  const worktree = workspace.worktree;
  if (!worktree) return actions;
  actions.push(
    {
      key: "current-worktree-lifecycle",
      icon: <GitCommitHorizontal size={15} />,
      title: "Open worktree lifecycle",
      detail: worktree.repo_name,
      keywords: [
        "worktree center",
        "manage worktrees",
        "repository lifecycle",
        "git worktree status",
        "hooks auto sync",
      ],
      run: () => open.lifecycle(workspace.workspace_id),
    },
    {
      key: "current-worktree-hooks",
      icon: <GitBranch size={15} />,
      title: "Worktree hooks",
      detail: worktree.repo_name,
      keywords: ["hook config", "hooks config", "paseo", "setup teardown"],
      run: () => open.hooks(workspace.workspace_id),
    },
  );
  if (worktree.is_linked_worktree)
    actions.push({
      key: "current-remove-worktree",
      icon: <X size={15} />,
      title: "Remove worktree",
      detail: worktree.checkout_path,
      keywords: [
        "delete worktree",
        "close worktree",
        "teardown worktree",
        "remove branch",
        workspaceName(workspace),
        worktree.repo_name,
      ],
      danger: true,
      run: () => open.remove(workspace),
    });
  return actions;
}
