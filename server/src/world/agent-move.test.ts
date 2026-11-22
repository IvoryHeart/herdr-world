import { afterEach, describe, expect, test } from "bun:test";
import type { AgentAddress } from "../../../shared/agentMove";
import type { TerminalRow } from "../adapters/runtime-ports";
import { createCoreRoom, launchCore } from "../herdr-core/operations";
import { coreWorld } from "../herdr-core/testing/core-world";
import {
  moveAgentAcross,
  moveSide,
  type AgentMoveDeps,
  type MoveSide,
} from "./agent-move";
import {
  relationsOf,
  type TerminalRef,
  terminalKey,
  withInheritedColors,
} from "../../../shared/relations";
import {
  resolveTerminalColor,
  tabCardKey,
} from "../../../shared/terminalColor";
import { rehomeAgent } from "./agent-rehome";
import { BoardStore, emptyBoardDocument } from "./board-store";
import type { BoardOp } from "./board-types";

const text = (value: unknown) => (typeof value === "string" ? value : "");

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
    admit: async () => ({ admitted: `${id}-root-only` }),
    session: async () => "session-1",
    shellBusy: async () => false,
    pinned: () => true,
    async start(request) {
      const argv = [request.kind ?? "shell", ...request.args].join(" ");
      log.push(`start ${id} ${argv} in ${request.cwd}`);
      return { tab_id: "c1:t5", pane_id: "c5", terminal_id: "c5" };
    },
    async close(pane, admitted) {
      log.push(`close ${id} ${pane.pane_id}${admitted ? ` ${admitted}` : ""}`);
      return {};
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
  return { deps, log, ops, sides, pane };
}

/** Change the original while the new copy starts. */
function duringStart(
  sides: Record<string, MoveSide>,
  change: () => void,
): void {
  const start = sides.core!.start;
  sides.core!.start = async (request) => {
    const started = await start(request);
    change();
    return started;
  };
}

