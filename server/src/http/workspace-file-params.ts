/** Shared RPC-equivalent resource binding for all qualified workspace HTTP files. */
export function workspaceFileParams(url: URL) {
  const value = (key: string) => url.searchParams.get(key) ?? undefined;
  return {
    workspace_id: value("workspace_id"),
    path: value("path"),
    scope: value("scope"),
    directory: value("directory"),
    filename: value("filename"),
    inline: value("inline") === "1",
    agent_worktree: value("agent_worktree"),
  };
}
