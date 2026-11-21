import type {
  AgentAddress,
  AgentMoveOutcome,
  AgentMoveRequest,
} from "../../../shared/agentMove";
import { apartmentResumeArgs } from "../../../shared/apartments";
import {
  observedSpawnClaims,
  spawnClaimsToRecord,
} from "../../../shared/relations";
import { tabCardKey } from "../../../shared/terminalColor";
import type { TerminalRow } from "../adapters/runtime-ports";
import { launchAgent } from "../agent/launch";
import { CoreOperationFence } from "../herdr-core/fence";
import { resolveCoreExecutable } from "../herdr-core/host";
import {
  killCore,
  launchCore,
  parseCoreKillConfirmation,
  planCoreKill,
} from "../herdr-core/operations";
import { favouriteToShare } from "../herdr-core/shared-state";
import type { RpcServices } from "../rpc/context";
import { planBoardPatch } from "./board-plan";
import type { BoardOp } from "./board-types";
import { worldRuntimeLease } from "./runtime-lease";

/**
 * One side of a move across runtimes (a Herdr TUI or a herdr-core
 * connection), bound to the generation the browser saw. Moves within one
 * runtime use that runtime's own move (tab.move, world.core.move).
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
};

export type AgentMoveDeps = {
  side(connectionId: string, generation: number): MoveSide | null;
  board: RpcServices["board"];
  publishBoardChanged(revision: number): void;
  publishWorldInvalidation(connectionId: string, generation: number): void;
};

export type AgentMoveResult = AgentMoveOutcome;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const locks = new Set<string>();

class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message);
};
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Why `pane` may not move now, with its agent's `name`. */
async function sourceRefusal(
  side: MoveSide,
  rows: Awaited<ReturnType<MoveSide["rows"]>>,
  from: AgentAddress,
): Promise<{ pane: TerminalRow; name: string } | string> {
  const pane = rows.panes.find(
    (row) =>
      row.terminal_id === from.terminal_id && row.pane_id === from.pane_id,
  );
  if (!pane || pane.tab_id !== from.tab_id) return "That agent has gone.";
  const name =
    rows.names.get(from.pane_id) || (pane.agent ? "agent" : "This terminal");
  if (rows.panes.some((row) => row !== pane && row.tab_id === from.tab_id))
    return "Only a desk with one terminal moves between runtimes.";
  // A plain terminal is busy while it runs a program other than its shell.
  if (!pane.agent)
    return (await side.shellBusy(pane))
      ? `${name} is running a program. Let it finish, then move it.`
      : { pane, name };
  const status = text(pane.agent_status);
  if (status !== "idle" && status !== "done")
    return status === "blocked"
      ? `${name} is waiting for an answer. Answer it, then move it.`
      : `${name} is working. Let it finish, then move it.`;
  return { pane, name };
}

/** Close a destination copy that must not stay; say so if it may still run. */
async function discard(
  side: MoveSide,
  pane: { pane_id: string; terminal_id: string },
): Promise<string> {
  const warn = " The new copy there may still be running: close it there.";
  try {
    return (await side.close(pane)).uncertain ? warn : "";
  } catch {
    return warn;
  }
}

/**
 * Move an agent to a room on another runtime: start its harness there with
 * its conversation resumed, wait until it is ready, carry its desk (colour,
 * pin, links) over, then close the original. Without a conversation to
 * resume (a plain terminal, or a session World can't find) the move asks
 * first (`confirm`), then starts the same harness fresh, or a new shell, in
 * the same folder. A busy agent is refused; a failed start leaves the
 * original running.
 */
