import type { WorldLeafObject } from "./worldObject";
import { agentFolder } from "./deskAgentLabels";
const RECENT_LIMIT = 6;
export type DirectoryGroup = {
  /** Connection-qualified workspace identity. */
  key: string;
  /** Heading; disambiguated by folder when two workspaces share a label. */
  workspace: string;
  agents: WorldLeafObject[];
};

/**
 * Every agent, most recently active first: a "Recently opened" shortlist from
 * the Desk, then workspaces ordered by their most recent agent.
 */
export function agentDirectory(
  agents: readonly WorldLeafObject[],
  activeAt: (leaf: WorldLeafObject) => number | null,
  openedAt: (leaf: WorldLeafObject) => number | null,
): { recent: WorldLeafObject[]; groups: DirectoryGroup[] } {
  const newest = (left: WorldLeafObject, right: WorldLeafObject) =>
    (activeAt(right) ?? 0) - (activeAt(left) ?? 0);
  const recent = agents
    .filter((leaf) => openedAt(leaf) !== null)
    .sort((left, right) => (openedAt(right) ?? 0) - (openedAt(left) ?? 0))
    .slice(0, RECENT_LIMIT);
  // Group by workspace identity, not its display label: two checkouts named
  // after the same repository are different workspaces.
  const byWorkspace = new Map<string, WorldLeafObject[]>();
  for (const leaf of agents) {
    const key = JSON.stringify([leaf.connectionId, leaf.pane.workspace_id]);
    const group = byWorkspace.get(key) ?? [];
    group.push(leaf);
    byWorkspace.set(key, group);
  }
  const labelCounts = new Map<string, number>();
  for (const members of byWorkspace.values())
    labelCounts.set(
      members[0].spaceLabel,
      (labelCounts.get(members[0].spaceLabel) ?? 0) + 1,
    );
  const groups = [...byWorkspace].map(([key, members]) => {
    const label = members[0].spaceLabel;
    const folder = agentFolder(members[0]);
    return {
      key,
      workspace:
        (labelCounts.get(label) ?? 0) > 1 && folder
          ? `${label} (${folder})`
          : label,
      agents: [...members].sort(newest),
    };
  });
  groups.sort((left, right) => newest(left.agents[0], right.agents[0]));
  return { recent, groups };
}
