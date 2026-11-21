import type { AgentAddress, AgentMoveRequest } from "../../../shared/agentMove";
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
  /** Why closing `pane` would end more than the agent, if it would. */
  blocker(pane: TerminalRow): Promise<string | null>;
  /** The harness session the agent at `pane` runs, if known. */
  session(pane: TerminalRow): Promise<string | null>;
  pinned(pane: TerminalRow, colorKey: string): boolean;
  /** Start `kind` resumed and wait until it is ready for input. */
  start(request: {
    workspaceId: string;
    kind: string;
    label: string;
    args: string[];
    cwd?: string;
  }): Promise<
    | { tab_id: string; pane_id: string; terminal_id: string }
    | { message: string; pane_id?: string }
  >;
  close(pane: { pane_id: string; terminal_id: string }): Promise<void>;
  /** Pin the new desk: core writes Herdr's label, a TUI desk a Board op. */
  pin(desk: AgentAddress): Promise<BoardOp[]>;
};

export type AgentMoveDeps = {
  side(connectionId: string, generation: number): MoveSide | null;
  board: RpcServices["board"];
  publishBoardChanged(revision: number): void;
  publishWorldInvalidation(connectionId: string, generation: number): void;
};

export type AgentMoveResult =
  | { status: "moved"; target: AgentAddress }
  | { status: "refused"; message: string };

const MOVABLE = new Set(["claude", "codex"]);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const locks = new Set<string>();

class Refused extends Error {}
const refuse = (message: string): never => {
  throw new Refused(message);
};

/**
 * Move an agent to a room on another runtime: start its harness there with
 * its conversation resumed, wait until it is ready, carry its desk (colour,
 * pin, links) over, then close the original. A busy agent is refused; a
 * failed start leaves the original running.
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
    const pane = rows.panes.find(
      (row) =>
        row.terminal_id === from.terminal_id && row.pane_id === from.pane_id,
    );
    if (!pane || pane.tab_id !== from.tab_id) refuse("That agent has gone.");
    if (
      tabCardKey(from.connection_id, from.tab_id, new Set(rows.workspaces)) !==
      from.color_key
    )
      refuse("That desk changed. Look again, then move.");
    const name = rows.names.get(from.pane_id) || "agent";
    const kind = text(pane!.agent);
    if (!MOVABLE.has(kind))
      refuse("Only Claude and Codex agents move between runtimes.");
    const status = text(pane!.agent_status);
    if (status !== "idle" && status !== "done")
      refuse(
        status === "blocked"
          ? `${name} is waiting for an answer. Answer it, then move it.`
          : `${name} is working. Let it finish, then move it.`,
      );
    if (rows.panes.some((row) => row !== pane && row.tab_id === from.tab_id))
      refuse("Only a desk with one terminal moves between runtimes.");
    const blocked = await source!.blocker(pane!);
    if (blocked) refuse(blocked);
    const session = await source!.session(pane!);
    const args = session
      ? apartmentResumeArgs({ harness: kind, session_id: session })
      : null;
    if (!args) refuse(`World can't find ${name}'s conversation to resume.`);
    const pinned = source!.pinned(pane!, from.color_key);

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

    const cwd = text(pane!.cwd) || text(pane!.foreground_cwd);
    const started = await target!.start({
      workspaceId: to.workspace_id,
      kind,
      label: name.slice(0, 64),
      args: args!,
      ...(to.cwd || cwd ? { cwd: to.cwd || cwd } : {}),
    });
    if ("message" in started) {
      if (started.pane_id)
        await target!
          .close({ pane_id: started.pane_id, terminal_id: "" })
          .catch(() => {});
      refuse(
        `${name} didn't start there: ${started.message} It still runs where it was.`,
      );
    }
    const placed = started as Exclude<typeof started, { message: string }>;
    const after = await target!.rows();
    const moved: AgentAddress = {
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
    const rehomed = await deps
      .board()
      .patch(
        planBoardPatch([from, moved], () => [
          { op: "agent.rehome", from, to: moved },
          ...pinOps,
        ]),
      );
    deps.publishBoardChanged(rehomed.revision);
    await source!.close({
      pane_id: from.pane_id,
      terminal_id: from.terminal_id,
    });
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
      blocker: async () => null,
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
      pinned: (_pane, colorKey) =>
        Boolean(services.board().get().layout.desk_pins[colorKey]),
      async start(request) {
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
    async blocker(pane) {
      const plan = await planCoreKill(lease, [text(pane.terminal_id)]);
      return plan.descendants.length
        ? "Agents it started would end with it. Let them finish, then move it."
        : null;
    },
    async session(pane) {
      const known = await host
        .agentSessions()
        .knownSession(text(pane.terminal_id), text(pane.agent));
      return known?.id ?? null;
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
        if (pane.agent === request.kind && pane.agent_status === "idle")
          return outcome;
        await sleep(1_000);
      }
      return { message: "It wasn't ready in time.", pane_id: outcome.pane_id };
    },
    async close(pane) {
      if (!pane.terminal_id) {
        const found = (await rows()).panes.find(
          (row) => row.pane_id === pane.pane_id,
        );
        if (!found) return;
        pane = { ...pane, terminal_id: text(found.terminal_id) };
      }
      const plan = await planCoreKill(lease, [pane.terminal_id]);
      await killCore(
        lease,
        [pane.terminal_id],
        parseCoreKillConfirmation({
          core_id: plan.core_id,
          terminals: [...plan.roots, ...plan.descendants],
        }),
      );
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
