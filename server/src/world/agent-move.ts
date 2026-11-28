import type {
  AgentAddress,
  AgentMoveOutcome,
  AgentMoveRefusal,
  AgentMoveRequest,
} from "../../../shared/agentMove";
import { apartmentResumeArgs } from "../../../shared/apartments";
import {
  observedSpawnClaims,
  spawnClaimsToRecord,
} from "../../../shared/relations";
import { tabCardKey } from "../../../shared/terminalColor";
import type { TerminalRow } from "../adapters/runtime-ports";
import type { RpcServices } from "../rpc/context";
import { planBoardPatch } from "./board-plan";
import type { BoardOp } from "./board-types";
import type { MoveOutcome } from "./desk-move";
import { type MoveSettle, settlingMessage } from "./move-settle";

/**
 * One side of a move (a Herdr TUI or a herdr-core connection), bound to the
 * generation the browser saw.
 */
export type MoveSide = {
  /** The machine it runs on: "" for this one, else its SSH destination. */
  machine: string;
  rows(): Promise<{
    workspaces: string[];
    panes: TerminalRow[];
    /** Agent names by pane. */
    names: Map<string, string>;
  }>;
  /**
   * Admit closing `pane`: why it would end more than the agent, or the exact
   * set the later close may end (core: the agent alone, no descendants).
   */
  admit(
    pane: TerminalRow,
  ): Promise<{ refusal: string } | { admitted: unknown }>;
  /** The harness session the agent at `pane` runs, if known. */
  session(pane: TerminalRow): Promise<string | null>;
  /** True while a plain terminal runs a program other than its shell. */
  shellBusy(pane: TerminalRow): Promise<boolean>;
  pinned(pane: TerminalRow, colorKey: string): boolean;
  /**
   * Board ops that drop the desk's pin kept under another view of the same
   * Herdr (the endpoint's anchor, web useDeskPins.ts), once it moved away.
   */
  unpinAliases?(colorKey: string): BoardOp[];
  /**
   * Start `kind` with `args` (a shell when null) and wait until it is ready
   * for input.
   */
  start(request: {
    workspaceId: string;
    kind: string | null;
    label: string;
    args: string[];
    cwd?: string;
  }): Promise<
    | { tab_id: string; pane_id: string; terminal_id: string }
    | { message: string; pane_id?: string }
  >;
  /**
   * End `pane`, only within `admitted` when given. Throws when it refused or
   * failed; resolves with `uncertain` when the end was asked but unconfirmed.
   */
  close(
    pane: { pane_id: string; terminal_id: string },
    admitted?: unknown,
  ): Promise<{ uncertain?: string }>;
  /** Pin the new desk: core writes Herdr's label, a TUI desk a Board op. */
  pin(desk: AgentAddress): Promise<BoardOp[]>;
  /**
   * The runtime's own desk move (Herdr's tab.move, world.core.move): the
   * agent keeps running and its Board facts follow.
   */
  moveDesk?(request: {
    tab_id: string;
    workspace_id: string;
  }): Promise<MoveOutcome>;
};

/** One structured line per move step (server log, scope agent-move). */
type MoveLog = (step: string, fields: Record<string, unknown>) => void;

export type AgentMoveDeps = {
  side(connectionId: string, generation: number): MoveSide | null;
  /** The Board, read and patched only (a testing switch may wrap it). */
  board(): Pick<ReturnType<RpcServices["board"]>, "get" | "patch">;
  publishBoardChanged(revision: number): void;
  publishWorldInvalidation(connectionId: string, generation: number): void;
  /**
   * True when both connections reach one runtime (a startup default and a
   * saved profile of one Herdr socket, or of one core): its desks move
   * natively there, never by closing and resuming.
   */
  sameRuntime?(a: string, b: string): boolean;
  /** One move per agent until it settles (move-settle.ts). */
  settle?: MoveSettle;
  log?: MoveLog;
};

export type AgentMoveResult = AgentMoveOutcome;

/**
 * Harnesses that refuse a second open copy of one conversation, so the
 * original closes before the copy resumes. Probe (2026-11-23, isolated
 * Herdr and herdr-core): Codex 0.171's `codex resume <id>` while the
 * original runs stops at "This conversation is open in another app" while
 * Herdr and core report it idle; Claude Code 2.1.330's `--resume <id>`
 * re-attaches to the same session, so Claude starts first and a copy that
 * reports another session is taken as a fork (moveAgentAcross).
 */
