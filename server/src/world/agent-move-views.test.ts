import { expect, test } from "bun:test";
import type { AgentAddress } from "../../../shared/agentMove";
import { tabCardKey } from "../../../shared/terminalColor";
import type { TerminalRow } from "../adapters/runtime-ports";
import {
  type AgentMoveDeps,
  type MoveSide,
  moveAgentAcross,
} from "./agent-move";
import { moveSide } from "./agent-move-sides";
import { BoardStore, emptyBoardDocument } from "./board-store";

/**
 * One Herdr seen through two connections (a startup default and a saved
 * profile of its socket), as the owner runs it, and a herdr-core runtime:
 * the real Herdr TUI move side over a synthetic Herdr, wired the way
 * rpc/agent-move.ts wires it (aliases and sameRuntime by endpoint).
 */
function world(
  options: {
    /** Herdr's reply to pane.close; `false` says ok but keeps the pane. */
    close?: (paneId: string) => Promise<boolean | void> | boolean | void;
    /** The original turns busy once its copy is up (before it closes). */
    busyOnceCopied?: boolean;
  } = {},
) {
  const herdr = {
    workspaces: ["w1"],
    panes: [
      {
        pane_id: "w1:p1",
        terminal_id: "term_a",
        tab_id: "w1:t1",
        workspace_id: "w1",
        agent: "claude",
        agent_status: "idle",
        agent_session: { value: "session-1" },
        cwd: "/synthetic/project",
      },
    ] as TerminalRow[],
  };
  const calls: string[] = [];
  const lease = (generation: number) => ({
    generation,
    isCurrent: () => true,
    runtime: {
      sshHost: () => null,
      operations: {
        listWorkspaces: async () => ({
          workspaces: herdr.workspaces.map((workspace_id) => ({
            workspace_id,
          })),
        }),
        listTerminals: async () => ({ panes: [...herdr.panes] }),
        listAgents: async () => ({
          agents: herdr.panes.map((pane) => ({
            pane_id: pane.pane_id,
            name: "Ada",
          })),
        }),
        getAgent: async () => ({ agent: undefined }),
      },
      tui: {
        async call(method: string, params: { pane_id?: string }) {
          calls.push(`${method} ${params.pane_id ?? ""}`);
          if (method === "pane.close") {
            const gone = await options.close?.(String(params.pane_id));
            if (gone !== false)
              herdr.panes = herdr.panes.filter(
                (pane) => pane.pane_id !== params.pane_id,
              );
            return { type: "ok" };
          }
          return {};
        },
      },
    },
  });
  const leases: Record<string, ReturnType<typeof lease>> = {
    "startup-default": lease(1),
    local: lease(4),
  };
  const corePanes: TerminalRow[] = [];
  const core: MoveSide = {
    machine: "",
    rows: async () => ({
      workspaces: ["c1"],
      panes: corePanes,
      names: new Map(corePanes.map((pane) => [String(pane.pane_id), "Ada"])),
    }),
    admit: async () => ({ admitted: null }),
    session: async () => "session-1",
    shellBusy: async () => false,
    pinned: () => false,
    async start(request) {
      corePanes.push({
        pane_id: "c5",
        terminal_id: "c5",
        tab_id: "c1:t5",
        workspace_id: request.workspaceId,
        agent: request.kind ?? undefined,
        agent_status: "idle",
      });
      return { tab_id: "c1:t5", pane_id: "c5", terminal_id: "c5" };
    },
    async close(pane) {
      corePanes.splice(
        0,
        corePanes.length,
        ...corePanes.filter((row) => row.pane_id !== pane.pane_id),
      );
      return {};
    },
    async pin() {
      if (options.busyOnceCopied) herdr.panes[0]!.agent_status = "working";
      return [];
    },
  };
  const initial = emptyBoardDocument();
  const board = new BoardStore({ read: () => initial, commit: () => {} });
  const services = {
    connectionManager: {
      has: (id: string) => id in leases,
      readyRuntimeLease: (id: string) => leases[id],
    },
    board: () => board,
  } as unknown as Parameters<typeof moveSide>[0];
  const endpoint: Record<string, string> = {
    "startup-default": "herdr",
    local: "herdr",
    core: "core",
  };
  const aliases = (id: string) =>
    Object.keys(endpoint).filter((other) => endpoint[other] === endpoint[id]);
  const lines: string[] = [];
  const deps: AgentMoveDeps = {
    side: (id, generation) =>
      id === "core"
        ? core
        : moveSide(services, id, generation, async () => {}, aliases(id)),
    board: (() => board) as unknown as AgentMoveDeps["board"],
    publishBoardChanged: () => {},
    publishWorldInvalidation: () => {},
    sameRuntime: (a, b) => endpoint[a] === endpoint[b],
    log: (step, fields) =>
      lines.push(
        [step, fields.stage, fields.outcome, fields.order, fields.reason]
          .filter((part) => part !== undefined && part !== "")
          .join(" "),
      ),
  };
  const source = (view: string): AgentAddress => ({
    connection_id: view,
    generation: leases[view]!.generation,
    workspace_id: "w1",
    tab_id: "w1:t1",
    pane_id: "w1:p1",
    terminal_id: "term_a",
    color_key: tabCardKey(view, "w1:t1", new Set(herdr.workspaces)),
  });
  return { herdr, corePanes, board, deps, calls, lines, source };
}

