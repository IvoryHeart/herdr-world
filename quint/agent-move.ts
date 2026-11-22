import assert from "node:assert/strict";
import type { AgentAddress } from "../shared/agentMove";
import { tabCardKey } from "../shared/terminalColor";
import type { TerminalRow } from "../server/src/adapters/runtime-ports";
import {
  moveAgentAcross,
  type AgentMoveDeps,
  type MoveSide,
} from "../server/src/world/agent-move";
import { emptyBoardDocument } from "../server/src/world/board-store";
import type { BoardOp } from "../server/src/world/board-types";
import { observe } from "./observations";

/** One state of quint/agent-move.qnt (field `m`). */
export type MoveState = {
  dir: "tui-core" | "core-tui";
  pinned: boolean;
  shape: string;
  pc: string;
  src: string;
  srcConn: string;
  dstConn: string;
  alive: boolean;
  copy: boolean;
  desk: "src" | "dst";
  outcome: string;
  reason: string;
  namesCopy: boolean;
  namesOrig: boolean;
  namesDesk: boolean;
  gone: boolean;
  events: number;
  effects: string[];
  closedBusy: boolean;
  unfenced: boolean;
  startReply: string;
  startTruth: boolean;
  pinReply: string;
  rehomeReply: string;
  closeReply: string;
  closeTruth: boolean;
  stillRead: string;
  cleanupReply: string;
  cleanupTruth: boolean;
  unhomeReply: string;
  envStart: string;
  envRehome: string;
  envClose: string;
};

export const moveWitnesses = [
  "movedTuiCore",
  "movedCoreTui",
  "refusedSplit",
  "lostStart",
  "changedDuringStart",
  "changedDuringRehome",
  "childRefusedKill",
  "closeUnconfirmed",
  "lostCloseUnread",
  "regenFenced",
  "cleanupNamed",
] as const;
export const moveMismatches = [
  "move.outcome",
  "move.effects",
  "move.owners",
  "move.report",
  "move.fence",
] as const;

const fields: Record<string, "string" | "boolean" | "number" | "array"> = {
  dir: "string",
  pinned: "boolean",
  shape: "string",
  pc: "string",
  src: "string",
  srcConn: "string",
  dstConn: "string",
  alive: "boolean",
  copy: "boolean",
  desk: "string",
  outcome: "string",
  reason: "string",
  namesCopy: "boolean",
  namesOrig: "boolean",
  namesDesk: "boolean",
  gone: "boolean",
  events: "number",
  effects: "array",
  closedBusy: "boolean",
  unfenced: "boolean",
  startReply: "string",
  startTruth: "boolean",
  pinReply: "string",
  rehomeReply: "string",
  closeReply: "string",
  closeTruth: "boolean",
  stillRead: "string",
  cleanupReply: "string",
  cleanupTruth: "boolean",
  unhomeReply: "string",
  envStart: "string",
  envRehome: "string",
  envClose: "string",
};

/** Check a decoded ITF trace: every state a full move record, one scenario. */
export function validateMoveTrace(states: unknown): MoveState[] {
  assert(Array.isArray(states) && states.length > 1, "empty move trace");
  const moves = states.map((state) => {
    assert(state && typeof state === "object" && "m" in state);
    const m = (state as { m: Record<string, unknown> }).m;
    for (const [name, kind] of Object.entries(fields))
      assert(
        kind === "array"
          ? Array.isArray(m[name]) &&
              (m[name] as unknown[]).every((e) => typeof e === "string")
          : kind === "number"
            ? Number.isSafeInteger(m[name])
            : typeof m[name] === kind,
        `move.${name} malformed`,
      );
    assert(["tui-core", "core-tui"].includes(m.dir as string));
    return m as unknown as MoveState;
  });
  for (const m of moves) {
    assert.equal(m.dir, moves[0]!.dir);
    assert.equal(m.shape, moves[0]!.shape);
    assert.equal(m.pinned, moves[0]!.pinned);
  }
  return moves;
}

