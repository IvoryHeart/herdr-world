import type { TurnReceipt } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

export function where(leaf: WorldLeafObject) {
  return [leaf.hostLabel, leaf.spaceLabel, leaf.tabLabel, agentFolder(leaf)]
    .filter(Boolean)
    .join(" › ");
}

/**
 * What the operator recognizes an agent by: the name they gave it, otherwise
 * the harness's own thread title, otherwise the harness.
 */
export function agentName(leaf: WorldLeafObject) {
  return leaf.agentName ?? leaf.terminalTitle ?? leaf.agentLabel ?? leaf.label;
}

/** Harness and model, so the operator can tell what each agent runs on. */
export function agentRuntime(leaf: WorldLeafObject) {
  return [
    leaf.agentName || leaf.terminalTitle ? leaf.agentLabel : null,
    leaf.modelLabel,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The folder an agent works in, which tells same-named tabs apart. */
export function agentFolder(leaf: WorldLeafObject) {
  const cwd = leaf.pane.foreground_cwd ?? leaf.pane.cwd;
  if (!cwd) return null;
  const parts = cwd.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || cwd;
}

/**
 * Whether an agent matches every word of a search across the things an
 * operator remembers: its name, harness, workspace, tab, folder, request and
 * report.
 */
export function matchesQuery(
  leaf: WorldLeafObject,
  receipt: TurnReceipt | null,
  query: string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [
    leaf.agentName,
    leaf.terminalTitle,
    leaf.agentLabel,
    leaf.modelLabel,
    leaf.label,
    leaf.spaceLabel,
    leaf.tabLabel,
    agentFolder(leaf),
    leaf.taskSummary,
    receipt?.ask,
    receipt?.report,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}