const CLOSE_FIRST_HARNESSES: ReadonlySet<string> = new Set(["codex"]);

const text = (value: unknown) => (typeof value === "string" ? value : "");
const locks = new Set<string>();

class Refused extends Error {
  constructor(
    message: string,
    readonly code: AgentMoveRefusal,
  ) {
    super(message);
  }
}
const refuse = (message: string, code: AgentMoveRefusal): never => {
  throw new Refused(message, code);
};
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const where = (a: { connection_id: string; generation: number }) =>
  `${a.connection_id}#${a.generation}`;

/** Why `pane` may not move now, with its agent's `name`. */
async function sourceRefusal(
  side: MoveSide,
  rows: Awaited<ReturnType<MoveSide["rows"]>>,
  from: AgentAddress,
): Promise<{ pane: TerminalRow; name: string } | Refused> {
  const pane = rows.panes.find(
    (row) =>
      row.terminal_id === from.terminal_id && row.pane_id === from.pane_id,
  );
  if (!pane || pane.tab_id !== from.tab_id)
    return new Refused("That agent has gone.", "gone");
  const name =
    rows.names.get(from.pane_id) || (pane.agent ? "agent" : "This terminal");
  if (rows.panes.some((row) => row !== pane && row.tab_id === from.tab_id))
    return new Refused(
      "Only a desk with one terminal moves between runtimes.",
      "split",
    );
  // A plain terminal is busy while it runs a program other than its shell.
  if (!pane.agent)
    return (await side.shellBusy(pane))
      ? new Refused(
          `${name} is running a program. Let it finish, then move it.`,
          "busy",
        )
      : { pane, name };
  const status = text(pane.agent_status);
  if (status !== "idle" && status !== "done")
    return new Refused(
      status === "blocked"
        ? `${name} is waiting for an answer. Answer it, then move it.`
        : `${name} is working. Let it finish, then move it.`,
      "busy",
    );
  return { pane, name };
}

/** Close a destination copy that must not stay; say so if it may still run. */
async function discard(
  side: MoveSide,
  pane: { pane_id: string; terminal_id: string },
  log: MoveLog,
): Promise<string> {
  const warn = " The new copy there may still be running: close it there.";
  try {
    const closed = await side.close(pane);
    log("cleanup", {
      pane: pane.pane_id,
      outcome: closed.uncertain ? "uncertain" : "closed",
    });
    return closed.uncertain ? warn : "";
  } catch (error) {
    log("cleanup", {
      pane: pane.pane_id,
      outcome: "failed",
      message: reason(error),
    });
    return warn;
  }
}

/**
 * Move an agent to a room on another runtime: start its harness there with
 * its conversation resumed, carry its desk (colour, pin, links) over, and
 * close the original. Most harnesses start first and the original closes
 * once the copy is ready; a harness that locks its conversation
 * (CLOSE_FIRST_HARNESSES) or a copy that forked closes the original first and
 * resumes it back where it was when the new start fails. Without a
 * conversation to resume (a plain terminal, or a session World can't find)
 * the move asks first (`confirm`), then starts the same harness fresh, or a
 * new shell, in the same folder. A busy agent is refused. Two connections of
 * one runtime move the desk natively (`moveDesk`), and an agent that just
 * moved refuses another move until it settles.
 */
