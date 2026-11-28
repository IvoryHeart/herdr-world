import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentsPort,
  type AgentsPort,
} from "../server/src/storage/agent-store";
import type { StorageRequest } from "../server/src/storage/world-protocol";
import { openWorldWriter } from "../server/src/storage/world-writer";
import { createAgentRecords } from "../server/src/world/agent-records";
import {
  agentOffers,
  type AgentState,
} from "../server/src/world/agent-resolver";
import type {
  WorldAgentEntry,
  WorldConnectionSnapshot,
} from "../server/src/world/snapshot-types";

/**
 * Replay of the agent-identity scenarios (quint/agent-identity.qnt) through
 * the real pieces: World's single writer over a temporary world.sqlite, the
 * agent store's port, and the agent records that resolve each complete
 * listing and derive each reply's states. The runtime is synthetic: one
 * Herdr connection whose terminals and harness conversations the scenario
 * drives, exactly like the model's runtime events. The model's
 * `observeComplete` then `admit` is one complete listing here: World admits
 * newcomers in the same commit. World's own resume and move and the user's
 * confirmation are not built yet (world-agent-identity tasks 8 and 9), so
 * the scenarios that end with them replay up to that step.
 */

type Implementation = {
  createAgentRecords: typeof createAgentRecords;
  agentOffers: typeof agentOffers;
};
const real: Implementation = { createAgentRecords, agentOffers };

const HOST = "synthetic-host";

/** The synthetic runtime: terminals by model number, each with a harness. */
function runtime() {
  let issued = 0;
  const state = {
    generation: 1,
    terminals: new Map<
      number,
      { id: string; occupied: boolean; conversation: number }
    >(),
    /** The next listing repeats this terminal (the model's duplicate). */
    duplicate: null as number | null,
  };
  const panes = () => {
    const rows: Record<string, unknown>[] = [...state.terminals.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, terminal]) => ({
        workspace_id: "w1",
        tab_id: `w1:t${number}`,
        pane_id: `w1:p${number}`,
        terminal_id: terminal.id,
        ...(terminal.occupied
          ? {
              agent: "claude",
              ...(terminal.conversation
                ? {
                    agent_session: {
                      source: "herdr:claude",
                      agent: "claude",
                      kind: "id",
                      value: `c${terminal.conversation}`,
                    },
                  }
                : {}),
            }
          : {}),
      }));
    const copy = rows.find(
      (row) =>
        state.duplicate !== null &&
        row.terminal_id === state.terminals.get(state.duplicate)?.id,
    );
    return copy ? [...rows, { ...copy, pane_id: "w1:copy" }] : rows;
  };
  return {
    state,
    panes,
    open(t: number) {
      state.terminals.set(t, {
        id: `term-${++issued}`,
        occupied: false,
        conversation: 0,
      });
    },
    start(t: number, conversation: number) {
      Object.assign(state.terminals.get(t)!, { occupied: true, conversation });
    },
    converse(t: number, conversation: number) {
      state.terminals.get(t)!.conversation = conversation;
    },
    close(t: number) {
      state.terminals.delete(t);
    },
    /** The runtime restarts: every terminal is gone, a new generation. */
    restart() {
      state.terminals.clear();
      state.generation += 1;
    },
  };
}

/** World: its writer, store port and agent records, restartable. */
function world(impl: Implementation, root: string) {
  const database = join(root, "world.sqlite");
  let writer!: ReturnType<typeof openWorldWriter>;
  let port!: AgentsPort;
  let last: Promise<unknown> = Promise.resolve();
  let records!: ReturnType<typeof createAgentRecords>;
  let now = 1_000;
  const start = (generation: () => number) => {
    writer = openWorldWriter(
      database,
      join(root, "ledger.json"),
      now,
      "synthetic",
    );
    const opened = writer;
    const inner = createAgentsPort(
      opened.read().agents ?? [],
      async <T>(request: StorageRequest) => {
        const [result] = opened.batch([{ ticket: 0, request }], (now += 1));
        if (result!.error) throw new Error(result!.error);
        return result!.result as T;
      },
    );
    port = {
      ...inner,
      observe: (adapter, observation) =>
        (last = inner.observe(adapter, observation)) as never,
    };
    records = impl.createAgentRecords({
      port: () => port,
      adapter: () => "herdr",
      isCurrent: (_id, at) => at === generation(),
      publish: () => {},
      log: (message) => {
        throw new Error(message);
      },
    });
  };
  return {
    start,
    stop() {
      port.close();
      writer.close();
    },
    async observe(generation: number, panes: Record<string, unknown>[]) {
      records.observeComplete(HOST, generation, panes);
      await last;
    },
    publish(generation: number, panes: Record<string, unknown>[]) {
      const connection: WorldConnectionSnapshot = {
        connection_id: HOST,
        label: "Synthetic host",
        source: "saved-profile",
        is_default: false,
        state: "ready",
        generation,
        snapshot_generation: generation,
        stale: false,
        actionable: true,
        snapshot: {
          workspaces: [{ workspace_id: "w1", label: "Room" }],
          tabs: [],
          panes,
          agents: [],
        } as never,
      };
      return records.publish([connection]);
    },
    list: () => port.list(),
  };
}

export const identityScenarios = [
  "renamedOrRestartedKeepsAgent",
  "newConversationKeepsAgent",
  "runtimeRestartLeavesAgentAway",
  "resumeByHandIsOfferedNotMerged",
  "duplicateBindsNothing",
  "sameConversationTwiceConflicts",
  "emptyConversationEndsOnClose",
] as const;
export type IdentityScenario = (typeof identityScenarios)[number];

