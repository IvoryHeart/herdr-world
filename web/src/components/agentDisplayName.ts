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
