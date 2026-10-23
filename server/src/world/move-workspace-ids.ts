/** The host's workspace IDs after a move, with both rooms of the move. */
export async function moveWorkspaceIds(
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  moved: { workspace_id: string; source_workspace_id?: string },
) {
  const ids = new Set([moved.workspace_id]);
  if (moved.source_workspace_id) ids.add(moved.source_workspace_id);
  try {
    const listed = (await call("workspace.list", {})) as {
      workspaces?: { workspace_id?: unknown }[];
    };
    for (const entry of listed?.workspaces ?? [])
      if (typeof entry.workspace_id === "string") ids.add(entry.workspace_id);
  } catch {
    // The two rooms of the move are what a colliding tab key usually needs.
  }
  return ids;
}