export async function moveAgentAcross(
  deps: AgentMoveDeps,
  request: AgentMoveRequest,
): Promise<AgentMoveResult> {
  const { source: from, destination: to } = request;
  const base = {
    from: where(from),
    tab: from.tab_id,
    pane: from.pane_id,
    terminal: from.terminal_id,
    desk: from.color_key,
    to: where(to),
    room: to.workspace_id,
  };
  const log: MoveLog = (step, fields) =>
    deps.log?.(step, { ...base, ...fields });
  const lock = `${from.connection_id}\u0000${from.terminal_id}`;
  let result: AgentMoveResult;
  if (locks.has(lock))
    result = {
      status: "refused",
      reason: "moving",
      message: "This agent is already moving.",
    };
  else {
    locks.add(lock);
    try {
      result = await handoff(deps, request, log);
    } catch (error) {
      if (!(error instanceof Refused)) {
        log("outcome", { outcome: "error", message: reason(error) });
        throw error;
      }
      result = {
        status: "refused",
        reason: error.code,
        message: error.message,
      };
    } finally {
      locks.delete(lock);
      deps.publishWorldInvalidation(from.connection_id, from.generation);
      deps.publishWorldInvalidation(to.connection_id, to.generation);
    }
  }
  if (result.status === "moved" || result.status === "uncertain")
    deps.settle?.mark(result.target);
  log("outcome", {
    outcome: result.status,
    ...("reason" in result ? { reason: result.reason } : {}),
    ...("target" in result
      ? {
          at: where(result.target),
          at_tab: result.target.tab_id,
          at_terminal: result.target.terminal_id,
          at_desk: result.target.color_key,
        }
      : {}),
    ...("message" in result ? { message: result.message } : {}),
  });
  return result;
}