test("an idle agent resumes on the other runtime before its original closes", async () => {
  const { deps, log, ops } = setup();
  const result = await moveAgentAcross(deps, { source, destination });
  expect(result).toMatchObject({
    status: "moved",
    target: { connection_id: "core", tab_id: "c1:t5", terminal_id: "c5" },
  });
  expect(log).toEqual([
    "start core claude --resume session-1 in /synthetic/project",
    "pin core c5",
    "close tui p1 tui-root-only",
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

test("without a conversation to resume it asks, then starts fresh in the same folder", async () => {
  const { deps, log, sides } = setup();
  sides.tui!.session = async () => null;
  expect(await moveAgentAcross(deps, { source, destination })).toEqual({
    status: "confirm",
    message:
      "World can't find Ada's conversation, so it starts fresh there in the same folder. Its conversation won't continue. Move it anyway?",
  });
  expect(log).toEqual([]);
  expect(
    await moveAgentAcross(deps, { source, destination, fresh: true }),
  ).toMatchObject({ status: "moved" });
  expect(log).toEqual([
    "start core claude in /synthetic/project",
    "pin core c5",
    "close tui p1 tui-root-only",
  ]);
});

test("a plain terminal moves as a new shell once confirmed; a busy one is refused", async () => {
  const { deps, log, sides, pane, ops } = setup();
  delete pane.agent;
  pane.agent_status = "unknown";
  sides.tui!.rows = async () => ({
    workspaces: ["w1", "c1"],
    panes: [pane],
    names: new Map(),
  });
  expect(await moveAgentAcross(deps, { source, destination })).toMatchObject({
    status: "confirm",
    message: expect.stringContaining("starts again as a new shell"),
  });
  sides.tui!.shellBusy = async () => true;
  expect(
    await moveAgentAcross(deps, { source, destination, fresh: true }),
  ).toEqual({
    status: "refused",
    message: "This terminal is running a program. Let it finish, then move it.",
  });
  expect(log).toEqual([]);
  sides.tui!.shellBusy = async () => false;
  expect(
    await moveAgentAcross(deps, { source, destination, fresh: true }),
  ).toMatchObject({ status: "moved" });
  expect(log[0]).toBe("start core shell in /synthetic/project");
  expect(ops.at(-1)).toMatchObject({ op: "agent.rehome", from: source });
});

test("a Board that refuses the undo still drops the copy and says where the desk is", async () => {
  const { deps, log, sides } = setup();
  sides.tui!.close = async () => {
    throw new Error("Refused.");
  };
  const patch = deps.board().patch;
  let patches = 0;
  deps.board = (() => ({
    get: emptyBoardDocument,
    patch: async (plan: never) => {
      if (++patches > 2) throw new Error("storage unavailable");
      return patch(plan);
    },
  })) as unknown as AgentMoveDeps["board"];
  const result = await moveAgentAcross(deps, { source, destination });
  expect(result).toEqual({
    status: "refused",
    message:
      "Ada didn't close where it was: Refused. It still runs there. Its desk details stay on the new copy: storage unavailable.",
  });
  expect(log.at(-1)).toBe("close core c5");
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

test("an original that changes while the copy starts stays, and the copy goes", async () => {
  for (const change of ["working", "split", "gone"] as const) {
    const { deps, log, ops, sides, pane } = setup();
    const rows = await sides.tui!.rows();
    duringStart(sides, () => {
      if (change === "working") pane.agent_status = "working";
      if (change === "split")
        rows.panes.push({ pane_id: "p2", terminal_id: "t2", tab_id: "w1:t1" });
      if (change === "gone") rows.panes.length = 0;
    });
    sides.tui!.rows = async () => rows;
    const result = await moveAgentAcross(deps, { source, destination });
    expect(result).toMatchObject({ status: "refused" });
    expect((result as { message: string }).message).toContain(
      "It still runs where it was.",
    );
    expect(log.filter((line) => line.startsWith("close"))).toEqual([
      "close core c5",
    ]);
    expect(ops.some((op) => op.op === "agent.rehome")).toBe(false);
  }
});

test("a refused close (a child started meanwhile) undoes the desk and drops the copy", async () => {
  const { deps, log, ops, sides } = setup();
  sides.tui!.close = async (pane, admitted) => {
    log.push(`close tui ${pane.pane_id} ${admitted}`);
    throw new Error("A new agent would end with it.");
  };
  const result = await moveAgentAcross(deps, { source, destination });
  expect(result).toEqual({
    status: "refused",
    message:
      "Ada didn't close where it was: A new agent would end with it. It still runs there.",
  });
  expect(log.slice(-2)).toEqual([
    "close tui p1 tui-root-only",
    "close core c5",
  ]);
  const rehomes = ops.filter((op) => op.op === "agent.rehome");
  expect(rehomes).toHaveLength(2);
  expect(rehomes[1]).toMatchObject({ to: source });
});

test("an unconfirmed close reports both may run; a failed cleanup says the copy may", async () => {
  const one = setup();
  one.sides.tui!.close = async () => ({
    uncertain: "core didn't confirm it ended.",
  });
  expect(
    await moveAgentAcross(one.deps, { source, destination }),
  ).toMatchObject({
    status: "uncertain",
    target: { connection_id: "core", terminal_id: "c5" },
    message:
      "Ada runs in its new room, but the original may still be running: core didn't confirm it ended.",
  });

  const two = setup();
  two.sides.core!.start = async () => ({
    message: "Not ready.",
    pane_id: "c5",
  });
  two.sides.core!.close = async () => {
    throw new Error("lost reply");
  };
  expect(await moveAgentAcross(two.deps, { source, destination })).toEqual({
    status: "refused",
    message:
      "Ada didn't start there: Not ready. It still runs where it was. The new copy there may still be running: close it there.",
  });
});

test("a moved child keeps the colour it inherited from its parent", () => {
  const document = emptyBoardDocument();
  const parent = { connection_id: "tui", terminal_id: "term-parent" };
  document.layout.colors["tui:w1:t0"] = "teal";
  document.relations.spawns.push({
    child: { connection_id: "tui", terminal_id: "term-1" },
    parent,
    source: "token",
    generation: 1,
    observed_at: 1,
  });
  const to: AgentAddress = {
    ...destination,
    tab_id: "c1:t5",
    pane_id: "c5",
    terminal_id: "c5",
    color_key: "core:c1:t5",
  };
  const place = (
    connectionId: string,
    workspaceId: string,
    tabId: string,
    paneId: string,
  ) => ({
    connectionId,
    workspaceId,
    tabId,
    paneId,
    workspaceIds: new Set([workspaceId]),
  });
  const colourOf = (child: TerminalRef, tab: ReturnType<typeof place>) => {
    const observations = [
      { connection_id: "tui", generation: 1, current: true, panes: [] },
      { connection_id: "core", generation: 2, current: true, panes: [] },
    ];
    const places = new Map([
      [terminalKey(parent), place("tui", "w1", "w1:t0", "p0")],
      [terminalKey(child), tab],
    ]);
    const colors = withInheritedColors(
      document.layout.colors,
      relationsOf(document.relations, observations),
      places,
    );
    return resolveTerminalColor(colors, tab).color;
  };
  expect(
    colourOf(
      { connection_id: "tui", terminal_id: "term-1" },
      place("tui", "w1", "w1:t1", "p1"),
    ),
  ).toBe("teal");
  rehomeAgent(document, source, to);
  expect(
    colourOf(
      { connection_id: "core", terminal_id: "c5" },
      place("core", "c1", "c1:t5", "c5"),
    ),
  ).toBe("teal");
});

test("every start, recheck, close and cleanup outcome leaves one owner of the desk and says what may still run", async () => {
  const starts = ["ready", "failed", "failed-partial"] as const;
  // The original turns busy while the copy starts, or while it is pinned.
  const rechecks = ["same", "working", "working-at-pin"] as const;
  const closes = ["ended", "uncertain", "refused", "failed-but-gone"] as const;
  const cleanups = ["ended", "uncertain", "throws"] as const;
  let runs = 0;
  for (const start of starts)
    for (const recheck of rechecks)
      for (const close of closes)
        for (const cleanup of cleanups) {
          const { deps, ops, sides, pane } = setup();
          let original = true;
          let copy = false;
          const rows = sides.tui!.rows;
          sides.tui!.rows = async () => {
            const now = await rows();
            return { ...now, panes: original ? now.panes : [] };
          };
          sides.core!.pin = async () => {
            if (recheck === "working-at-pin") pane.agent_status = "working";
            return [];
          };
          sides.core!.start = async () => {
            if (start === "ready") {
              copy = true;
              if (recheck === "working") pane.agent_status = "working";
              return { tab_id: "c1:t5", pane_id: "c5", terminal_id: "c5" };
            }
            copy = start === "failed-partial";
            return {
              message: "Not ready.",
              ...(copy ? { pane_id: "c5" } : {}),
            };
          };
          sides.core!.close = async () => {
            if (cleanup === "throws") throw new Error("lost");
            if (cleanup === "uncertain") return { uncertain: "?" };
            copy = false;
            return {};
          };
          sides.tui!.close = async () => {
            if (close === "refused") throw new Error("Refused.");
            original = false;
            if (close === "failed-but-gone") throw new Error("lost");
            if (close === "uncertain") return { uncertain: "?" };
            return {};
          };
          const label = `${start}/${recheck}/${close}/${cleanup}`;
          const result = await moveAgentAcross(deps, { source, destination });
          // The desk is wherever the last rehome put it.
          const desk =
            ops.filter((op) => op.op === "agent.rehome").at(-1)?.to
              .connection_id ?? "tui";
          const message = "message" in result ? result.message : "";
          if (result.status === "moved") {
            expect([label, original, copy, desk]).toEqual([
              label,
              false,
              true,
              "core",
            ]);
          } else if (result.status === "uncertain") {
            expect([label, copy, desk]).toEqual([label, true, "core"]);
            expect(message).toContain("may still be running");
          } else {
            expect([label, original, desk]).toEqual([label, true, "tui"]);
            expect(message).toContain("still runs");
            // A copy left behind is always named.
            expect([label, message.includes("may still be running")]).toEqual([
              label,
              copy,
            ]);
          }
          runs++;
        }
  expect(runs).toBe(108);
});

describe("closing a herdr-core original (real kill path)", () => {
  const worlds: Awaited<ReturnType<typeof coreWorld>>[] = [];
  afterEach(async () => {
    for (const w of worlds.splice(0)) await w.dispose();
  });
  async function coreSide() {
    const w = await coreWorld();
    worlds.push(w);
    await w.connect();
    const room = await createCoreRoom(w.lease(), w.topology, "A");
    await launchCore(
      w.lease(),
      {
        workspaceId: room.workspace_id,
        kind: "claude",
        label: "Ada",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async (kind) => `/opt/example/bin/${kind}`,
      },
    );
    await w.settle();
    const services = {
      connectionManager: { has: () => false },
      coreControl: {
        manager: w.core.manager,
        topology: w.topology,
        hostRuntime: () => ({ sshHost: () => null }),
        host: () => null,
      },
      board: () => ({ get: emptyBoardDocument }),
    } as unknown as Parameters<typeof moveSide>[0];
    const side = moveSide(services, "box", w.lease().generation)!;
    const pane = { pane_id: "", terminal_id: "t1" } as TerminalRow;
    const admitted = await side.admit(pane);
    expect(admitted).toMatchObject({
      admitted: { terminals: [{ address: "t1" }] },
    });
    return { w, side, admitted: (admitted as { admitted: unknown }).admitted };
  }

  test("a child started after admission refuses the close; both stay", async () => {
    const { w, side, admitted } = await coreSide();
    const child = w.fake.create({
      parent: "t1",
      die_with_parent: true,
      name: "late",
    });
    await w.settle();
    await expect(
      side.close({ pane_id: "", terminal_id: "t1" }, admitted),
    ).rejects.toThrow("Nothing was ended.");
    expect(w.fake.terminal("t1")!.state).toBe("live");
    expect(w.fake.terminal(child)!.state).toBe("live");
  });

  test("a lost kill reply is reported as uncertain, not as closed", async () => {
    const { w, side, admitted } = await coreSide();
    w.fake.dropNextWriteReply = true;
    w.fake.onCall = (method) => {
      if (method === "terminal.kill")
        queueMicrotask(() => w.fake.kill(w.socket));
    };
    expect(
      await side.close({ pane_id: "", terminal_id: "t1" }, admitted),
    ).toEqual({ uncertain: "core didn't confirm it ended." });
  });
});

test("a herdr-core original moves to a Herdr TUI room and closes there", async () => {
  const w = await coreWorld();
  try {
    await w.connect();
    const room = await createCoreRoom(w.lease(), w.topology, "A");
    await launchCore(
      w.lease(),
      {
        workspaceId: room.workspace_id,
        kind: "claude",
        label: "Ada",
        text: "",
      },
      {
        topology: w.topology,
        resolveExecutable: async (kind) => `/opt/example/bin/${kind}`,
      },
    );
    w.fake.status("t1", "idle");
    await w.settle();
    const services = {
      connectionManager: { has: () => false },
      coreControl: {
        manager: w.core.manager,
        topology: w.topology,
        hostRuntime: () => ({
          sshHost: () => null,
          agentSessions: () => ({
            knownSession: async () => ({ id: "session-1", holder: "" }),
          }),
        }),
        host: () => null,
      },
      board: () => ({ get: emptyBoardDocument }),
    } as unknown as Parameters<typeof moveSide>[0];
    const core = moveSide(services, "box", w.lease().generation)!;
    const { workspaces, panes } = await core.rows();
    const pane = panes.find((row) => row.terminal_id === "t1")!;
    const log: string[] = [];
    const tui = side("tui", [], log);
    const { deps } = setup();
    deps.side = (id) => (id === "box" ? core : id === "tui" ? tui : null);
    const outcome = await moveAgentAcross(deps, {
      source: {
        connection_id: "box",
        generation: w.lease().generation,
        workspace_id: room.workspace_id,
        tab_id: String(pane.tab_id),
        pane_id: "t1",
        terminal_id: "t1",
        color_key: tabCardKey("box", String(pane.tab_id), new Set(workspaces)),
      },
      destination: { connection_id: "tui", generation: 1, workspace_id: "w1" },
    });
    expect(outcome).toMatchObject({ status: "moved" });
    expect(log[0]).toStartWith("start tui claude --resume session-1");
    await w.settle();
    expect(w.fake.terminal("t1")!.state).not.toBe("live");
  } finally {
    await w.dispose();
  }
});

test("a core terminal is idle only while its own shell is alone in front", async () => {
  const w = await coreWorld();
  try {
    await w.connect();
    const shell = w.fake.create({});
    const sleeper = w.fake.create({ argv: ["/bin/sleep", "3600"] });
    w.fake.foreground(sleeper, {
      pid: w.fake.terminal(sleeper)!.pid,
      name: "sleep",
      argv: ["/bin/sleep", "3600"],
    });
    await w.settle();
    const services = {
      connectionManager: { has: () => false },
      coreControl: {
        manager: w.core.manager,
        topology: w.topology,
        hostRuntime: () => ({ sshHost: () => null }),
        host: () => null,
      },
      board: () => ({ get: emptyBoardDocument }),
    } as unknown as Parameters<typeof moveSide>[0];
    const core = moveSide(services, "box", w.lease().generation)!;
    const busy = (terminal_id: string) =>
      core.shellBusy({ pane_id: terminal_id, terminal_id } as TerminalRow);
    expect(await busy(shell)).toBe(false);
    expect(await busy(sleeper)).toBe(true);
  } finally {
    await w.dispose();
  }
});

test("a TUI shell that exits at once is not taken as ready", async () => {
  const calls: string[] = [];
  let panes: TerminalRow[] = [];
  const lease = {
    generation: 1,
    isCurrent: () => true,
    runtime: {
      sshHost: () => null,
      operations: {
        listWorkspaces: async () => ({ workspaces: [{ workspace_id: "w1" }] }),
        listTerminals: async () => ({ panes }),
        listAgents: async () => ({ agents: [] }),
      },
      tui: {
        async call(method: string) {
          calls.push(method);
          if (method === "tab.create")
            return {
              tab: { tab_id: "w1:t9" },
              root_pane: { pane_id: "p9", terminal_id: "term-9" },
            };
          return {
            process_info: { shell_pid: 7, foreground_process_group_id: 7 },
          };
        },
      },
    },
  };
  const services = {
    connectionManager: { has: () => true, readyRuntimeLease: () => lease },
    board: () => ({ get: emptyBoardDocument }),
  } as unknown as Parameters<typeof moveSide>[0];
  const tui = moveSide(services, "tui", 1, async () => {})!;
  const request = { workspaceId: "w1", kind: null, label: "sh", args: [] };
  expect(await tui.start(request)).toEqual({
    message: "Its shell exited at once.",
    pane_id: "p9",
  });
  panes = [{ pane_id: "p9", terminal_id: "term-9", tab_id: "w1:t9" }];
  expect(await tui.start(request)).toEqual({
    tab_id: "w1:t9",
    pane_id: "p9",
    terminal_id: "term-9",
  });
  expect(calls).toEqual(["tab.create", "tab.create", "pane.process_info"]);
});

test("an agent moves again and again, both ways, keeping its colour, pin and conversation", async () => {
  // Two runtimes with two rooms each; panes and pins live where each runtime
  // keeps them: Herdr TUI pins on the Board, core pins on the terminal.
  const panes: Record<string, TerminalRow[]> = { tui: [], core: [] };
  const rooms: Record<string, string[]> = {
    tui: ["w1", "w2"],
    core: ["c1", "c2"],
  };
  const corePinned = new Set<string>();
  const sessions = new Map<string, string>();
  const log: string[] = [];
  let next = 0;
  const initial = emptyBoardDocument();
  initial.layout.colors[source.color_key] = "teal";
  initial.layout.desk_pins[source.color_key] = { cell: null };
  const board = new BoardStore({ read: () => initial, commit: () => {} });
  const runtime = (id: string): MoveSide => ({
    ...side(id, [], log),
    rows: async () => ({
      workspaces: rooms[id]!,
      panes: panes[id]!,
      names: new Map(panes[id]!.map((pane) => [text(pane.pane_id), "Ada"])),
    }),
    session: async (pane) => sessions.get(text(pane.terminal_id)) ?? null,
    pinned: (pane, colorKey) =>
      id === "core"
        ? corePinned.has(text(pane.terminal_id))
        : Boolean(board.get().layout.desk_pins[colorKey]),
    async start(request) {
      const n = ++next;
      const pane: TerminalRow = {
        pane_id: `${id}-p${n}`,
        terminal_id: `${id}-term-${n}`,
        tab_id: `${request.workspaceId}:t${n}`,
        workspace_id: request.workspaceId,
        agent: request.kind ?? undefined,
        agent_status: "idle",
        cwd: request.cwd,
      };
      // The resumed harness keeps the conversation it was given.
      const resumed = request.args[request.args.indexOf("--resume") + 1];
      if (resumed) sessions.set(text(pane.terminal_id), resumed);
      log.push(`start ${id} ${request.args.join(" ")}`);
      panes[id]!.push(pane);
      return {
        tab_id: text(pane.tab_id),
        pane_id: text(pane.pane_id),
        terminal_id: text(pane.terminal_id),
      };
    },
    async close(pane) {
      panes[id] = panes[id]!.filter((row) => row.pane_id !== pane.pane_id);
      return {};
    },
    async pin(desk) {
      if (id === "core") {
        corePinned.add(desk.terminal_id);
        return [];
      }
      return [{ op: "desk.pin", key: desk.color_key, cell: null }];
    },
  });
  const sides: Record<string, MoveSide> = {
    tui: runtime("tui"),
    core: runtime("core"),
  };
  const deps: AgentMoveDeps = {
    side: (id) => sides[id] ?? null,
    board: (() => board) as unknown as AgentMoveDeps["board"],
    publishBoardChanged: () => {},
    publishWorldInvalidation: () => {},
  };
  panes.tui!.push({
    pane_id: source.pane_id,
    terminal_id: source.terminal_id,
    tab_id: source.tab_id,
    workspace_id: source.workspace_id,
    agent: "claude",
    agent_status: "idle",
    cwd: "/synthetic/project",
  });
  sessions.set(source.terminal_id, "session-1");

  let at: AgentAddress = source;
  const route = [
    ["core", 2, "c1"],
    ["tui", 1, "w2"],
    ["core", 2, "c2"],
    ["tui", 1, "w1"],
    ["core", 2, "c1"],
  ] as const;
  for (const [connection_id, generation, workspace_id] of route) {
    const result = await moveAgentAcross(deps, {
      source: at,
      destination: { connection_id, generation, workspace_id },
    });
    expect(result).toMatchObject({
      status: "moved",
      target: { connection_id, workspace_id },
    });
    at = (result as { target: AgentAddress }).target;
    // One agent, at its new address, after every move.
    expect(
      [...panes.tui!, ...panes.core!].map((pane) => pane.terminal_id),
    ).toEqual([at.terminal_id]);
    const { layout } = board.get();
    expect(layout.colors).toEqual({ [at.color_key]: "teal" });
    // The pin follows: on the Board (a core desk's saved rank there), and on
    // core as the terminal's own pin.
    expect(Object.keys(layout.desk_pins)).toEqual([at.color_key]);
    if (connection_id === "core")
      expect(corePinned.has(at.terminal_id)).toBe(true);
  }
  // Every start resumed the same conversation; nothing asked to start fresh.
  expect(log).toEqual(route.map(([id]) => `start ${id} --resume session-1`));
});
