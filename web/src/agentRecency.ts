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
      entry = identity && activity[activityKey(identity)];
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
    Object.entries(previous).filter(([, entry]) => {
      const identity = identities.get(entry.pane_id);
      return identity && activityKey(identity) === activityKey(entry);
    }),
  );
  const agentActivity = rememberActivity(retained, activityFromList(result));
  return { agentActivity, panes: withCachedRecency(panes, agentActivity) };
}

export type AgentActivityHistory = Record<string, AgentActivityMap>;

/** Read-only session history survives service counters; it never admits a runtime. */
export function rememberedRecency(
  connectionId: string,
  current: AgentActivityMap,
  history: AgentActivityHistory = {},
) {
  return rememberActivity(history[connectionId] ?? {}, Object.values(current));
}

export function recordObservedRecency(
  connectionId: string,
  current: AgentActivityMap,
  panes: readonly Pane[],
  result: unknown,
  history: AgentActivityHistory = {},
) {
  const memory = rememberedRecency(connectionId, current, history);
  const next = observedRecency(memory, panes, result);
  const remembered = rememberActivity(
    memory,
    Object.values(next.agentActivity),
  );
  return {
    ...next,
    ...(Object.keys(remembered).length
      ? { agentActivityHistory: { ...history, [connectionId]: remembered } }
      : {}),
  };
}