async function handoff(
  deps: AgentMoveDeps,
  request: AgentMoveRequest,
  log: MoveLog,
): Promise<AgentMoveResult> {
  const { source: from, destination: to } = request;
  const settling = deps.settle?.wait(from) ?? 0;
  if (settling) refuse(settlingMessage("This agent", settling), "settling");
  const source = deps.side(from.connection_id, from.generation);
  const target = deps.side(to.connection_id, to.generation);
  if (!source || !target)
    refuse("A runtime reconnected. Look again, then move.", "reconnected");
  if (
    from.connection_id === to.connection_id ||
    deps.sameRuntime?.(from.connection_id, to.connection_id)
  )
    return moveNatively(source!, from, to.workspace_id, log);
  if (source!.machine !== target!.machine)
    refuse(
      "Agents move between runtimes on the same machine only.",
      "other_machine",
    );
  const rows = await source!.rows();
  const admitted = await sourceRefusal(source!, rows, from);
  if (admitted instanceof Refused) throw admitted;
  const { pane, name } = admitted;
  if (
    tabCardKey(from.connection_id, from.tab_id, new Set(rows.workspaces)) !==
    from.color_key
  )
    refuse("That desk changed. Look again, then move.", "changed");
  const kind = text(pane.agent) || null;
  const closing = await source!.admit(pane);
  if ("refusal" in closing) refuse(closing.refusal, "children");
  const session = kind ? await source!.session(pane) : null;
  const resume = session
    ? apartmentResumeArgs({ harness: kind!, session_id: session })
    : null;
  if (!resume && !request.fresh)
    return {
      status: "confirm",
      message: kind
        ? `World can't find ${name}'s conversation, so it starts fresh there in the same folder. Its conversation won't continue. Move it anyway?`
        : `${name} starts again as a new shell there in the same folder. What it ran and showed so far stays behind. Move it anyway?`,
    };
  const pinned = source!.pinned(pane, from.color_key);
  const closeFirst = Boolean(resume) && CLOSE_FIRST_HARNESSES.has(kind!);
  log("admit", {
    outcome: "admitted",
    harness: kind ?? "shell",
    session: session ?? "",
    pinned,
    order: closeFirst ? "close-first" : "start-first",
  });

  // Keep the links Herdr's tokens show before the original closes.
  const claims = observedSpawnClaims(
    [
      {
        connection_id: from.connection_id,
        generation: from.generation,
        current: true,
        panes: rows.panes.map((row) => ({
          pane_id: text(row.pane_id),
          terminal_id: text(row.terminal_id),
          tokens: row.tokens,
        })),
      },
    ],
    Date.now(),
  );
  const record = await deps.board().patch(
    planBoardPatch([claims], (document) => {
      const fresh = spawnClaimsToRecord(document.relations.spawns, claims);
      return fresh.length ? [{ op: "spawn.record", claims: fresh }] : null;
    }),
  );
  deps.publishBoardChanged(record.revision);

  const cwd = text(pane.cwd) || text(pane.foreground_cwd);
  const startRequest = {
    kind,
    label: name.slice(0, 64),
    args: resume ?? [],
    ...(to.cwd || cwd ? { cwd: to.cwd || cwd } : {}),
  };
  const rehome = async (a: AgentAddress, b: AgentAddress, ops: BoardOp[]) => {
    const revision = (
      await deps
        .board()
        .patch(
          planBoardPatch([a, b], () => [
            { op: "agent.rehome", from: a, to: b },
            ...ops,
          ]),
        )
    ).revision;
    log("rehome", { desk_from: a.color_key, desk_to: b.color_key, revision });
    deps.publishBoardChanged(revision);
  };
  // The original must still be what was admitted, idle and alone, right
  // before it closes: starting can take a minute.
  const recheck = async (stage: string) => {
    const again = await sourceRefusal(source!, await source!.rows(), from);
    if (
      !(again instanceof Refused) &&
      (text(again.pane.agent) || null) !== kind
    )
      refuse(`${name} changed. Look again, then move.`, "changed");
    log("recheck", {
      stage,
      outcome: again instanceof Refused ? again.code : "same",
    });
    if (again instanceof Refused) throw again;
  };
  const addressAt = async (placed: {
    tab_id: string;
    pane_id: string;
    terminal_id: string;
  }): Promise<AgentAddress> => ({
    connection_id: to.connection_id,
    generation: to.generation,
    workspace_id: to.workspace_id,
    tab_id: placed.tab_id,
    pane_id: placed.pane_id,
    terminal_id: placed.terminal_id,
    color_key: tabCardKey(
      to.connection_id,
      placed.tab_id,
      new Set(
        await target!.rows().then(
          (rows) => rows.workspaces,
          () => [to.workspace_id],
        ),
      ),
    ),
  });
  const startAt = async (
    side: MoveSide,
    workspaceId: string,
    stage: string,
  ) => {
    const started = await side
      .start({ workspaceId, ...startRequest })
      .catch((error: unknown) => ({ message: reason(error), lost: true }));
    log("start", {
      stage,
      room_at: workspaceId,
      ...("message" in started
        ? { outcome: "failed", message: started.message }
        : {
            outcome: "ready",
            at_tab: started.tab_id,
            at_pane: started.pane_id,
            at_terminal: started.terminal_id,
          }),
    });
    return started;
  };
  const saved = () =>
    resume
      ? ` Its conversation is saved: run \`${kind} ${resume.join(" ")}\`${cwd ? ` in ${cwd}` : ""} to continue it.`
      : "";

  /**
   * Close the original, then resume it there. A failed start resumes it
   * back where it was, so the agent runs somewhere unless both fail.
   */
  const closeThenResume = async (): Promise<AgentMoveResult> => {
    await recheck("before-close").catch((error: unknown) => {
      if (error instanceof Refused) throw error;
      refuse(`${reason(error)} It still runs where it was.`, "reconnected");
    });
    let closed: { uncertain?: string } = {};
    try {
      closed = await source!.close(
        { pane_id: from.pane_id, terminal_id: from.terminal_id },
        (closing as { admitted: unknown }).admitted,
      );
      log("close", {
        outcome: closed.uncertain ? "uncertain" : "closed",
        ...(closed.uncertain ? { message: closed.uncertain } : {}),
      });
    } catch (error) {
      const still = await source!.rows().then(
        (now) => now.panes.some((row) => row.terminal_id === from.terminal_id),
        () => null,
      );
      log("close", {
        outcome: still === false ? "ended" : "failed",
        message: reason(error),
        still: still ?? "unknown",
      });
      if (still === true)
        refuse(
          `${name} didn't close where it was: ${reason(error)} It still runs there; nothing started in the new room.`,
          "close_failed",
        );
      if (still === null)
        refuse(
          `World can't tell whether ${name} closed where it was: ${reason(error)} Nothing started in the new room.${saved()}`,
          "close_failed",
        );
    }
    if (closed.uncertain)
      refuse(
        `${name} may still be running where it was: ${closed.uncertain} Nothing started in the new room.${saved()}`,
        "close_failed",
      );
    const started = await startAt(target!, to.workspace_id, "after-close");
    if ("message" in started) {
      const left =
        "pane_id" in started && started.pane_id
          ? await discard(
              target!,
              { pane_id: started.pane_id, terminal_id: "" },
              log,
            )
          : "lost" in started
            ? " The new copy there may still be running: close it there."
            : "";
      // Resume it back where it was.
      const back = await startAt(source!, from.workspace_id, "resume-back");
      if ("message" in back)
        refuse(
          `${name} didn't start there: ${started.message} It didn't resume where it was either: ${back.message}${saved()}${left}`,
          "resume_failed",
        );
      const placed = back as Exclude<typeof back, { message: string }>;
      const restored: AgentAddress = {
        connection_id: from.connection_id,
        generation: from.generation,
        workspace_id: from.workspace_id,
        tab_id: placed.tab_id,
        pane_id: placed.pane_id,
        terminal_id: placed.terminal_id,
        color_key: tabCardKey(
          from.connection_id,
          placed.tab_id,
          new Set(
            await source!.rows().then(
              (now) => now.workspaces,
              () => [from.workspace_id],
            ),
          ),
        ),
      };
      deps.settle?.mark(restored);
      const kept = await (async () =>
        rehome(
          from,
          restored,
          pinned ? await source!.pin(restored) : [],
        ))().then(
        () => "",
        (error: unknown) =>
          ` Its desk details stayed behind: ${reason(error)}.`,
      );
      refuse(
        `${name} didn't start there: ${started.message} It resumed where it was.${kept}${left}`,
        "start_failed",
      );
    }
    const moved = await addressAt(
      started as Exclude<typeof started, { message: string }>,
    );
    try {
      const pinOps = pinned ? await target!.pin(moved) : [];
      await rehome(from, moved, [
        ...pinOps,
        ...(source!.unpinAliases?.(from.color_key) ?? []),
      ]);
    } catch (error) {
      // It moved; only its desk details stayed behind. The original has
      // closed, so nothing undoes: say so (a Board refusal won't pass on an
      // immediate retry; revision races are the Board store's own).
      log("rehome", { outcome: "failed", message: reason(error) });
      return {
        status: "moved",
        target: moved,
        message: `Its desk details stayed behind: ${reason(error)}. Its colour, pin and links stay on its old desk.`,
      };
    }
    return { status: "moved", target: moved };
  };

  if (closeFirst) return closeThenResume();

  const started = await startAt(target!, to.workspace_id, "before-close");
  if ("message" in started) {
    if ("lost" in started)
      // A lost reply: World can't tell whether the copy started.
      refuse(
        `${name} didn't start there: ${started.message} It still runs where it was. The new copy there may still be running: close it there.`,
        "start_failed",
      );
    const left =
      "pane_id" in started && started.pane_id
        ? await discard(
            target!,
            { pane_id: started.pane_id, terminal_id: "" },
            log,
          )
        : "";
    refuse(
      `${name} didn't start there: ${started.message} It still runs where it was.${left}`,
      "start_failed",
    );
  }
  const placed = started as Exclude<typeof started, { message: string }>;
  /**
   * Once the original has closed, drop its pins under the endpoint's other
   * views (the copy carries the pin). A Board refusal only leaves a stale pin.
   */
  const unpinAliases = async () => {
    const ops = source!.unpinAliases?.(from.color_key) ?? [];
    if (!ops.length) return;
    try {
      const { revision } = await deps
        .board()
        .patch(planBoardPatch([from], () => ops));
      log("unpin", { keys: ops.length, revision });
      deps.publishBoardChanged(revision);
    } catch (error) {
      log("unpin", { outcome: "failed", message: reason(error) });
    }
  };
  /** Put the desk back on the original; say so when the Board refused. */
  const unhome = (to: AgentAddress) =>
    rehome(to, from, []).then(
      () => "",
      (error: unknown) =>
        ` Its desk details stay on the new copy: ${reason(error)}.`,
    );
  let moved: AgentAddress;
  let rehomed = false;
  let forked = false;
  try {
    moved = await addressAt(placed);
    // A copy that reports another conversation forked it: the original
    // closes first instead, so one conversation continues.
    if (resume) {
      const copy = (await target!.rows()).panes.find(
        (row) => row.terminal_id === placed.terminal_id,
      );
      const copySession = copy
        ? await target!.session(copy).catch(() => null)
        : null;
      if (copySession && copySession !== session) {
        log("fork", { session, copy_session: copySession });
        forked = true;
      }
    }
    if (!forked) {
      await recheck("after-start");
      const pinOps = pinned ? await target!.pin(moved) : [];
      // The desk moves before the original closes, so its links outlive it.
      // Pins under the original's other views stay until it has closed:
      // a refused or uncertain move keeps them (unpinAliases below).
      await rehome(from, moved, pinOps);
      rehomed = true;
      await recheck("after-rehome");
    }
  } catch (error) {
    const kept = rehomed ? await unhome(moved!) : "";
    refuse(
      `${reason(error)} It still runs where it was.${kept}${await discard(target!, placed, log)}`,
      error instanceof Refused ? error.code : "start_failed",
    );
    throw error;
  }
  if (forked) {
    const left = await discard(target!, placed, log);
    if (left)
      refuse(
        `${name} started there as a new conversation, not its own. It still runs where it was.${left}`,
        "start_failed",
      );
    return closeThenResume();
  }
  let closed: { uncertain?: string } = {};
  try {
    closed = await source!.close(
      { pane_id: from.pane_id, terminal_id: from.terminal_id },
      (closing as { admitted: unknown }).admitted,
    );
    log("close", {
      outcome: closed.uncertain ? "uncertain" : "closed",
      ...(closed.uncertain ? { message: closed.uncertain } : {}),
    });
  } catch (error) {
    const still = await source!.rows().then(
      (now) => now.panes.some((row) => row.terminal_id === from.terminal_id),
      () => null,
    );
    log("close", {
      outcome: still === false ? "ended" : "failed",
      message: reason(error),
      still: still ?? "unknown",
    });
    if (still === false) {
      await unpinAliases();
      return { status: "moved", target: moved };
    }
    // Unreadable after a failed or lost close: it may have ended, so the
    // copy stays (Q57 model: dropping it could leave the agent nowhere).
    if (still === null)
      return {
        status: "uncertain",
        target: moved,
        message: `${name} runs in its new room, but World can't tell whether the original ended: ${reason(error)}`,
      };
    // The original stays: so do its desk and links.
    const kept = await unhome(moved);
    refuse(
      `${name} didn't close where it was: ${reason(error)} It still runs there.${kept}${await discard(target!, placed, log)}`,
      "close_failed",
    );
  }
  if (closed.uncertain)
    return {
      status: "uncertain",
      target: moved,
      message: `${name} runs in its new room, but the original may still be running: ${closed.uncertain}`,
    };
  await unpinAliases();
  return { status: "moved", target: moved };
}

