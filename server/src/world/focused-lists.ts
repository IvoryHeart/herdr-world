import type { LegacyConnectionRuntime } from "../connections/runtime";
import {
  FOCUSED_METHODS,
  type FocusedLists,
  type FocusedMethod,
} from "./focused-acquisition";

/** The same enriched lists for browser replies and the shared observer. */
export async function readFocusedList(
  connection: LegacyConnectionRuntime,
  method: FocusedMethod,
  params: Record<string, unknown> = {},
): Promise<any> {
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
): Promise<FocusedLists> {
  // A failed sibling must settle too before another observation can start.
  const results = await Promise.allSettled(
    FOCUSED_METHODS.map((method) => readFocusedList(connection, method)),
  );
  const lists: Partial<FocusedLists> = {};
  for (let index = 0; index < results.length; index++) {
    const result = results[index]!;
    if (result.status === "rejected") throw result.reason;
    lists[FOCUSED_METHODS[index]!] = result.value;
  }
  return lists as FocusedLists;
}