/** The witnesses one replayed final state shows. */
export function moveWitnessesOf(m: MoveState): string[] {
  const seen: string[] = [];
  if (m.outcome === "moved")
    seen.push(m.dir === "tui-core" ? "movedTuiCore" : "movedCoreTui");
  if (m.shape === "split") seen.push("refusedSplit");
  if (m.startReply === "lost") seen.push("lostStart");
  if (m.reason === "changed" && !m.effects.includes("rehome"))
    seen.push("changedDuringStart");
  if (m.reason === "changed" && m.effects.includes("rehome"))
    seen.push("changedDuringRehome");
  if (m.src === "child" && m.outcome === "refused" && m.reason === "close")
    seen.push("childRefusedKill");
  if (m.closeReply === "uncertain" && m.outcome === "uncertain")
    seen.push("closeUnconfirmed");
  if (
    m.outcome === "uncertain" &&
    m.closeReply === "lostEnded" &&
    m.srcConn === "up" &&
    m.stillRead === "fail"
  )
    seen.push("lostCloseUnread");
  if ((m.srcConn === "regen" || m.dstConn === "regen") && m.effects.length > 1)
    seen.push("regenFenced");
  if (m.outcome === "refused" && m.namesCopy && m.copy)
    seen.push("cleanupNamed");
  return seen;
}

/**
 * Replay one model scenario through the real `moveAgentAcross`. Both sides
 * are fakes scripted by the trace: they hold the truth (which agent runs,
 * where the desk is) and reject every call on a side whose connection
 * dropped or reconnected, as a retired runtime lease does.
 */
