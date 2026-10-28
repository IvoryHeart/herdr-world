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
