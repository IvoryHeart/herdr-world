/** Bounded record selection and coverage counts for World snapshots. */
import { nativeId } from "./snapshot-identity";
import type {
  WorldAgentStatus,
  WorldAgentStatusCounts,
  WorldWorkspaceCoverage,
  WorldSnapshotCoverage,
} from "./snapshot-types";
import type { WorldRuntimeStatus } from "./runtime-registry";

export function records(value: unknown, key: string) {
  const records = (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(records)) return [];
  return records.filter(
    (record): record is Record<string, unknown> =>
      !!record && typeof record === "object" && !Array.isArray(record),
  );
}

export function boundedRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  priority: (record: Record<string, unknown>) => boolean,
) {
  if (records.length <= limit) return [...records];
  const admitted = new Set(
    [
      ...records.filter(priority),
      ...records.filter((record) => !priority(record)),
    ].slice(0, limit),
  );
  return records.filter((record) => admitted.has(record));
}

export function rankedRelevantRecords(
  records: readonly Record<string, unknown>[],
  relevance: (record: Record<string, unknown>) => readonly number[],
) {
  return records
    .map((record, index) => ({ record, index, relevance: relevance(record) }))
    .sort((left, right) => {
      const dimensions = Math.max(
        left.relevance.length,
        right.relevance.length,
      );
      for (let index = 0; index < dimensions; index += 1) {
        const difference =
          (right.relevance[index] ?? 0) - (left.relevance[index] ?? 0);
        if (difference !== 0) return difference;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}

export function boundedReservedRelevantRecords(
  records: readonly Record<string, unknown>[],
  limit: number,
  reserved: ReadonlySet<Record<string, unknown>>,
  relevance: (record: Record<string, unknown>) => readonly number[],
  group?: (record: Record<string, unknown>) => string | null,
  reservedGroups?: ReadonlySet<string>,
  reservationLimit = 0,
) {
  const admitted = new Set<Record<string, unknown>>([...reserved]);
  const ranked = rankedRelevantRecords(records, relevance);
  if (group && reservedGroups && reservationLimit > 0) {
    const groupCounts = new Map<string, number>();
    for (const record of ranked) {
      if (admitted.has(record)) continue;
      const groupId = group(record);
      if (!groupId || !reservedGroups.has(groupId)) continue;
      const count = groupCounts.get(groupId) ?? 0;
      if (count >= reservationLimit || admitted.size >= limit) continue;
      admitted.add(record);
      groupCounts.set(groupId, count + 1);
    }
  }
  for (const record of ranked) {
    if (admitted.size >= limit) break;
    admitted.add(record);
  }
  return records.filter((record) => admitted.has(record));
}

export function runtimeOf(status: WorldRuntimeStatus) {
  return status.runtime === "herdr-core" ? { runtime: status.runtime } : {};
}

function emptyStatusCounts(): WorldAgentStatusCounts {
  return { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
}

function agentStatus(value: unknown): WorldAgentStatus {
  if (value === "working" || value === "busy" || value === "running") {
    return "working";
  }
  if (value === "idle" || value === "waiting") return "idle";
  if (value === "blocked" || value === "error") return "blocked";
  if (value === "done" || value === "completed") return "done";
  return "unknown";
}

export function isAgentPane(pane: Record<string, unknown>) {
  return typeof pane.agent === "string" && pane.agent.trim().length > 0;
}

export function paneStatusPriority(pane: Record<string, unknown>) {
  const status = agentStatus(pane.agent_status);
  return status === "blocked"
    ? 3
    : status === "working"
      ? 2
      : status === "done"
        ? 1
        : 0;
}

type PaneParentRelevance = {
  focused: boolean;
  attention: boolean;
  agentCount: number;
};

export function paneParentRelevance(
  panes: readonly Record<string, unknown>[],
  parentKey: "workspace_id" | "tab_id",
) {
  const result = new Map<string, PaneParentRelevance>();
  for (const pane of panes) {
    const parentId = nativeId(pane[parentKey]);
    if (!parentId) continue;
    const current = result.get(parentId) ?? {
      focused: false,
      attention: false,
      agentCount: 0,
    };
    current.focused ||= pane.focused === true;
    current.attention ||= paneStatusPriority(pane) > 0;
    if (isAgentPane(pane)) current.agentCount += 1;
    result.set(parentId, current);
  }
  return result;
}

export function topologyCoverage(
  workspaces: readonly Record<string, unknown>[],
  tabs: readonly Record<string, unknown>[],
  panes: readonly Record<string, unknown>[],
  retainedWorkspaces: readonly Record<string, unknown>[],
): WorldSnapshotCoverage {
  const status = emptyStatusCounts();
  let agentPanes = 0;
  const workspaceCounts = new Map<
    string,
    Omit<WorldWorkspaceCoverage, "workspace_id">
  >();
  for (const workspace of retainedWorkspaces) {
    const workspaceId = nativeId(workspace.workspace_id);
    if (workspaceId && !workspaceCounts.has(workspaceId)) {
      workspaceCounts.set(workspaceId, {
        tabs: 0,
        panes: 0,
        agent_panes: 0,
        status: emptyStatusCounts(),
      });
    }
  }
  for (const tab of tabs) {
    const workspaceId = nativeId(tab.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.tabs += 1;
  }
  for (const pane of panes) {
    const workspaceId = nativeId(pane.workspace_id);
    const counts = workspaceId ? workspaceCounts.get(workspaceId) : undefined;
    if (counts) counts.panes += 1;
    if (!isAgentPane(pane)) continue;
    agentPanes += 1;
    const semanticStatus = agentStatus(pane.agent_status);
    status[semanticStatus] += 1;
    if (counts) {
      counts.agent_panes += 1;
      counts.status[semanticStatus] += 1;
    }
  }
  return {
    workspaces: workspaces.length,
    tabs: tabs.length,
    panes: panes.length,
    agent_panes: agentPanes,
    status,
    by_workspace: [...workspaceCounts].map(([workspace_id, counts]) => ({
      workspace_id,
      ...counts,
    })),
  };
}
