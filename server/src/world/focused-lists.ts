import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { AgentActivityCache } from "./agent-activity-cache";
import type { FocusedOwner } from "./focused-acquisition";
import {
  FOCUSED_METHODS,
  type FocusedLists,
  type FocusedMethod,
} from "./focused-acquisition";

export type FocusedActivity = {
  cache: AgentActivityCache;
  owner: FocusedOwner;
  isCurrent(): boolean;
  force?: boolean;
};

/** The same enriched lists for browser replies and the shared observer. */
export async function readFocusedList(
  connection: LegacyConnectionRuntime,
  method: FocusedMethod,
  params: Record<string, unknown> = {},
  activity?: FocusedActivity,
): Promise<any> {
  if (method === "agent.list" && activity?.cache) {
    const raw = await connection.herdr.call(method, params);
    return activity.cache.enrich(
      activity.owner,
      raw,
      () =>
        connection.remotePlatform === "windows"
          ? Promise.resolve(raw)
          : connection.agentSessions.enrichActivity(raw),
      activity.isCurrent,
      activity.force,
    );
  }
  if (method === "agent.list" && connection.remotePlatform !== "windows")
    return connection.agentSessions.listWithActivity(params);
  let result = await connection.herdr.call(method, params);
  if (method === "workspace.list") {
    if (connection.remotePlatform !== "windows") {
      result = await connection.worktreeParents.enrichWorkspaceList(result);
      result = await connection.status.enrichWorkspacesWithGitStatus(result);
    }
    result = {
      ...result,
      navigation_mode: await connection.terminalBridge.navigationMode(),
      tab_move_supported: await connection.terminalBridge.tabMoveSupported(),
      endpoint_availability: connection.terminalBridge.endpointAvailability(),
    };
  }
  if (method === "tab.list")
    result = {
      ...result,
      tab_move_supported: await connection.terminalBridge.tabMoveSupported(),
    };
  return result;
}

export async function readFocusedLists(
  connection: LegacyConnectionRuntime,
  activity?: FocusedActivity,
): Promise<FocusedLists> {
  // A failed sibling must settle too before another observation can start.
  const results = await Promise.allSettled(
    FOCUSED_METHODS.map((method) =>
      readFocusedList(connection, method, {}, activity),
    ),
  );
  const lists: Partial<FocusedLists> = {};
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    if (result.status === "rejected") throw result.reason;
    lists[FOCUSED_METHODS[index]!] = result.value;
  }
  return lists as FocusedLists;
}
