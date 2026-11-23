import { tabCardKey } from "../../../shared/terminalColor";
import type { TerminalRow } from "../adapters/runtime-ports";
import { launchAgent } from "../agent/launch";
import { CoreOperationFence } from "../herdr-core/fence";
import { isIdleShell } from "../herdr-core/harness";
import { resolveCoreExecutable } from "../herdr-core/host";
import {
  killCore,
  launchCore,
  parseCoreKillConfirmation,
  planCoreKill,
} from "../herdr-core/operations";
import { favouriteToShare } from "../herdr-core/shared-state";
import { moveCore } from "../herdr-core/town-move";
import type { RpcServices } from "../rpc/context";
import type { AgentMoveDeps, MoveSide } from "./agent-move";
import { planBoardPatch } from "./board-plan";
import type { BoardOp } from "./board-types";
import type { MoveOutcome } from "./desk-move";
import { worldRuntimeLease } from "./runtime-lease";
import { executeTownMove } from "./town-move";

/** The real move sides (Herdr TUI or herdr-core) behind agent-move.ts. */

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Board facts follow a native herdr-core desk move: core gives the desk a
 * new tab ID while its terminals stay, so its colour, place, pin rank,
 * appearance and strings move to the new key (agent.rehome per terminal),
 * as town-move.ts does for a Herdr TUI desk move.
 */
export async function followCoreDeskMove(
  deps: Pick<AgentMoveDeps, "board" | "publishBoardChanged">,
  at: { connection_id: string; generation: number; tab_id: string },
  before: { workspaces: string[]; panes: TerminalRow[] },
  moved: MoveOutcome,
  workspacesAfter: string[],
): Promise<number | null> {
  if (moved.status !== "moved") return null;
  const fromKey = tabCardKey(
    at.connection_id,
    at.tab_id,
    new Set(before.workspaces),
  );
  const toKey = tabCardKey(
    at.connection_id,
    moved.tab_id,
    new Set(workspacesAfter),
  );
  if (fromKey === toKey) return null;
  const ops: BoardOp[] = before.panes
    .filter((pane) => pane.tab_id === at.tab_id && text(pane.terminal_id))
    .map((pane) => {
      const paneId = text(pane.pane_id);
      const address = {
        connection_id: at.connection_id,
        generation: at.generation,
        pane_id: paneId,
        terminal_id: text(pane.terminal_id),
      };
      return {
        op: "agent.rehome",
        from: {
          ...address,
          workspace_id: text(pane.workspace_id),
          tab_id: at.tab_id,
          color_key: fromKey,
        },
        to: {
          ...address,
          workspace_id: moved.workspace_id,
          tab_id: moved.tab_id,
          pane_id:
            moved.panes.find((p) => p.previous === paneId)?.current ?? paneId,
          color_key: toKey,
        },
      };
    });
  if (!ops.length) return null;
  const { revision } = await deps
    .board()
    .patch(planBoardPatch([ops], () => ops));
  deps.publishBoardChanged(revision);
  return revision;
}

const READY_MS = 60_000;

