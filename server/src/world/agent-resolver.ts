/**
 * The agent resolver: which World agent each harness occupant of a runtime
 * listing is, under the seat binding's rules (world-agent-identity design §2).
 *
 * Pure: it reads the stored agents and one observation and returns the store
 * changes. The agent store applies them in one transaction of the World
 * store's single writer; live, away and unresolved are derived on each reply
 * (`deriveAgentStates`) and never stored. Continuity comes only from the
 * witnessed terminal in a current, complete listing of the same connection.
 * Names, folders, harness kinds, reused pane IDs and runtime generations never
 * prove it, and an ended agent never returns.
 */

/** A seat: the terminal one agent runs in, on one connection. */
type AgentSeat = {
  binding_id: string;
  connection_id: string;
  terminal_id: string;
};

/** What World keeps of an agent: its ID, observed labels, conversation and seat. */
export type AgentRecord = {
  id: string;
  created_at: number;
  /** The user's End, or a close with no conversation to resume. Final. */
  ended_at: number | null;
  harness: string;
  folder: string | null;
  /** The current conversation item (`<harness>/<conversation ID>`), if known. */
  conversation: string | null;
  /** Null when no terminal runs the agent now: away, or ended. */
  seat: AgentSeat | null;
};

/** One harness occupant of a listed terminal. */
export type AgentOccupant = {
  terminal_id: string;
  harness: string;
  folder: string | null;
  /** `<harness>/<conversation ID>` from a source naming the process's own conversation. */
  conversation: string | null;
  /** The source that named it, kept with the conversation's history entry. */
  source: string | null;
};

/** One complete native listing of one connection, as it was read. */
export type AgentObservation = {
  connection_id: string;
  generation: number;
  /** Every listed terminal, duplicates kept. */
  terminals: readonly string[];
  occupants: readonly AgentOccupant[];
};

export type AgentChange =
  | {
      type: "create";
      terminal_id: string;
      harness: string;
      folder: string | null;
      conversation: string | null;
    }
  | { type: "folder"; agent: string; folder: string | null }
  | { type: "conversation"; agent: string; conversation: string | null }
  /** No terminal runs it now; its conversation is known, so it can resume. */
  | { type: "leave"; agent: string }
  /** It left with nothing to resume: final. */
  | { type: "end"; agent: string };

export type AgentState = "live" | "away" | "unresolved" | "ended";

const held = (agent: AgentRecord) => agent.ended_at === null && !!agent.seat;

/**
 * A listing that shows a terminal twice, or an occupant of a terminal it
 * does not list, is ambiguous: nothing attaches, moves or ends.
 */
export function agentObservationAmbiguous(observation: AgentObservation) {
  const listed = new Set(observation.terminals);
  const occupied = new Set(observation.occupants.map((o) => o.terminal_id));
  return (
    listed.size !== observation.terminals.length ||
    occupied.size !== observation.occupants.length ||
    [...occupied].some((terminal) => !listed.has(terminal))
  );
}

/** The occupant that keeps this agent's seat: its terminal, its harness. */
function occupantOf(agent: AgentRecord, observation: AgentObservation) {
  const occupant = observation.occupants.find(
    (o) => o.terminal_id === agent.seat!.terminal_id,
  );
  return occupant && occupant.harness === agent.harness ? occupant : null;
}

/**
 * The store changes one complete observation proves. An ambiguous listing
 * proves nothing. Held agents on this connection stay where their harness
 * still runs, and otherwise leave (away) or end (nothing to resume). Every
 * occupant of a terminal no held agent keeps is a new agent: a conversation
 * that an away agent ran is offered (`agentOffers`), never merged.
 */
export function resolveAgentObservation(
  agents: readonly AgentRecord[],
  observation: AgentObservation,
): AgentChange[] {
  if (agentObservationAmbiguous(observation)) return [];
  const changes: AgentChange[] = [];
  const kept = new Set<string>();
  for (const agent of agents) {
    if (!held(agent) || agent.seat!.connection_id !== observation.connection_id)
      continue;
    const occupant = occupantOf(agent, observation);
    if (!occupant) {
      changes.push({
        type: agent.conversation ? "leave" : "end",
        agent: agent.id,
      });
      continue;
    }
    kept.add(occupant.terminal_id);
    if (occupant.folder !== agent.folder)
      changes.push({
        type: "folder",
        agent: agent.id,
        folder: occupant.folder,
      });
    if (occupant.conversation !== agent.conversation)
      changes.push({
        type: "conversation",
        agent: agent.id,
        conversation: occupant.conversation,
      });
  }
  for (const occupant of observation.occupants)
    if (!kept.has(occupant.terminal_id))
      changes.push({
        type: "create",
        terminal_id: occupant.terminal_id,
        harness: occupant.harness,
        folder: occupant.folder,
        conversation: occupant.conversation,
      });
  return changes;
}

/** The newest listing World holds for a connection, as a reply sees it. */
export type AgentConnectionView = {
  /** The listing's generation is the connection's current, fresh one. */
  current: boolean;
  /** Terminals listed exactly once, each with its harness occupant if any. */
  occupants: ReadonlyMap<string, string | null>;
};

/**
 * Live, away, unresolved or ended, derived from the stored record and the
 * newest listing of its seat's connection. Without a current listing (World
 * just started, the host is offline, stale or reconnected), or when that
 * listing does not show its harness in its terminal exactly once, a held
 * agent is unresolved: World cannot tell, and nothing changes.
 */
export function deriveAgentState(
  agent: AgentRecord,
  views: ReadonlyMap<string, AgentConnectionView>,
): AgentState {
  if (agent.ended_at !== null) return "ended";
  if (!agent.seat) return "away";
  const view = views.get(agent.seat.connection_id);
  return view?.current &&
    view.occupants.get(agent.seat.terminal_id) === agent.harness
    ? "live"
    : "unresolved";
}

export type ConversationState = "known" | "unknown" | "conflict";

/** A conversation two live agents claim is in conflict for both. */
export function conversationStates(
  agents: readonly AgentRecord[],
  states: ReadonlyMap<string, AgentState>,
): Map<string, ConversationState> {
  const claims = new Map<string, number>();
  for (const agent of agents)
    if (agent.conversation && states.get(agent.id) === "live")
      claims.set(agent.conversation, (claims.get(agent.conversation) ?? 0) + 1);
  return new Map(
    agents.map((agent) => [
      agent.id,
      !agent.conversation
        ? "unknown"
        : states.get(agent.id) === "live" &&
            (claims.get(agent.conversation) ?? 0) > 1
          ? "conflict"
          : "known",
    ]),
  );
}

/**
 * "Same agent as …?": a live agent whose conversation exactly one away agent
 * ran is offered as that agent. Only the user's choice binds it (task 9).
 * @internal the model adapter and tests read it until task 9 publishes it.
 */
export function agentOffers(
  agents: readonly AgentRecord[],
  states: ReadonlyMap<string, AgentState>,
): Map<string, string> {
  const offers = new Map<string, string>();
  for (const agent of agents) {
    if (states.get(agent.id) !== "live" || !agent.conversation) continue;
    const owners = agents.filter(
      (other) =>
        states.get(other.id) === "away" &&
        other.conversation === agent.conversation,
    );
    if (owners.length === 1) offers.set(agent.id, owners[0]!.id);
  }
  return offers;
}
