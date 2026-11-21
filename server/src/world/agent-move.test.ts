import { expect, test } from "bun:test";
import type { AgentAddress } from "../../../shared/agentMove";
import type { TerminalRow } from "../adapters/runtime-ports";
import {
  moveAgentAcross,
  type AgentMoveDeps,
  type MoveSide,
} from "./agent-move";
import { rehomeAgent } from "./agent-rehome";
import { emptyBoardDocument } from "./board-store";
import type { BoardOp } from "./board-types";

const source: AgentAddress = {
  connection_id: "tui",
  generation: 1,
  workspace_id: "w1",
  tab_id: "w1:t1",
  pane_id: "p1",
  terminal_id: "term-1",
  color_key: "tui:w1:t1",
};
const destination = {
  connection_id: "core",
  generation: 2,
  workspace_id: "c1",
};

function side(id: string, panes: TerminalRow[], log: string[]): MoveSide {
  return {
    machine: "",
    rows: async () => ({
      workspaces: ["w1", "c1"],
      panes,
      names: new Map([["p1", "Ada"]]),
    }),
    blocker: async () => null,
    session: async () => "session-1",
    pinned: () => true,
    async start(request) {
      log.push(`start ${id} ${request.args.join(" ")} in ${request.cwd}`);
      return { tab_id: "c1:t5", pane_id: "c5", terminal_id: "c5" };
    },
    async close(pane) {
      log.push(`close ${id} ${pane.pane_id}`);
    },
    async pin(desk) {
      log.push(`pin ${id} ${desk.terminal_id}`);
      return [];
    },
  };
}

function setup(status = "idle", extra: TerminalRow[] = []) {
  const log: string[] = [];
  const ops: BoardOp[] = [];
  const pane: TerminalRow = {
    pane_id: "p1",
    terminal_id: "term-1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    agent: "claude",
    agent_status: status,
    cwd: "/synthetic/project",
  };
  const sides: Record<string, MoveSide> = {
    tui: side("tui", [pane, ...extra], log),
    core: side("core", [], log),
  };
  const deps: AgentMoveDeps = {
    side: (id) => sides[id] ?? null,
    board: (() => ({
      get: emptyBoardDocument,
      async patch(plan: (d: unknown) => BoardOp[] | null) {
        ops.push(...(plan(emptyBoardDocument()) ?? []));
        return { revision: ops.length };
      },
    })) as unknown as AgentMoveDeps["board"],
    publishBoardChanged: () => {},
    publishWorldInvalidation: () => {},
  };
  return { deps, log, ops, sides };
}

test("an idle agent resumes on the other runtime before its original closes", async () => {
  const { deps, log, ops } = setup();
  const result = await moveAgentAcross(deps, { source, destination });
  expect(result).toMatchObject({
    status: "moved",
    target: { connection_id: "core", tab_id: "c1:t5", terminal_id: "c5" },
  });
  expect(log).toEqual([
    "start core --resume session-1 in /synthetic/project",
    "pin core c5",
    "close tui p1",
  ]);
  expect(ops.at(-1)).toMatchObject({ op: "agent.rehome", from: source });
});

test("busy, many-pane and same-runtime moves are refused and nothing starts", async () => {
  const cases = [
    [setup("working"), "Ada is working. Let it finish, then move it."],
    [
      setup("blocked"),
      "Ada is waiting for an answer. Answer it, then move it.",
    ],
    [
      setup("idle", [{ pane_id: "p2", terminal_id: "t2", tab_id: "w1:t1" }]),
      "Only a desk with one terminal moves between runtimes.",
    ],
  ] as const;
  for (const [{ deps, log }, message] of cases) {
    expect(await moveAgentAcross(deps, { source, destination })).toEqual({
      status: "refused",
      message,
    });
    expect(log).toEqual([]);
  }
  const { deps } = setup();
  expect(
    await moveAgentAcross(deps, {
      source,
      destination: { ...destination, connection_id: "tui" },
    }),
  ).toMatchObject({ status: "refused" });
});

test("a failed start closes only the partial new agent and keeps the original", async () => {
  const { deps, log, ops, sides } = setup();
  sides.core!.start = async () => ({ message: "No harness.", pane_id: "c5" });
  expect(await moveAgentAcross(deps, { source, destination })).toEqual({
    status: "refused",
    message: "Ada didn't start there: No harness. It still runs where it was.",
  });
  expect(log).toEqual(["close core c5"]);
  expect(ops.some((op) => op.op === "agent.rehome")).toBe(false);
});

test("rehoming carries colour, pin, strings and spawn links to the new address", () => {
  const document = emptyBoardDocument();
  const to: AgentAddress = {
    ...destination,
    tab_id: "c1:t5",
    pane_id: "c5",
    terminal_id: "c5",
    color_key: "core:c1:t5",
  };
  document.layout.colors[source.color_key] = "teal";
  document.layout.desk_pins[source.color_key] = { cell: null };
  document.relations.spawns.push({
    child: { connection_id: "tui", terminal_id: "child" },
    parent: { connection_id: "tui", terminal_id: "term-1" },
    source: "token",
    generation: 1,
    observed_at: 1,
  });
  rehomeAgent(document, source, to);
  expect(document.layout.colors).toEqual({ "core:c1:t5": "teal" });
  expect(Object.keys(document.layout.desk_pins)).toEqual(["core:c1:t5"]);
  expect(document.relations.spawns[0]).toMatchObject({
    parent: { connection_id: "core", terminal_id: "c5" },
    moved_from: [{ connection_id: "tui", terminal_id: "term-1" }],
  });
});
