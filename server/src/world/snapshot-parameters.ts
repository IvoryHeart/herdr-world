import type { WorldSnapshotPriority } from "./snapshot";
import { nativeId } from "./snapshot-identity";

const MAX_PRIORITIES = 8;

function parsePriorities(value: unknown): WorldSnapshotPriority[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid World snapshot parameters");
  }
  const priorities = (value as Record<string, unknown>).priorities;
  if (priorities === undefined) return [];
  if (!Array.isArray(priorities) || priorities.length > MAX_PRIORITIES) {
    throw new Error("invalid World snapshot priorities");
  }
  const result: WorldSnapshotPriority[] = [];
  const seen = new Set<string>();
  for (const value of priorities) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid World snapshot priority");
    }
    const item = value as Record<string, unknown>;
    const connectionId = nativeId(item.connection_id);
    const workspaceId = nativeId(item.workspace_id);
    const paneId =
      item.pane_id === undefined ? undefined : nativeId(item.pane_id);
    const terminalId =
      item.terminal_id === undefined ? undefined : nativeId(item.terminal_id);
    if (
      !connectionId ||
      !workspaceId ||
      paneId === null ||
      terminalId === null
    ) {
      throw new Error("invalid World snapshot priority");
    }
    const priority = {
      connection_id: connectionId,
      workspace_id: workspaceId,
      ...(paneId ? { pane_id: paneId } : {}),
      ...(terminalId ? { terminal_id: terminalId } : {}),
    };
    const key = JSON.stringify(priority);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(priority);
  }
  return result;
}

export function parseSnapshotParameters(value: unknown) {
  const priorities = parsePriorities(value);
  const params = value as Record<string, unknown> | undefined;
  const selected = params?.selected_connection_id;
  if (
    params &&
    Object.prototype.hasOwnProperty.call(params, "selected_connection_id") &&
    !nativeId(selected)
  ) {
    throw new Error("invalid selected World connection");
  }
  return {
    priorities,
    selectedConnectionId: selected as string | undefined,
    priorityConnectionIds: parsePriorityConnections(
      params?.priority_connection_ids,
    ),
  };
}

function parsePriorityConnections(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128)
    throw new Error("invalid World priority connections");
  return [
    ...new Set(
      value.map((id) => {
        if (!nativeId(id) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id))
          throw new Error("invalid World priority connection");
        return id as string;
      }),
    ),
  ];
}
