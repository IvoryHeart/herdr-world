import { normalizeAgentName } from "../agent/chat-harnesses";
import type { AgentsPort } from "../storage/agent-store";
import {
  agentObservationAmbiguous,
  conversationStates,
  deriveAgentState,
  resolveAgentObservation,
  type AgentConnectionView,
  type AgentObservation,
  type AgentOccupant,
  type AgentState,
} from "./agent-resolver";
import type {
  WorldAgentEntry,
  WorldConnectionSnapshot,
} from "./snapshot-types";

type Row = Record<string, unknown>;

const text = (value: unknown) =>
  typeof value === "string" && value ? value : null;

/**
 * One complete native pane listing as the resolver reads it. A row without
 * a terminal ID cannot witness a seat, so the whole listing is unusable.
 * The conversation is set only from the runtime's own session report.
 */
function agentObservation(
  connectionId: string,
  generation: number,
  panes: readonly Row[],
): AgentObservation | null {
  const terminals: string[] = [];
  const occupants: AgentOccupant[] = [];
  for (const pane of panes) {
    const terminal = text(pane.terminal_id);
    if (!terminal) return null;
    terminals.push(terminal);
    const agent = text(pane.agent);
    if (!agent) continue;
    const harness = normalizeAgentName(agent);
    const session = pane.agent_session as Row | undefined;
    const id = session && session.kind === "id" ? text(session.value) : null;
    occupants.push({
      terminal_id: terminal,
      harness,
      folder: text(pane.cwd) ?? text(pane.foreground_cwd),
      conversation: id ? `${harness}/${id}` : null,
      source: id ? (text(session!.source) ?? null) : null,
    });
  }
  return { connection_id: connectionId, generation, terminals, occupants };
}

type View = AgentConnectionView & { generation: number };

/**
 * World's agents beside its topology (world-agent-identity tasks 4 and 6).
 * Each complete, current listing is resolved and committed by the store's
 * single writer, and a commit that changed a record publishes one World
 * revision. Live, away and unresolved are derived on each reply from the
 * stored record and the newest listing of the seat's connection, and a
 * terminal row is attributed to the agent seated in it.
 */
export function createAgentRecords(deps: {
  port(): AgentsPort | undefined;
  /** The adapter that read a connection: `herdr` or `herdr-core`. */
  adapter(connectionId: string): string;
  /** The read's lease is still the connection's current one. */
  isCurrent(connectionId: string, generation: number): boolean;
  publish(): void;
  log(message: string): void;
}) {
  const views = new Map<string, View>();
  const pending = new Map<string, AgentObservation>();
  let running = false;

  const drain = async () => {
    if (running) return;
    running = true;
    try {
      for (const [id, observation] of pending) {
        pending.delete(id);
        const port = deps.port();
        if (
          !port ||
          !deps.isCurrent(id, observation.generation) ||
          !resolveAgentObservation(port.list(), observation).length
        )
          continue;
        try {
          const changed = await port.observe(deps.adapter(id), observation);
          if (changed.length) deps.publish();
        } catch (error) {
          deps.log(`World agents not recorded: ${String(error)}`);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    /** A complete pane listing admitted for a connection (both runtimes). */
    observeComplete(
      connectionId: string,
      generation: number,
      panes: readonly Row[],
    ) {
      const observation = agentObservation(connectionId, generation, panes);
      if (!observation || agentObservationAmbiguous(observation)) {
        // World cannot tell: every agent seated here is unresolved.
        views.delete(connectionId);
        pending.delete(connectionId);
        return;
      }
      views.set(connectionId, {
        generation,
        current: true,
        occupants: new Map([
          ...observation.terminals.map((t) => [t, null] as const),
          ...observation.occupants.map(
            (o) => [o.terminal_id, o.harness] as const,
          ),
        ]),
      });
      pending.set(connectionId, observation);
      void drain();
    },

    /**
     * The reply's agents and its terminal rows attributed to them, from the
     * records committed now and the connections this reply carries.
     */
    publish(connections: readonly WorldConnectionSnapshot[]): {
      agents: WorldAgentEntry[];
      connections: WorldConnectionSnapshot[];
    } {
      const records = deps.port()?.list() ?? [];
      const published = new Map(connections.map((c) => [c.connection_id, c]));
      const current = new Map<string, AgentConnectionView>();
      for (const [id, view] of views) {
        const connection = published.get(id);
        current.set(id, {
          occupants: view.occupants,
          current:
            !!connection &&
            connection.state === "ready" &&
            !connection.stale &&
            connection.generation === view.generation &&
            connection.snapshot_generation === view.generation,
        });
      }
      const states = new Map<string, AgentState>(
        records.map((agent) => [agent.id, deriveAgentState(agent, current)]),
      );
      const conversations = conversationStates(records, states);
      const seated = new Map<string, string>();
      for (const agent of records)
        if (agent.seat && states.get(agent.id) !== "ended")
          seated.set(
            JSON.stringify([agent.seat.connection_id, agent.seat.terminal_id]),
            agent.id,
          );
      const rowAgent = (connectionId: string, row: Row) =>
        typeof row.terminal_id === "string"
          ? seated.get(JSON.stringify([connectionId, row.terminal_id]))
          : undefined;
      const attributed = connections.map((connection) => {
        const snapshot = connection.snapshot;
        if (!snapshot) return connection;
        const attribute = (rows: Row[]) =>
          rows.map((row) => {
            const agent = rowAgent(connection.connection_id, row);
            return agent ? { ...row, agent_id: agent } : row;
          });
        return {
          ...connection,
          snapshot: {
            ...snapshot,
            panes: attribute(snapshot.panes),
            agents: attribute(snapshot.agents),
          },
        };
      });
      const paneOf = (connectionId: string, terminal: string) =>
        published
          .get(connectionId)
          ?.snapshot?.panes.find((row) => row.terminal_id === terminal);
      /** The seat's runtime name: its tab's, else its pane's. */
      const runtimeName = (connectionId: string, pane: Row) =>
        text(
          published
            .get(connectionId)
            ?.snapshot?.tabs.find((tab) => tab.tab_id === pane.tab_id)?.label,
        ) ?? text(pane.label);
      const agents = records.map((agent): WorldAgentEntry => {
        const state = states.get(agent.id)!;
        const pane = agent.seat
          ? paneOf(agent.seat.connection_id, agent.seat.terminal_id)
          : undefined;
        return {
          agent_id: agent.id,
          state,
          harness: agent.harness,
          folder: agent.folder,
          // Until World stores a name, it is the seat's runtime name.
          name:
            state === "live" && pane
              ? runtimeName(agent.seat!.connection_id, pane)
              : null,
          conversation: {
            state: conversations.get(agent.id) ?? "unknown",
            item: agent.conversation,
          },
          seat: agent.seat
            ? {
                connection_id: agent.seat.connection_id,
                terminal_id: agent.seat.terminal_id,
                ...(pane && typeof pane.pane_id === "string"
                  ? { pane_id: pane.pane_id }
                  : {}),
                ...(pane && typeof pane.tab_id === "string"
                  ? { tab_id: pane.tab_id }
                  : {}),
                ...(pane && typeof pane.workspace_id === "string"
                  ? { workspace_id: pane.workspace_id }
                  : {}),
              }
            : null,
        };
      });
      return { agents, connections: attributed };
    },
  };
}