const upToClose = [
  "admit admitted start-first",
  "start before-close ready",
  "recheck after-start same",
  "rehome",
];

const destination = {
  connection_id: "core",
  generation: 2,
  workspace_id: "c1",
};

for (const [view, anchor] of [
  ["startup-default", "startup-default"],
  ["local", "startup-default"],
  ["startup-default", "local"],
] as const)
  test(`a TUI agent moved to core through the ${view} view (pin under ${anchor}) closes its original once`, async () => {
    const w = world();
    const from = w.source(view);
    await w.board.patch([
      { op: "card.color", key: from.color_key, color: "teal" },
      { op: "desk.pin", key: `${anchor}:w1:t1`, cell: null },
    ]);
    const result = await moveAgentAcross(w.deps, {
      source: from,
      destination,
    });
    expect(result).toMatchObject({ status: "moved" });
    expect(w.lines).toEqual([
      ...upToClose,
      "recheck after-rehome same",
      "close closed",
      // A pin under the other view goes once the original has closed.
      ...(view === anchor ? [] : ["unpin"]),
      "outcome moved",
    ]);
    // The original closed on the one Herdr both views show.
    expect(w.calls).toContain("pane.close w1:p1");
    expect(w.herdr.panes).toEqual([]);
    expect(w.corePanes.map((pane) => pane.terminal_id)).toEqual(["c5"]);
    const { layout } = w.board.get();
    const at = (result as { target: AgentAddress }).target;
    expect(layout.colors).toEqual({ [at.color_key]: "teal" });
  });

/** Pinned under the other view of the one Herdr, moved through `local`. */
async function pinnedMove(w: ReturnType<typeof world>) {
  const from = w.source("local");
  await w.board.patch([
    { op: "card.color", key: from.color_key, color: "teal" },
    { op: "desk.pin", key: "startup-default:w1:t1", cell: null },
  ]);
  const result = await moveAgentAcross(w.deps, { source: from, destination });
  return { from, result };
}

test("an original that turns busy once its copy is up stays, pin and colour kept", async () => {
  const w = world({ busyOnceCopied: true });
  const { from, result } = await pinnedMove(w);
  expect(result).toMatchObject({ status: "refused", reason: "busy" });
  expect(w.lines).toEqual([
    ...upToClose,
    "recheck after-rehome busy",
    "rehome",
    "cleanup closed",
    "outcome refused busy",
  ]);
  expect(w.calls).not.toContain("pane.close w1:p1");
  expect(w.herdr.panes.map((pane) => pane.terminal_id)).toEqual(["term_a"]);
  expect(w.corePanes).toEqual([]);
  const { layout } = w.board.get();
  expect(layout.desk_pins).toHaveProperty(["startup-default:w1:t1"]);
  expect(layout.colors).toEqual({ [from.color_key]: "teal" });
});

test("a refused close keeps the original, its pin under the other view and its colour", async () => {
  const w = world({
    close: () => {
      throw new Error(
        "confirmation_required: closing this pane would close a worktree group",
      );
    },
  });
  const { from, result } = await pinnedMove(w);
  expect(result).toMatchObject({ status: "refused", reason: "close_failed" });
  expect(w.lines).toEqual([
    ...upToClose,
    "recheck after-rehome same",
    "close failed",
    "rehome",
    "cleanup closed",
    "outcome refused close_failed",
  ]);
  expect(w.herdr.panes.map((pane) => pane.terminal_id)).toEqual(["term_a"]);
  expect(w.corePanes).toEqual([]);
  const { layout } = w.board.get();
  expect(layout.desk_pins).toHaveProperty(["startup-default:w1:t1"]);
  expect(layout.colors).toEqual({ [from.color_key]: "teal" });
});

test("Herdr saying ok while still showing the original is an uncertain move, not moved", async () => {
  const w = world({ close: () => false });
  const { result } = await pinnedMove(w);
  expect(result).toMatchObject({ status: "uncertain" });
  expect((result as { message: string }).message).toContain(
    "Herdr still shows it after closing it.",
  );
  expect(w.lines).toEqual([
    ...upToClose,
    "recheck after-rehome same",
    "close uncertain",
    "outcome uncertain",
  ]);
  // Both run: the copy keeps the desk; the alias pin stays until it closes.
  expect(w.herdr.panes.map((pane) => pane.terminal_id)).toEqual(["term_a"]);
  expect(w.corePanes.map((pane) => pane.terminal_id)).toEqual(["c5"]);
  expect(w.board.get().layout.desk_pins).toHaveProperty([
    "startup-default:w1:t1",
  ]);
});
