import {
  activityIdentity,
  activityKey,
  activityFromList,
  rememberActivity,
  type AgentActivityMap,
} from "../../shared/agentActivity";
import type { Pane } from "./types";

export function withCachedRecency(
  panes: readonly Pane[],
  activity: AgentActivityMap,
): Pane[] {
  return panes.map((pane) => {
    const identity = activityIdentity(pane),
      entry = activity[pane.pane_id];
    if (
      !identity ||
      !entry ||
      activityKey(identity) !== activityKey(entry) ||
      entry.last_activity_at <= (pane.last_activity_at ?? 0)
    )
      return pane;
    return { ...pane, last_activity_at: entry.last_activity_at };
  });
}

/** Merge at publication time, after layout reads, so an in-flight reply cannot undo a push. */
export function observedRecency(
  previous: AgentActivityMap,
  panes: readonly Pane[],
  result: unknown,
) {
  const identities = new Map(
    panes.map((pane) => [pane.pane_id, activityIdentity(pane)]),
  );
  const retained = Object.fromEntries(
    Object.entries(previous).filter(([paneId, entry]) => {
      const identity = identities.get(paneId);
      return identity && activityKey(identity) === activityKey(entry);
    }),
  );
  const agentActivity = rememberActivity(
    retained,
    activityFromList(result),
    panes,
  );
  return { agentActivity, panes: withCachedRecency(panes, agentActivity) };
}
