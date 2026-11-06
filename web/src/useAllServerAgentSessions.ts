import { useMemo } from "react";
import type { ConnectionSummary } from "./api";
import { withAgentActivity } from "./agentOrder";
import { paneHasAgentHistory } from "./components/agentSession";
import { shallowEqual, store, useStoreSelector } from "./store";
import type { Pane, Tab, Workspace } from "./types";
import { workspaceDisplayName } from "./workspaceTreeBadges";
import {
  useWorldRuntime,
  type WorldRuntimeConnection,
} from "./world/runtimeStore";

export interface ConnectionAgentSessions {
  connection_id: string;
  connection_generation: number;
  workspaces: Workspace[];
  tabs: Tab[];
  panes: Pane[];
  agents: unknown;
  error?: string;
}

export interface ServerAgentPane extends Pane {
  connectionId: string;
  runtimeGeneration: number;
  serverLabel: string;
  workspaceKey: string;
  workspaceLabel: string;
  tabLabel: string;
}

export type ServerSessionSource = Pick<
  ServerAgentPane,
  "connectionId" | "runtimeGeneration" | "serverLabel"
>;

export function isServerSourceAvailable(source: ServerSessionSource): boolean {
  return store
    .get()
    .connections.some(
      (connection) =>
        connection.id === source.connectionId &&
        connection.generation === source.runtimeGeneration &&
        connection.state === "ready",
    );
}

export async function openServerSession(
  source: ServerSessionSource,
  workspaceId: string,
  paneId?: string,
): Promise<boolean> {
  const opened =
    isServerSourceAvailable(source) &&
    (await store.focusWorkspaceSource(
      {
        connectionId: source.connectionId,
        runtimeGeneration: source.runtimeGeneration,
        workspaceId,
        paneId,
      },
      // Picked from a list on screen: shown at once, checked after.
      { fromKnownList: true },
    ));
  if (!opened) store.notify({ kind: "error", message: "Session unavailable." });
  return opened;
}

export function allServerAgentPanes(
  connections: readonly ConnectionSummary[],
  snapshots: readonly ConnectionAgentSessions[],
): ServerAgentPane[] {
  return connections.flatMap((connection) => {
    const snapshot = snapshots.find(
      (entry) =>
        entry.connection_id === connection.id &&
        entry.connection_generation === connection.generation,
    );
    if (connection.state !== "ready" || !snapshot || snapshot.error) return [];
    const workspaces = new Map(
      snapshot.workspaces.map((workspace) => [
        workspace.workspace_id,
        workspace,
      ]),
    );
    const tabs = new Map(snapshot.tabs.map((tab) => [tab.tab_id, tab]));
    return withAgentActivity(snapshot.panes, snapshot.agents)
      .filter(paneHasAgentHistory)
      .sort(
        (left, right) =>
          (workspaces.get(left.workspace_id)?.number ?? 0) -
          (workspaces.get(right.workspace_id)?.number ?? 0),
      )
      .map((pane) => {
        const workspace = workspaces.get(pane.workspace_id);
        const tab = tabs.get(pane.tab_id);
        return {
          ...pane,
          connectionId: connection.id,
          runtimeGeneration: connection.generation,
          serverLabel: connection.label,
          workspaceKey: JSON.stringify([
            connection.id,
            connection.generation,
            pane.workspace_id,
          ]),
          workspaceLabel: workspace
            ? workspaceDisplayName(workspace)
            : pane.workspace_id,
          tabLabel: tab?.workspace_id === pane.workspace_id ? tab.label : "",
        };
      });
  });
}

/**
 * Every connection's read-only topology, from World's aggregate observation
 * rather than a second all-connection poller (Roamgate #494 polled
 * connections.agent_sessions; World already observes every runtime, bounded
 * and qualified by connection and generation). Only actionable entries
 * observed at their connection's current generation are offered; stale
 * cached hosts stay out of this list.
 */
export function worldAgentSessions(
  connections: readonly WorldRuntimeConnection[],
): ConnectionAgentSessions[] {
  return connections.flatMap((connection) =>
    connection.snapshot &&
    connection.actionable &&
    !connection.stale &&
    connection.snapshotGeneration === connection.generation
      ? [
          {
            connection_id: connection.connectionId,
            connection_generation: connection.generation,
            workspaces: connection.snapshot.workspaces,
            tabs: connection.snapshot.tabs,
            panes: connection.snapshot.panes,
            agents: connection.snapshot.agents,
          },
        ]
      : [],
  );
}

export function useAllServerAgentSessions(enabled: boolean) {
  const state = useStoreSelector(
    (snapshot) => ({
      connections: snapshot.connections,
      status: snapshot.status,
      paused: snapshot.connectionPaused,
    }),
    shallowEqual,
  );
  const world = useWorldRuntime();
  const connected = state.status === "connected" && !state.paused;
  // A failed observation shows its error, not the last rows it replaced.
  const failed = world.status === "error";
  const snapshots = useMemo(
    () =>
      enabled && connected && !failed
        ? worldAgentSessions(world.connections)
        : [],
    [enabled, connected, failed, world.connections],
  );
  const loading =
    enabled &&
    connected &&
    (world.status === "idle" || world.status === "loading");
  // Stable while its inputs are: Pane Search derives its options from these
  // panes, and a new array on every render re-ran its selection effects and
  // undid arrow-key moves.
  const panes = useMemo(
    () => (connected ? allServerAgentPanes(state.connections, snapshots) : []),
    [connected, state.connections, snapshots],
  );
  const messages = !connected
    ? [state.paused ? "Connection paused." : "Connect to load sessions."]
    : failed
      ? [`Could not load sessions: ${world.error ?? "unavailable"}`]
      : [];
  return { panes, snapshots, loading, messages };
}