/**
 * Two connections of one runtime (or one connection): the runtime moves the
 * desk itself and the agent keeps running (Herdr's tab.move,
 * world.core.move). Views of one endpoint share room and desk IDs.
 */
async function moveNatively(
  side: MoveSide,
  from: AgentAddress,
  workspaceId: string,
  log: MoveLog,
): Promise<AgentMoveResult> {
  if (!side.moveDesk)
    refuse("Move it within its runtime instead.", "native_refused");
  log("admit", { outcome: "admitted", order: "native" });
  const moved = await side.moveDesk!({
    tab_id: from.tab_id,
    workspace_id: workspaceId,
  });
  log("native", {
    outcome: moved.status,
    ...(moved.status === "moved"
      ? { at_tab: moved.tab_id, room_at: moved.workspace_id }
      : { message: moved.message }),
  });
  if (moved.status === "refused") refuse(moved.message, "native_refused");
  if (moved.status === "failed" && moved.rolled_back)
    refuse(moved.message, "native_refused");
  if (moved.status === "failed")
    return { status: "uncertain", target: from, message: moved.message };
  const done = moved as Extract<MoveOutcome, { status: "moved" }>;
  const workspaces = await side.rows().then(
    (rows) => rows.workspaces,
    () => [done.workspace_id],
  );
  return {
    status: "moved",
    target: {
      connection_id: from.connection_id,
      generation: from.generation,
      workspace_id: done.workspace_id,
      tab_id: done.tab_id,
      pane_id:
        done.panes.find((p) => p.previous === from.pane_id)?.current ??
        from.pane_id,
      terminal_id: from.terminal_id,
      color_key: tabCardKey(
        from.connection_id,
        done.tab_id,
        new Set(workspaces),
      ),
    },
  };
}