/** The real sides: a Herdr TUI connection or a herdr-core one. */
export function moveSide(
  services: Pick<RpcServices, "connectionManager" | "coreControl" | "board"> &
    Partial<
      Pick<RpcServices, "townMoveQueues" | "publishBoardChanged" | "logger">
    >,
  connectionId: string,
  generation: number,
  sleep = (ms: number) => new Promise((done) => setTimeout(done, ms)),
  /** Every connection of this runtime's endpoint, this one included. */
  aliases: readonly string[] = [connectionId],
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
  const rest = (colorKey: string) =>
    colorKey.startsWith(`${connectionId}:`)
      ? colorKey.slice(connectionId.length + 1)
      : null;
  const aliasKeys = (colorKey: string) => {
    const tail = rest(colorKey);
    return tail === null
      ? [colorKey]
      : [...new Set([connectionId, ...aliases])].map((id) => `${id}:${tail}`);
  };
  const publishBoard = (revision: number) =>
    services.publishBoardChanged?.(revision);
  if (resolved.kind === "tui") {
    const { runtime } = resolved.lease;
    const call = (method: string, params: Record<string, unknown>) =>
      runtime.tui.call(method, params, 70_000);
    /** True unless the pane's shell is alone in front. */
    const busy = async (pane: TerminalRow) => {
      const info = (await call("pane.process_info", {
        pane_id: text(pane.pane_id),
      }).catch(() => null)) as {
        process_info?: Record<string, unknown>;
      } | null;
      const process = info?.process_info;
      return (
        !process ||
        typeof process.shell_pid !== "number" ||
        process.foreground_process_group_id !== process.shell_pid
      );
    };
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
      shellBusy: busy,
      // Views of one Herdr share tab IDs; Town keeps the pin under the
      // endpoint's anchor (web useDeskPins.ts), so read every view's key.
      pinned: (_pane, colorKey) => {
        const pins = services.board().get().layout.desk_pins;
        return aliasKeys(colorKey).some((key) => Boolean(pins[key]));
      },
      unpinAliases: (colorKey) => {
        const pins = services.board().get().layout.desk_pins;
        return aliasKeys(colorKey)
          .filter((key) => key !== colorKey && pins[key])
          .map((key) => ({ op: "desk.unpin", key }));
      },
      moveDesk: (request) =>
        executeTownMove(
          {
            connectionId,
            generation,
            call: (method, params) => runtime.tui.call(method, params, 15_000),
            isCurrent: resolved.isCurrent,
            queues: services.townMoveQueues ?? new Map(),
            board: services.board(),
            publishBoard,
            onFollowError: (error) =>
              services.logger?.warn("Board did not follow a move", {
                detail: String(error),
              }),
          },
          { kind: "desk", ...request, allow_close_room: false },
        ),
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
          if (!tab_id || !pane_id || !terminal_id)
            return {
              message: "Herdr did not confirm the new tab.",
              ...(pane_id ? { pane_id } : {}),
            };
          // Ready once Herdr shows the new pane with its shell in front.
          for (let waited = 0; waited < READY_MS; waited += 1_000) {
            if (!resolved.isCurrent())
              return { message: "The host reconnected.", pane_id };
            const now = await rows().catch(() => null);
            if (!now) return { message: "World lost the host.", pane_id };
            const live = now.panes.find((row) => row.pane_id === pane_id);
            if (!live) return { message: "Its shell exited at once.", pane_id };
            if (!(await busy(live))) return { tab_id, pane_id, terminal_id };
            await sleep(1_000);
          }
          return { message: "Its shell wasn't ready in time.", pane_id };
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
      // Idle only while its own shell is alone in front: any other program,
      // even one core started as the terminal's own (`sleep 3600`), is busy.
      const record = lease.runtime.core.mirror
        .terminals()
        .find((t) => t.address === text(pane.terminal_id));
      if (!record) return true;
      const front = record.foreground as
        | { pid?: unknown; name?: unknown; argv?: unknown }
        | undefined;
      if ((front?.pid ?? record.pid) !== record.pid) return true;
      const named = (p?: { name?: unknown; argv?: unknown }) =>
        Boolean(p?.name || (Array.isArray(p?.argv) && p.argv.length));
      const program = named(front) ? front! : { argv: record.argv };
      // Started without a program, core runs the account's shell.
      return named(program) && !isIdleShell(program, record.pid);
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
        const now = await rows().catch(() => null);
        if (!now)
          return { message: "World lost the host.", pane_id: outcome.pane_id };
        const pane = now.panes.find(
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
    async moveDesk(request) {
      const before = await rows();
      const moved = await moveCore(lease, core.topology, {
        kind: "desk",
        ...request,
      });
      await followCoreDeskMove(
        { board: services.board, publishBoardChanged: publishBoard },
        { connection_id: connectionId, generation, tab_id: request.tab_id },
        before,
        moved,
        await rows().then(
          (now) => now.workspaces,
          () => before.workspaces,
        ),
      );
      return moved;
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
