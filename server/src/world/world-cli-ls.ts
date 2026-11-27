import type { WorldSnapshotResult } from "./snapshot";

/**
 * `herdr-world ls`: each connection's rooms, tabs and panes; the hosts World
 * holds; and the hosts (machines) World published, the ones every view
 * lists, with how many Town buildings "Group runtimes" draws.
 */
export function worldLs(snapshot: WorldSnapshotResult) {
  const connections = snapshot.connections.map((connection) => ({
    connection_id: connection.connection_id,
    connection_generation: connection.generation,
    label: connection.label,
    generation: connection.generation,
    current: connection.actionable && !connection.stale,
    workspaces: (connection.snapshot?.workspaces ?? []).map((ws) => ({
      workspace_id: ws.workspace_id,
      label: ws.label,
      tabs: (connection.snapshot?.tabs ?? [])
        .filter((tab) => tab.workspace_id === ws.workspace_id)
        .map((tab) => ({
          tab_id: tab.tab_id,
          label: tab.label,
          panes: (connection.snapshot?.panes ?? [])
            .filter((pane) => pane.tab_id === tab.tab_id)
            .map((pane) => ({
              pane_id: pane.pane_id,
              ...(pane.agent ? { agent: pane.agent } : {}),
              status: pane.agent_status,
            })),
        })),
    })),
  }));
  // The hosts (machines) every view lists, as World published them, each
  // runtime with the Town building "Group runtimes" draws it in.
  const grouping = snapshot.host_grouping;
  const buildingOf = new Map(
    (grouping?.groups ?? []).flatMap((group) =>
      group.members.map((member) => [member.connection_id, group.key] as const),
    ),
  );
  const groups = grouping?.hosts.map((group) => ({
    key: group.key,
    label: group.label,
    runtimes: group.members.map((member) => ({
      ...member,
      building: buildingOf.get(member.connection_id) ?? null,
      ...connections.find(
        (connection) => connection.connection_id === member.connection_id,
      ),
    })),
  }));
  return snapshot.hosts || grouping
    ? {
        ...(grouping
          ? {
              grouping: grouping.grouping,
              buildings: grouping.groups.length,
              groups,
            }
          : {}),
        hosts: (snapshot.hosts ?? []).map((host) => ({
          ...host,
          runtimes: host.runtimes.map((runtime) => ({
            ...runtime,
            ...connections.find(
              (connection) =>
                connection.connection_id === runtime.connection_id,
            ),
          })),
        })),
        connections,
      }
    : connections;
}
