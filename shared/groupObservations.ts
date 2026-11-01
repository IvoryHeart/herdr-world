import { groupObject } from "./groups";
import type { GroupConnectionObservation } from "./groupViews";

type AgentSession = {
  source: string;
  agent: string;
  kind: string;
  value: string;
};
export type GroupTopologyConnection = {
  connectionId: string;
  generation: number;
  snapshotGeneration: number | null;
  state: string;
  stale: boolean;
  actionable: boolean;
  snapshot: {
    workspaces: readonly unknown[];
    tabs: readonly unknown[];
    panes: readonly unknown[];
    agents: readonly unknown[];
  } | null;
};

const text = (value: unknown, max = 512): string | undefined =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/\p{Cc}/u.test(value)
    ? value
    : undefined;
function records(values: readonly unknown[] | undefined) {
  return (values ?? []).filter(groupObject);
}
function session(value: unknown): AgentSession | null {
  if (!groupObject(value)) return null;
  const { source, agent, kind, value: identity } = value;
  return typeof source === "string" &&
    source &&
    typeof agent === "string" &&
    agent &&
    typeof kind === "string" &&
    kind &&
    typeof identity === "string" &&
    identity
    ? { source, agent, kind, value: identity }
    : null;
}
function sameSession(left: AgentSession, right: AgentSession) {
  return (
    left.source === right.source &&
    left.agent === right.agent &&
    left.kind === right.kind &&
    left.value === right.value
  );
}

/** Shared admission; callers supply their existing synchronous session hash. */
export function observeGroupTopology(
  connections: readonly GroupTopologyConnection[],
  fingerprint: (session: AgentSession) => string,
): GroupConnectionObservation[] {
  return connections.map((connection) => {
    const snapshot = connection.snapshot;
    const agentsByPane = new Map<string, Record<string, unknown>[]>();
    for (const agent of records(snapshot?.agents)) {
      const id = text(agent.pane_id);
      if (!id) continue;
      const agents = agentsByPane.get(id) ?? [];
      agents.push(agent);
      agentsByPane.set(id, agents);
    }
    return {
      connectionId: connection.connectionId,
      generation: connection.generation,
      current:
        snapshot !== null &&
        connection.state === "ready" &&
        connection.actionable &&
        !connection.stale &&
        connection.snapshotGeneration === connection.generation,
      rooms: records(snapshot?.workspaces).flatMap((workspace) => {
        const id = text(workspace.workspace_id);
        return id ? [{ id, label: text(workspace.label, 1000) ?? id }] : [];
      }),
      desks: records(snapshot?.tabs).flatMap((tab) => {
        const id = text(tab.tab_id);
        const roomId = text(tab.workspace_id);
        return id && roomId
          ? [{ id, roomId, label: text(tab.label, 1000) ?? id }]
          : [];
      }),
      terminals: records(snapshot?.panes).flatMap((pane) => {
        const terminalId = text(pane.terminal_id);
        const paneId = text(pane.pane_id);
        const roomId = text(pane.workspace_id);
        const deskId = text(pane.tab_id);
        if (!terminalId || !paneId || !roomId || !deskId) return [];
        const currentSession = session(pane.agent_session);
        const candidates = text(pane.agent)
          ? (agentsByPane.get(paneId) ?? []).filter(
              (agent) =>
                (typeof agent.terminal_id !== "string" ||
                  agent.terminal_id === terminalId) &&
                (typeof agent.agent !== "string" || agent.agent === pane.agent),
            )
          : [];
        const currentCandidates = candidates.filter((agent) => {
          if (
            pane.agent_session === undefined &&
            agent.agent_session === undefined
          )
            return true;
          if (!currentSession) return false;
          if (agent.agent_session === undefined) return true;
          const observedSession = session(agent.agent_session);
          return Boolean(
            observedSession && sameSession(currentSession, observedSession),
          );
        });
        const names = new Set(
          currentCandidates.flatMap((agent) => {
            const name = text(agent.name, 240);
            return name ? [name] : [];
          }),
        );
        const sessionCurrent =
          currentSession &&
          (candidates.length === 0 || currentCandidates.length > 0);
        return [
          {
            terminalId,
            paneId,
            roomId,
            deskId,
            ...(names.size === 1 ? { name: [...names][0]! } : {}),
            status: text(pane.agent_status, 64) ?? "unknown",
            ...(sessionCurrent
              ? { sessionFingerprint: fingerprint(currentSession) }
              : {}),
          },
        ];
      }),
    };
  });
}