/** Replay one model scenario; throws `agent-identity.<scenario>` on divergence. */
export async function replayAgentIdentity(
  scenario: IdentityScenario,
  impl: Implementation = real,
) {
  const root = mkdtempSync(join(tmpdir(), "agent-identity-"));
  const rt = runtime();
  const w = world(impl, root);
  const check = (condition: unknown, what: string) =>
    assert(condition, `agent-identity.${scenario}: ${what}`);
  /** Agent IDs in issue order: model agent n is issued[n - 1]. */
  const issued: string[] = [];
  const ended = new Set<string>();
  let agents: WorldAgentEntry[] = [];
  const read = () => {
    agents = w.publish(rt.state.generation, rt.panes()).agents;
    for (const agent of agents)
      if (!issued.includes(agent.agent_id)) issued.push(agent.agent_id);
    for (const id of issued)
      if (!agents.some((agent) => agent.agent_id === id)) ended.add(id);
    // oneAgentPerSeat: no two held agents in one terminal.
    const seats = agents.flatMap((agent) =>
      agent.seat ? [agent.seat.terminal_id] : [],
    );
    check(new Set(seats).size === seats.length, "one agent per seat");
    // endedNeverReturns: an agent once gone from World never comes back.
    for (const agent of agents)
      check(!ended.has(agent.agent_id), "an ended agent returned");
  };
  /** One complete listing of the runtime, then the reply that follows. */
  const observe = async () => {
    await w.observe(rt.state.generation, rt.panes());
    read();
  };
  const agent = (n: number) => {
    const id = issued[n - 1];
    const entry = agents.find((each) => each.agent_id === id);
    return {
      id,
      state: (entry?.state ?? (id ? "ended" : "free")) as AgentState | "free",
      terminal: entry?.seat?.terminal_id ?? null,
      conversation: entry?.conversation ?? null,
    };
  };
  const terminal = (t: number) => rt.state.terminals.get(t)?.id;
  const offers = () =>
    impl.agentOffers(
      w.list(),
      new Map(agents.map((each) => [each.agent_id, each.state])),
    );
  try {
    w.start(() => rt.state.generation);
    // seatOne: a terminal, a harness in conversation 1, one complete listing.
    const seatOne = async () => {
      rt.open(1);
      rt.start(1, 1);
      await observe();
      check(
        agent(1).state === "live" && agent(1).terminal === terminal(1),
        "the newcomer is a live agent in its seat",
      );
    };
    if (scenario === "renamedOrRestartedKeepsAgent") {
      await seatOne();
      const id = agent(1).id;
      w.stop();
      w.start(() => rt.state.generation);
      read();
      check(agent(1).state === "unresolved", "unresolved after World restarts");
      await observe();
      check(
        agent(1).id === id &&
          agent(1).state === "live" &&
          agent(1).terminal === terminal(1) &&
          issued.length === 1,
        "the same agent, live in the same seat",
      );
    } else if (scenario === "newConversationKeepsAgent") {
      await seatOne();
      rt.converse(1, 2);
      await observe();
      check(
        agent(1).state === "live" &&
          agent(1).conversation?.item === "claude/c2" &&
          agent(2).state === "free",
        "the same agent takes the new conversation",
      );
    } else if (scenario === "runtimeRestartLeavesAgentAway") {
      await seatOne();
      rt.restart();
      await observe();
      check(
        agent(1).state === "away" &&
          agent(1).terminal === null &&
          agent(1).conversation?.item === "claude/c1",
        "away with its conversation after the runtime restarts",
      );
    } else if (scenario === "resumeByHandIsOfferedNotMerged") {
      await seatOne();
      rt.close(1);
      rt.open(2);
      rt.start(2, 1);
      await observe();
      check(
        agent(1).state === "away" &&
          agent(2).state === "live" &&
          agent(2).terminal === terminal(2),
        "a new agent, never the away one",
      );
      check(
        offers().get(agent(2).id!) === agent(1).id,
        "the newcomer is offered as the away agent",
      );
    } else if (scenario === "duplicateBindsNothing") {
      await seatOne();
      rt.state.duplicate = 1;
      await observe();
      check(
        agent(1).state === "unresolved" &&
          agent(1).terminal === terminal(1) &&
          issued.length === 1,
        "unresolved, seat kept, nothing created or ended",
      );
      rt.state.duplicate = null;
      await observe();
      check(agent(1).state === "live", "live again once the listing is clear");
    } else if (scenario === "sameConversationTwiceConflicts") {
      await seatOne();
      rt.open(2);
      rt.start(2, 1);
      await observe();
      check(
        agent(1).state === "live" &&
          agent(2).state === "live" &&
          agent(1).conversation?.state === "conflict" &&
          agent(2).conversation?.state === "conflict",
        "both claims are in conflict",
      );
      check(offers().size === 0, "no offer while the first is live");
    } else {
      rt.open(1);
      rt.start(1, 0);
      await observe();
      check(
        agent(1).state === "live" && agent(1).conversation?.item === null,
        "a newcomer with no conversation",
      );
      rt.close(1);
      await observe();
      check(agent(1).state === "ended", "nothing to resume: it ends");
      rt.open(1);
      rt.start(1, 0);
      await observe();
      check(
        agent(1).state === "ended" &&
          agent(2).state === "live" &&
          agent(2).terminal === terminal(1),
        "the next harness is a new agent",
      );
    }
    return {
      scenario,
      states: issued.map((_, index) => agent(index + 1).state),
    };
  } finally {
    w.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

export async function replayAgentIdentityScenarios(
  impl: Implementation = real,
) {
  const results = [];
  for (const scenario of identityScenarios)
    results.push(await replayAgentIdentity(scenario, impl));
  return results;
}