export async function replayMove(
  trace: MoveState[],
  move = moveAgentAcross,
): Promise<string[]> {
  const m = trace.at(-1)!;
  assert.equal(m.pc, "done", "move trace did not settle");
  const [sourceId, targetId] =
    m.dir === "tui-core" ? ["tui", "core"] : ["core", "tui"];
  const world = {
    src: m.shape,
    srcConn: "up",
    dstConn: "up",
    alive: true,
    copy: false,
    desk: "src" as "src" | "dst",
    closing: false,
    events: [] as string[],
  };
  const effects: string[] = [];
  const resolved: [string, number][] = [];
  const outside = (event: string) => {
    if (event === "-" || event === "none") return;
    if (["busy", "split", "child"].includes(event)) world.src = event;
    else if (event === "gone") {
      world.src = "gone";
      world.alive = false;
    } else if (event === "srcDown") world.srcConn = "down";
    else if (event === "srcRegen") world.srcConn = "regen";
    else if (event === "dstDown") world.dstConn = "down";
    else if (event === "dstRegen") world.dstConn = "regen";
    else assert.fail(`unknown event ${event}`);
  };
  // The sides stand for runtime leases: a call on a dropped or reconnected
  // side is rejected, so production never lands an effect there.
  const fenced = (conn: string) => {
    if (conn !== "up") throw new Error("The host reconnected.");
  };
  const from: AgentAddress = {
    connection_id: sourceId,
    generation: 1,
    workspace_id: "w1",
    tab_id: "w1:t1",
    pane_id: "p1",
    terminal_id: "term-1",
    color_key: tabCardKey(sourceId, "w1:t1", new Set(["w1"])),
  };
  const pane = (status: string): TerminalRow => ({
    pane_id: "p1",
    terminal_id: "term-1",
    tab_id: "w1:t1",
    workspace_id: "w1",
    agent: "claude",
    agent_status: status,
    cwd: "/synthetic/project",
  });
  const source: MoveSide = {
    machine: "",
    async rows() {
      fenced(world.srcConn);
      if (world.closing && m.stillRead === "fail")
        throw new Error("World lost the host.");
      const panes =
        !world.alive || world.src === "gone"
          ? []
          : world.src === "busy"
            ? [pane("working")]
            : world.src === "split"
              ? [pane("idle"), { ...pane("idle"), pane_id: "p2" }]
              : [pane("idle")];
      return { workspaces: ["w1"], panes, names: new Map([["p1", "Ada"]]) };
    },
    admit: async () =>
      world.src === "child"
        ? { refusal: "Agents it started would end with it." }
        : { admitted: "root-only" },
    session: async () => "session-1",
    shellBusy: async () => false,
    pinned: () => m.pinned,
    start: async () => assert.fail("the source never starts"),
    async close() {
      effects.push("close");
      outside(m.envClose);
      world.closing = true;
      fenced(world.srcConn);
      if (world.src === "child") throw new Error("A child would end too.");
      if (m.closeReply === "ended") {
        world.alive = false;
        return {};
      }
      if (m.closeReply === "uncertain") {
        world.alive = !m.closeTruth;
        return { uncertain: "core didn't confirm it ended." };
      }
      if (m.closeReply === "lostEnded") world.alive = false;
      throw new Error("The reply was lost.");
    },
    pin: async () => assert.fail("the source is never pinned"),
  };
  const target: MoveSide = {
    machine: "",
    async rows() {
      fenced(world.dstConn);
      return { workspaces: ["c1"], panes: [], names: new Map() };
    },
    admit: async () => ({ admitted: null }),
    session: async () => null,
    shellBusy: async () => false,
    pinned: () => false,
    async start() {
      effects.push("start");
      if (m.startReply === "ready") {
        world.copy = true;
        outside(m.envStart);
        return { tab_id: "c1:t5", pane_id: "c5", terminal_id: "c5" };
      }
      if (m.startReply === "failed") return { message: "It did not start." };
      if (m.startReply === "partial") {
        world.copy = true;
        return { message: "It wasn't ready in time.", pane_id: "c5" };
      }
      world.copy = m.startTruth;
      throw new Error("The reply was lost.");
    },
    async close() {
      effects.push("discard");
      fenced(world.dstConn);
      if (m.cleanupReply === "ended") {
        world.copy = false;
        return {};
      }
      world.copy = world.copy && m.cleanupTruth;
      if (m.cleanupReply === "uncertain")
        return { uncertain: "it didn't confirm." };
      throw new Error("The cleanup reply was lost.");
    },
    async pin() {
      effects.push("pin");
      if (m.pinReply === "fail") throw new Error("The pin was refused.");
      return [];
    },
  };
  const deps: AgentMoveDeps = {
    side(id, generation) {
      resolved.push([id, generation]);
      const conn = id === sourceId ? world.srcConn : world.dstConn;
      if (conn !== "up" || generation !== 1) return null;
      return id === sourceId ? source : id === targetId ? target : null;
    },
    board: (() => ({
      get: emptyBoardDocument,
      async patch(plan: (d: unknown) => BoardOp[] | null) {
        const ops = plan(emptyBoardDocument()) ?? [];
        const rehome = ops.find((op) => op.op === "agent.rehome") as
          | { from: AgentAddress }
          | undefined;
        if (rehome && rehome.from.connection_id === sourceId) {
          if (m.rehomeReply === "fail") throw new Error("Board refused.");
          effects.push("rehome");
          world.desk = "dst";
          outside(m.envRehome);
        } else if (rehome) {
          effects.push("unhome");
          if (m.unhomeReply === "fail") throw new Error("Board refused.");
          world.desk = "src";
        }
        return { revision: 1 };
      },
    })) as unknown as AgentMoveDeps["board"],
    publishBoardChanged: () => {},
    publishWorldInvalidation: () => {},
  };
  const result = await move(deps, {
    source: from,
    destination: { connection_id: targetId, generation: 1, workspace_id: "c1" },
  });
  const message = "message" in result ? result.message : "";
  observe(
    "move.fence",
    { resolved, unfenced: false },
    {
      resolved: [
        [sourceId, 1],
        [targetId, 1],
      ],
      unfenced: m.unfenced,
    },
  );
  observe("move.outcome", result.status, m.outcome);
  observe("move.effects", effects, m.effects);
  observe(
    "move.owners",
    { alive: world.alive, copy: world.copy, desk: world.desk },
    { alive: m.alive, copy: m.copy, desk: m.desk },
  );
  observe(
    "move.report",
    {
      reason: result.status !== "refused" || message.length > 0,
      namesCopy: /new copy there may still be running/.test(message),
      namesOrig: result.status === "uncertain",
      namesDesk: /desk details stay on the new copy/.test(message),
    },
    {
      reason: m.reason !== "" || m.outcome !== "refused",
      namesCopy: m.namesCopy && m.outcome === "refused",
      namesOrig: m.namesOrig,
      namesDesk: m.namesDesk,
    },
  );
  return moveWitnessesOf(m);
}
