import type { WorkspaceInfo } from "./types";

export type WorkspaceCloseConfirmation = {
  generationKey: string;
  targetWorkspaceId: string;
  workspaceIds: string[];
  linkedWorkspaceLabels: string[];
};

export type WorkspaceCloseExecutionResult =
  | { status: "cancelled" | "unavailable" }
  | { status: "changed"; confirmation: WorkspaceCloseConfirmation }
  | { status: "complete" | "partial"; completed: number; total: number };

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
    targetWorkspaceId: workspaceId,
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
    confirmed.targetWorkspaceId === current.targetWorkspaceId &&
    confirmed.workspaceIds.length === current.workspaceIds.length &&
    confirmed.workspaceIds.every((workspaceId, index) => workspaceId === current.workspaceIds[index]),
  );
}

/**
 * Close only the exact IDs the user confirmed. Linked workspaces go first and
 * the primary goes last, all with close_group=false. If another member joins,
 * Herdr rejects that final primary close instead of including the unseen ID.
 */
export async function executeConfirmedWorkspaceClose(options: {
  confirmed: WorkspaceCloseConfirmation | null | undefined;
  fetchCurrent: () => Promise<WorkspaceCloseConfirmation | null>;
  isCurrent: () => boolean;
  closeWorkspace: (workspaceId: string) => Promise<boolean>;
}): Promise<WorkspaceCloseExecutionResult> {
  const current = await options.fetchCurrent();
  if (!options.isCurrent()) {
    return { status: "cancelled" };
  }
  if (!current) {
    return { status: "unavailable" };
  }
  if (!workspaceCloseConfirmationMatches(options.confirmed, current)) {
    return { status: "changed", confirmation: current };
  }

  const workspaceIds = [
    ...current.workspaceIds.filter((workspaceId) => workspaceId !== current.targetWorkspaceId),
    current.targetWorkspaceId,
  ];
  let completed = 0;
  for (const workspaceId of workspaceIds) {
    if (!options.isCurrent()) {
      return { status: "cancelled" };
    }
    const closed = await options.closeWorkspace(workspaceId);
    if (!options.isCurrent()) {
      return { status: "cancelled" };
    }
    if (!closed) {
      return { status: "partial", completed, total: workspaceIds.length };
    }
    completed += 1;
  }
  return { status: "complete", completed, total: workspaceIds.length };
}
