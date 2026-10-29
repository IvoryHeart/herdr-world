import { paneAgentTitle } from "../agentName";
import type { Pane, Workspace } from "../types";
import type { WorkspaceInspectorContext } from "../workspaceResource";

/** An agent is named "<name>-<harness>", e.g. otter-claude. */
export function agentName(
  context: Pick<
    WorkspaceInspectorContext,
    "kind" | "label" | "agent" | "agentName"
  >,
) {
  const harness = context.agent;
  if (context.kind !== "agent" || !harness) return context.label;
  // A label may already end with " · <harness>" (a named agent's World label).
  const name = (
    context.agentName ??
    context.label.replace(new RegExp(` · ${escapeRegExp(harness)}$`, "i"), "")
  ).trim();
  const lower = name.toLowerCase();
  const tail = harness.toLowerCase();
  return lower === tail || lower.endsWith(`-${tail}`)
    ? name
    : `${name}-${harness}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inspectorAgentContext(
  pane: Pane | undefined,
  workspace: Workspace | undefined,
): WorkspaceInspectorContext | null {
  if (!pane?.agent) return null;
  const status = pane.agent_status || "unknown";
  return {
    kind: "agent",
    label: paneAgentTitle(pane, pane.display_agent?.trim() || pane.agent),
    stateLabel: pane.state_labels?.[status]?.trim() || status,
    locationLabel: workspace?.label || "Workspace",
    agent: pane.agent,
    // Spaces shows the same state badge as World: Herdr's statuses are the tones.
    statusTone: status,
    // The agent's Herdr name (agent.list), not its display label.
    ...(pane.agent_name?.trim() ? { agentName: pane.agent_name.trim() } : {}),
    ...(pane.task_summary?.trim()
      ? { taskSummary: pane.task_summary.trim() }
      : {}),
  };
}
