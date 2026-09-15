import type { WorkspaceInfo } from "./types";

export type WorkspaceCloseConfirmation = {
  generationKey: string;
  workspaceIds: string[];
  linkedWorkspaceLabels: string[];
};

function linkedWorkspaces(workspaces: readonly WorkspaceInfo[], workspaceId: string) {
  const workspace = workspaces.find((item) => item.workspace_id === workspaceId);
  const worktree = workspace?.worktree;
  if (!workspace || !worktree || worktree.is_linked_worktree) return [];
  return workspaces.filter(
    (item) => item.workspace_id !== workspaceId && item.worktree?.repo_key === worktree.repo_key,
  );
}

/** Only a primary checkout can authorize closing its linked workspace group. */
export function linkedWorkspaceLabels(workspaces: readonly WorkspaceInfo[], workspaceId: string) {
  return linkedWorkspaces(workspaces, workspaceId).map((item) => item.label);
}

/** Capture the exact runtime generation and workspace set authorized by the dialog. */
export function captureWorkspaceCloseConfirmation(
  workspaces: readonly WorkspaceInfo[],
  workspaceId: string,
  generationKey: string,
): WorkspaceCloseConfirmation | null {
  if (!workspaces.some((item) => item.workspace_id === workspaceId)) {
    return null;
  }
  const linked = linkedWorkspaces(workspaces, workspaceId);
  return {
    generationKey,
    workspaceIds: [workspaceId, ...linked.map((item) => item.workspace_id)].sort(),
    linkedWorkspaceLabels: linked.map((item) => item.label),
  };
}

export function workspaceCloseConfirmationMatches(
  confirmed: WorkspaceCloseConfirmation | null | undefined,
  current: WorkspaceCloseConfirmation | null,
) {
  return Boolean(
    confirmed &&
    current &&
    confirmed.generationKey === current.generationKey &&
    confirmed.workspaceIds.length === current.workspaceIds.length &&
    confirmed.workspaceIds.every((workspaceId, index) => workspaceId === current.workspaceIds[index]),
  );
}
