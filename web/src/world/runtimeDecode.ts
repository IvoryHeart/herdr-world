/** Decoding of one published World connection (runtimeStore.ts). */
import type { ConnectionLifecycleState } from "../api";
import type { Pane, Tab, Workspace } from "../types";
import type {
  WorldRuntimeConnection,
  WorldRuntimeCoverage,
  WorldRuntimeStatusCounts,
  WorldRuntimeWatchAdmission,
  WorldRuntimeWorkspaceCoverage,
} from "./runtimeStore";

const MAX_WORKSPACE_COVERAGE = 512;

export const CONNECTION_STATES = new Set<ConnectionLifecycleState>([
  "disconnected",
  "connecting",
  "ready",
  "reconnecting",
  "stopping",
  "error",
]);

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value)
    ? (value.filter((entry) => record(entry) !== null) as T[])
    : [];
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;
}

function parseStatusCounts(value: unknown): WorldRuntimeStatusCounts | null {
  const item = record(value);
  if (!item) return null;
  const working = count(item.working);
  const idle = count(item.idle);
  const blocked = count(item.blocked);
  const done = count(item.done);
  const unknown = count(item.unknown);
  return working === null ||
    idle === null ||
    blocked === null ||
    done === null ||
    unknown === null
    ? null
    : { working, idle, blocked, done, unknown };
}

function parseCoverage(value: unknown): WorldRuntimeCoverage | null {
  const item = record(value);
  if (!item || !Array.isArray(item.by_workspace)) return null;
  const workspaces = count(item.workspaces);
  const tabs = count(item.tabs);
  const panes = count(item.panes);
  const agentPanes = count(item.agent_panes);
  const status = parseStatusCounts(item.status);
  if (
    workspaces === null ||
    tabs === null ||
    panes === null ||
    agentPanes === null ||
    agentPanes > panes ||
    !status ||
    Object.values(status).reduce((total, value) => total + value, 0) !==
      agentPanes ||
    item.by_workspace.length > MAX_WORKSPACE_COVERAGE
  ) {
    return null;
  }
  const seen = new Set<string>();
  const byWorkspace: WorldRuntimeWorkspaceCoverage[] = [];
  for (const value of item.by_workspace) {
    const workspace = record(value);
    if (!workspace || typeof workspace.workspace_id !== "string") return null;
    const workspaceTabs = count(workspace.tabs);
    const workspacePanes = count(workspace.panes);
    const workspaceAgentPanes = count(workspace.agent_panes);
    const workspaceStatus = parseStatusCounts(workspace.status);
    if (
      !workspace.workspace_id ||
      seen.has(workspace.workspace_id) ||
      workspaceTabs === null ||
      workspacePanes === null ||
      workspaceAgentPanes === null ||
      workspaceAgentPanes > workspacePanes ||
      !workspaceStatus ||
      Object.values(workspaceStatus).reduce(
        (total, statusCount) => total + statusCount,
        0,
      ) !== workspaceAgentPanes
    ) {
      return null;
    }
    seen.add(workspace.workspace_id);
    byWorkspace.push({
      workspaceId: workspace.workspace_id,
      tabs: workspaceTabs,
      panes: workspacePanes,
      agentPanes: workspaceAgentPanes,
      status: workspaceStatus,
    });
  }
  return { workspaces, tabs, panes, agentPanes, status, byWorkspace };
}

function parseWatchAdmission(
  value: unknown,
): WorldRuntimeWatchAdmission | null {
  const item = record(value);
  if (!item) return null;
  const revision = count(item.revision);
  const registered = count(item.registered);
  const missing = count(item.missing);
  const unresolved = count(item.unresolved);
  const matched = count(item.matched);
  const admitted = count(item.admitted);
  const admissionFailed = count(item.admission_failed);
  if (
    revision === null ||
    registered === null ||
    missing === null ||
    unresolved === null ||
    matched === null ||
    admitted === null ||
    admissionFailed === null ||
    registered !== missing + unresolved + matched ||
    matched !== admitted + admissionFailed
  )
    return null;
  return {
    revision,
    registered,
    missing,
    unresolved,
    matched,
    admitted,
    admissionFailed,
  };
}

export function parseConnection(value: unknown): WorldRuntimeConnection | null {
  const item = record(value);
  if (
    !item ||
    typeof item.connection_id !== "string" ||
    item.connection_id.length === 0 ||
    typeof item.label !== "string" ||
    typeof item.source !== "string" ||
    typeof item.is_default !== "boolean" ||
    typeof item.state !== "string" ||
    !CONNECTION_STATES.has(item.state as ConnectionLifecycleState) ||
    !Number.isSafeInteger(item.generation) ||
    (item.generation as number) < 0 ||
    (item.snapshot_generation !== null &&
      (!Number.isSafeInteger(item.snapshot_generation) ||
        (item.snapshot_generation as number) < 0)) ||
    typeof item.stale !== "boolean" ||
    typeof item.actionable !== "boolean"
  ) {
    return null;
  }
  const rawSnapshot = item.snapshot === null ? null : record(item.snapshot);
  if (item.snapshot !== null && !rawSnapshot) return null;
  const coverage = rawSnapshot ? parseCoverage(rawSnapshot.coverage) : null;
  const watchAdmission =
    rawSnapshot?.watch_admission === undefined
      ? undefined
      : parseWatchAdmission(rawSnapshot.watch_admission);
  if (rawSnapshot && !coverage) return null;
  if (rawSnapshot?.watch_admission !== undefined && !watchAdmission)
    return null;
  const error = record(item.error)?.message;
  return {
    connectionId: item.connection_id,
    label: item.label,
    source: item.source,
    ...(item.runtime === "herdr-core"
      ? { runtime: "herdr-core" as const }
      : {}),
    isDefault: item.is_default,
    state: item.state as ConnectionLifecycleState,
    generation: item.generation as number,
    snapshotGeneration: item.snapshot_generation as number | null,
    stale: item.stale,
    actionable: item.actionable,
    ...(typeof error === "string" ? { error } : {}),
    ...(typeof item.snapshot_error === "string"
      ? { snapshotError: item.snapshot_error }
      : {}),
    snapshot: rawSnapshot
      ? {
          workspaces: records<Workspace>(rawSnapshot.workspaces),
          tabs: records<Tab>(rawSnapshot.tabs),
          panes: records<Pane>(rawSnapshot.panes),
          agents: records<Record<string, unknown>>(rawSnapshot.agents),
          coverage: coverage!,
          ...(watchAdmission ? { watchAdmission } : {}),
        }
      : null,
  };
}