export async function moveAgentAcross(
  deps: AgentMoveDeps,
  request: AgentMoveRequest,
): Promise<AgentMoveResult> {
  const { source: from, destination: to } = request;
  const lock = `${from.connection_id}\u0000${from.terminal_id}`;
  if (locks.has(lock))
    return { status: "refused", message: "This agent is already moving." };
  locks.add(lock);
  try {
    if (from.connection_id === to.connection_id)
      refuse("Move it within its runtime instead.");
    const source = deps.side(from.connection_id, from.generation);
    const target = deps.side(to.connection_id, to.generation);
    if (!source || !target)
      refuse("A runtime reconnected. Look again, then move.");
    if (source!.machine !== target!.machine)
      refuse("Agents move between runtimes on the same machine only.");
    const rows = await source!.rows();
    const admitted = await sourceRefusal(source!, rows, from);
    if (typeof admitted === "string") refuse(admitted);
    const { pane, name } = admitted as Exclude<typeof admitted, string>;
    if (
      tabCardKey(from.connection_id, from.tab_id, new Set(rows.workspaces)) !==
      from.color_key
    )
      refuse("That desk changed. Look again, then move.");
    const kind = text(pane.agent) || null;
    const closing = await source!.admit(pane);
    if ("refusal" in closing) refuse(closing.refusal);
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
    const started = await target!.start({
      workspaceId: to.workspace_id,
      kind,
      label: name.slice(0, 64),
      args: resume ?? [],
      ...(to.cwd || cwd ? { cwd: to.cwd || cwd } : {}),
    });
    if ("message" in started) {
      const left = started.pane_id
        ? await discard(target!, { pane_id: started.pane_id, terminal_id: "" })
        : "";
      refuse(
        `${name} didn't start there: ${started.message} It still runs where it was.${left}`,
      );
    }
    const placed = started as Exclude<typeof started, { message: string }>;
    const rehome = async (a: AgentAddress, b: AgentAddress, ops: BoardOp[]) =>
      deps.publishBoardChanged(
        (
          await deps
            .board()
            .patch(
              planBoardPatch([a, b], () => [
                { op: "agent.rehome", from: a, to: b },
                ...ops,
              ]),
            )
        ).revision,
      );
    // The original must still be what was admitted, idle and alone, right
    // before it closes: starting can take a minute.
    const recheck = async () => {
      const again = await sourceRefusal(source!, await source!.rows(), from);
      if (typeof again === "string") refuse(again);
      if ((text((again as { pane: TerminalRow }).pane.agent) || null) !== kind)
        refuse(`${name} changed. Look again, then move.`);
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
    try {
      await recheck();
      const after = await target!.rows();
      moved = {
        connection_id: to.connection_id,
        generation: to.generation,
        workspace_id: to.workspace_id,
        tab_id: placed.tab_id,
        pane_id: placed.pane_id,
        terminal_id: placed.terminal_id,
        color_key: tabCardKey(
          to.connection_id,
          placed.tab_id,
          new Set(after.workspaces),
        ),
      };
      const pinOps = pinned ? await target!.pin(moved) : [];
      // The desk moves before the original closes, so its links outlive it.
      await rehome(from, moved, pinOps);
      rehomed = true;
      await recheck();
    } catch (error) {
      const kept = rehomed ? await unhome(moved!) : "";
      refuse(
        `${reason(error)} It still runs where it was.${kept}${await discard(target!, placed)}`,
      );
      throw error;
    }
    let closed: { uncertain?: string } = {};
    try {
      closed = await source!.close(
        { pane_id: from.pane_id, terminal_id: from.terminal_id },
        (closing as { admitted: unknown }).admitted,
      );
    } catch (error) {
      const still = await source!
        .rows()
        .then((now) =>
          now.panes.some((row) => row.terminal_id === from.terminal_id),
        )
        .catch(() => true);
      if (!still) return { status: "moved", target: moved };
      // The original stays: so do its desk and links.
      const kept = await unhome(moved);
      refuse(
        `${name} didn't close where it was: ${reason(error)} It still runs there.${kept}${await discard(target!, placed)}`,
      );
    }
    if (closed.uncertain)
      return {
        status: "uncertain",
        target: moved,
        message: `${name} runs in its new room, but the original may still be running: ${closed.uncertain}`,
      };
    return { status: "moved", target: moved };
  } catch (error) {
    if (error instanceof Refused)
      return { status: "refused", message: error.message };
    throw error;
  } finally {
    locks.delete(lock);
    deps.publishWorldInvalidation(from.connection_id, from.generation);
    deps.publishWorldInvalidation(to.connection_id, to.generation);
  }
}

const READY_MS = 60_000;

/** The real sides: a Herdr TUI connection or a herdr-core one. */
export function moveSide(
  services: Pick<RpcServices, "connectionManager" | "coreControl" | "board">,
  connectionId: string,
  generation: number,
  sleep = (ms: number) => new Promise((done) => setTimeout(done, ms)),
): MoveSide | null {
  const resolved = worldRuntimeLease(services, connectionId, generation);
  if (!resolved) return null;
  const operations = resolved.lease.runtime.operations;
  const rows = async () => {
    const [{ workspaces = [] }, { panes = [] }, { agents = [] }] =
      await Promise.all([
        operations.listWorkspaces(),
        operations.listTerminals(),
        operations.listAgents(),
      ]);
    return {
      workspaces: workspaces.map((row) => text(row.workspace_id)),
      panes,
      names: new Map(agents.map((row) => [text(row.pane_id), text(row.name)])),
    };
  };
  const base = { rows };
  if (resolved.kind === "tui") {
    const { runtime } = resolved.lease;
    const call = (method: string, params: Record<string, unknown>) =>
      runtime.tui.call(method, params, 70_000);
    return {
      ...base,
      machine: runtime.sshHost() ?? "",
      admit: async () => ({ admitted: null }),
      async session(pane) {
        const agent = await runtime.operations
          .getAgent({ target: text(pane.pane_id) })
          .catch(() => ({ agent: undefined }));
        for (const value of [pane.agent_session, agent.agent?.agent_session])
          if (value && typeof value === "object") {
            const id = text((value as { value?: unknown }).value);
            if (id) return id;
          }
        return null;
      },
      async shellBusy(pane) {
        const info = (await call("pane.process_info", {
          pane_id: text(pane.pane_id),
        })) as { process_info?: Record<string, unknown> } | null;
        const process = info?.process_info;
        return (
          !process ||
          typeof process.shell_pid !== "number" ||
          process.foreground_process_group_id !== process.shell_pid
        );
      },
      pinned: (_pane, colorKey) =>
        Boolean(services.board().get().layout.desk_pins[colorKey]),
      async start(request) {
        if (request.kind === null) {
          const made = (await call("tab.create", {
            workspace_id: request.workspaceId,
            label: request.label,
            ...(request.cwd ? { cwd: request.cwd } : {}),
          })) as {
            tab?: { tab_id?: unknown };
            root_pane?: { pane_id?: unknown; terminal_id?: unknown };
          } | null;
          const tab_id = text(made?.tab?.tab_id);
          const pane_id = text(made?.root_pane?.pane_id);
          const terminal_id = text(made?.root_pane?.terminal_id);
          return tab_id && pane_id && terminal_id
            ? { tab_id, pane_id, terminal_id }
            : { message: "Herdr did not confirm the new tab." };
        }
        const outcome = await launchAgent(call, {
          workspace_id: request.workspaceId,
          kind: request.kind,
          label: request.label,
          args: request.args,
          text: "",
          ...(request.cwd ? { cwd: request.cwd } : {}),
          isCurrent: resolved.isCurrent,
        });
        if (outcome.status === "started" || outcome.status === "sent")
          return outcome;
        return {
          message: "message" in outcome ? outcome.message : "",
          ...(outcome.pane_id ? { pane_id: outcome.pane_id } : {}),
        };
      },
      async close(pane) {
        await call("pane.close", { pane_id: pane.pane_id });
        return {};
      },
      pin: async (desk) => [
        { op: "desk.pin", key: desk.color_key, cell: null },
      ],
    };
  }
  const core = services.coreControl!;
  const { lease } = resolved;
  const host = core.hostRuntime(lease);
  return {
    ...base,
    machine: host.sshHost() ?? "",
    async admit(pane) {
      const plan = await planCoreKill(lease, [text(pane.terminal_id)]);
      return plan.descendants.length
        ? {
            refusal:
              "Agents it started would end with it. Let them finish, then move it.",
          }
        : { admitted: { core_id: plan.core_id, terminals: plan.roots } };
    },
    async session(pane) {
      const known = await host
        .agentSessions()
        .knownSession(text(pane.terminal_id), text(pane.agent));
      return known?.id ?? null;
    },
    async shellBusy(pane) {
      // Busy while its foreground program is not the shell core started.
      const record = lease.runtime.core.mirror
        .terminals()
        .find((t) => t.address === text(pane.terminal_id));
      const foreground = record?.foreground as { pid?: unknown } | undefined;
      return !record || (foreground?.pid ?? record.pid) !== record.pid;
    },
    pinned: (pane) => pane.favourite === true,
    async start(request) {
      const outcome = await launchCore(
        lease,
        { ...request, text: "" },
        {
          topology: core.topology,
          resolveExecutable: (kind) => {
            const reach = core.host(connectionId);
            if (!reach) throw new Error("World cannot reach that host");
            return resolveCoreExecutable(reach, kind);
          },
        },
      );
      if (!("pane_id" in outcome) || outcome.status === "uncertain")
        return {
          message: outcome.message ?? "core did not confirm it.",
          ...("pane_id" in outcome ? { pane_id: outcome.pane_id } : {}),
        };
      // Ready once core reports the harness idle at its terminal.
      for (let waited = 0; waited < READY_MS; waited += 1_000) {
        if (!resolved.isCurrent())
          return { message: "The host reconnected.", pane_id: outcome.pane_id };
        const pane = (await rows()).panes.find(
          (row) => row.terminal_id === outcome.terminal_id,
        );
        if (!pane)
          return { message: "It exited at once.", pane_id: outcome.pane_id };
        if (
          request.kind === null ||
          (pane.agent === request.kind && pane.agent_status === "idle")
        )
          return outcome;
        await sleep(1_000);
      }
      return { message: "It wasn't ready in time.", pane_id: outcome.pane_id };
    },
    async close(pane, admitted) {
      if (!pane.terminal_id) {
        const found = (await rows()).panes.find(
          (row) => row.pane_id === pane.pane_id,
        );
        if (!found) return {};
        pane = { ...pane, terminal_id: text(found.terminal_id) };
      }
      // Only what was admitted ends: a child started since refuses the kill.
      let confirm = admitted;
      if (!confirm) {
        const plan = await planCoreKill(lease, [pane.terminal_id]);
        if (plan.descendants.length)
          return { uncertain: "it started agents, so World left it running." };
        confirm = { core_id: plan.core_id, terminals: plan.roots };
      }
      const outcome = await killCore(
        lease,
        [pane.terminal_id],
        parseCoreKillConfirmation(confirm),
      );
      if (outcome.uncertain.length)
        return { uncertain: "core didn't confirm it ended." };
      return {};
    },
    async pin(desk) {
      const fence = CoreOperationFence.admit(lease, desk.terminal_id);
      await lease.runtime.shareLabel(fence, (record) =>
        favouriteToShare(record, true),
      );
      return [];
    },
  };
}
