import type {
  WorkItem,
  WorkLink,
  WorldSourcesSnapshot,
} from "../../../shared/worldSources";

/*
 * Work links between source items and agent panes. Pure, with no store or
 * framework dependency, so the Town scene model and the Work lens share them.
 */

/** A pane as World observes it now, to check a link still describes it. */
export type LinkedPane = {
  generation: number;
  agentSessionFingerprint?: string;
};

/**
 * A link names the runtime generation and agent session it was made for; a
 * restarted runtime or a new agent in the same pane ID is not that pane.
 */
export function linkMatchesPane(link: WorkLink, pane: LinkedPane) {
  return (
    link.generation === pane.generation &&
    link.sessionFingerprint === (pane.agentSessionFingerprint ?? null)
  );
}

/** Each agent pane's linked items, keyed by connection and pane. */
export function workItemsByPane(
  snapshot: WorldSourcesSnapshot,
  paneOf: (connectionId: string, paneId: string) => LinkedPane | undefined,
): ReadonlyMap<string, WorkItem[]> {
  const items = new Map(snapshot.items.map((item) => [item.key, item]));
  const byPane = new Map<string, WorkItem[]>();
  for (const link of snapshot.links) {
    const item = items.get(link.itemKey);
    if (!item) continue;
    const pane = paneOf(link.connectionId, link.paneId);
    if (!pane || !linkMatchesPane(link, pane)) continue;
    const key = paneKey(link.connectionId, link.paneId);
    const list = byPane.get(key) ?? [];
    if (!list.includes(item)) list.push(item);
    byPane.set(key, list);
  }
  return byPane;
}

export const paneKey = (connectionId: string, paneId: string) =>
  `${connectionId}\0${paneId}`;
