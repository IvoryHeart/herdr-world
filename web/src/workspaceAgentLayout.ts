export const WORKSPACE_AGENT_LAYOUT_STORAGE_KEY = "workspaceAgentLayout";

export type WorkspaceAgentLayout = "nested" | "separate" | "compact";

export function parseWorkspaceAgentLayout(
  value: string | null | undefined,
): WorkspaceAgentLayout {
  return value === "separate" || value === "compact" ? value : "nested";
}
