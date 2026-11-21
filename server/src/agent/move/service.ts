import { shQuote } from "../../utils/process-utils";
import {
  observedSpawnClaims,
  spawnClaimsToRecord,
} from "../../../../shared/relations";
import type {
  AgentAddress,
  AgentMoveRequest,
} from "../../../../shared/agentMove";
import type { RpcServices } from "../../rpc/context";
import { planBoardPatch } from "../../world/board-plan";
import { moveRuntime } from "./runtime";
import { handoff } from "./handoff";
import { assertNoBackground, moveProcesses } from "./processes";
import {
  copyMoveSession,
  prepareShell,
  readMoveSession,
  resumeInShell,
  type PreparedShell,
} from "./session";
import { observeUntil } from "./wait";

const active = new WeakMap<RpcServices, Set<string>>();
export async function moveAgent(
  services: RpcServices,
  request: AgentMoveRequest,
  authorized: () => boolean = () => true,
) {
  const authorize = () => {
    if (!authorized())
      throw new Error("The move request is no longer authorized.");
  };
  authorize();
  const source = moveRuntime(
    services,
    request.source.connection_id,
    request.source.generation,
  );
  const destination = moveRuntime(
    services,
    request.destination.connection_id,
    request.destination.generation,
  );
  if (
    request.source.connection_id === request.destination.connection_id &&
    request.source.workspace_id === request.destination.workspace_id
  )
    throw new Error("Choose a different room, runtime or host.");
  const locks = active.get(services) ?? new Set<string>();
  active.set(services, locks);
  const key = JSON.stringify([
    request.source.connection_id,
    request.source.terminal_id,
  ]);
  if (locks.has(key))
    throw new Error("This agent already has a move in progress.");
  locks.add(key);
  let identityKey = "";
  let identityLocked = false;
  let recovery: PreparedShell | undefined, target: PreparedShell | undefined;
  let protectedDetails = false;
  let destinationChosen = false;
  let recoveryAddress: AgentAddress | undefined,
    targetAddress: AgentAddress | undefined;
  const rehome = async (
    from: AgentAddress,
    to: AgentAddress,
    previous?: AgentAddress,
  ) => {
    source.current();
    destination.current();
    const remaining =
      from.connection_id === request.source.connection_id
        ? (await source.rows()).panes
            .filter(
              (p) =>
                p.tab_id === from.tab_id &&
                p.terminal_id !== from.terminal_id &&
                p.terminal_id !== request.source.terminal_id &&
                p.terminal_id !== recoveryAddress?.terminal_id,
            )
            .map((p) => String(p.terminal_id))
        : [];
    const document = await services.board().patch(
      planBoardPatch([from, to, previous, remaining], () => {
        source.current();
        destination.current();
        return [
          {
            op: "agent.rehome",
            from,
            to,
            remaining,
            ...(previous ? { previous } : {}),
          },
        ];
      }),
    );
    services.publishBoardChanged(document.revision);
  };
  try {
    const session = await readMoveSession(source, request.source);
    const destinationCwd = request.destination.cwd?.trim() || session.cwd;
    if (
      !destinationCwd.startsWith("/") ||
      destinationCwd.length > 4096 ||
      /[\r\n\0]/.test(destinationCwd)
    )
      throw new Error("Choose an absolute folder on the destination host.");
    identityKey = `${session.kind}:${session.id}`;
    if (locks.has(identityKey))
      throw new Error("This conversation already has a move in progress.");
    locks.add(identityKey);
    identityLocked = true;
    let pids: number[] = [];
    const checkBackground = async () => {
      authorize();
      const now = await readMoveSession(source, request.source);
      if (
        now.id !== session.id ||
        now.kind !== session.kind ||
        now.group !== session.group ||
        JSON.stringify(now.launchArgs) !== JSON.stringify(session.launchArgs)
      )
        throw new Error(
          "The source conversation or process changed before the move.",
        );
      pids = assertNoBackground(
        moveProcesses(await source.run("ps -axo pid=,ppid=,pgid=,args=")),
        session.group,
        session.kind,
      );
      if (source.hasDependentTerminals(request.source))
        throw new Error(
          "This agent has dependent runtime terminals. End their background work before moving.",
        );
      const rows = await source.rows();
      if (
        rows.panes.some(
          (pane) =>
            (pane.tokens as Record<string, unknown> | undefined)
              ?.spawned_by_terminal === request.source.terminal_id &&
            !["idle", "done"].includes(String(pane.agent_status)),
        )
      )
        throw new Error(
          "A spawned helper still has work running or needs attention. Let it finish before moving.",
        );
    };
    await checkBackground();
    const native = await source.rows();
    const sourcePane = native.panes.find(
      (p) => p.terminal_id === request.source.terminal_id,
    );
    const pinned = Boolean(
      sourcePane?.favourite ||
        services.board().get().layout.desk_pins[request.source.color_key],
    );
    const claims = observedSpawnClaims(
      [
        {
          connection_id: request.source.connection_id,
          generation: request.source.generation,
          current: true,
          panes: native.panes.map((p) => ({
            pane_id: String(p.pane_id),
            terminal_id: String(p.terminal_id),
            tokens: p.tokens,
          })),
        },
      ],
      Date.now(),
    );
    const remembered = await services.board().patch(
      planBoardPatch([claims, request.source], (document) => {
        source.current();
        const newClaims = spawnClaimsToRecord(
          document.relations.spawns,
          claims,
        );
        return [
          ...(newClaims.length
            ? [{ op: "spawn.record" as const, claims: newClaims }]
            : []),
          ...(pinned && !document.layout.desk_pins[request.source.color_key]
            ? [
                {
                  op: "desk.pin" as const,
                  key: request.source.color_key,
                  cell: null,
                },
              ]
            : []),
        ];
      }),
    );
    services.publishBoardChanged(remembered.revision);
    const result = await handoff({
      async prepare() {
        const topology = await destination.rows();
        if (
          !topology.workspaces.some(
            (w) => w.workspace_id === request.destination.workspace_id,
          )
        )
          throw new Error("The destination room is no longer available.");
        const label = String(
          (await source.rows()).tabs.find(
            (t) => t.tab_id === request.source.tab_id,
          )?.label ?? session.kind,
        );
        recoveryAddress = await source.openShell(
          session.cwd,
          label,
          session.cwd,
          request.source,
        );
        // Keep this native tab alive, including a directly launched core agent's tab.
        recovery = await prepareShell(
          source,
          recoveryAddress,
          session,
          session.cwd,
        );
        targetAddress = await destination.openShell(
          request.destination.workspace_id,
          label,
          destinationCwd,
        );
        target = await prepareShell(
          destination,
          targetAddress,
          session,
          destinationCwd,
        );
        await copyMoveSession(source, target, session);
        // The idle recovery terminal witnesses these details even after native exit cleanup.
        await rehome(request.source, recovery.address);
        protectedDetails = true;
      },
      recheck: checkBackground,
      async quit() {
        authorize();
        source.current();
        destination.current();
        await source.run(`kill -TERM -${session.group}`);
      },
      async sourceStopped() {
        const stopped = async () => {
          const processes = moveProcesses(
            await source.run("ps -axo pid=,ppid=,pgid=,args="),
          );
          return processes.some((p) => pids.includes(p.pid)) ? null : true;
        };
        if (await stopped()) return true;
        try {
          return await observeUntil(source.subscribe, stopped);
        } catch {
          return Boolean(await stopped());
        }
      },
      async resume() {
        await copyMoveSession(source, target!, session, true);
        await resumeInShell(target!, session);
      },
      async transfer() {
        await destination.favourite(target!.address, pinned);
        // Native child stamps may still name the source while its pane is visible.
        await rehome(recovery!.address, target!.address, request.source);
        protectedDetails = false;
        destinationChosen = true;
      },
      async stopDestination() {
        if (target) await destination.close(target.address);
      },
      async rollback() {
        await resumeInShell(recovery!, session);
        await rehome(target!.address, recovery!.address, request.source);
        // Recover even a lost metadata acknowledgement before reporting success.
        protectedDetails = false;
        for (const shell of [recovery, target])
          if (shell)
            await shell.runtime
              .run(`rm -rf -- ${shQuote(shell.directory)}`)
              .catch(() => {});
        return;
      },
      async closeSource() {
        await source.close(request.source);
      },
      async cleanup() {
        if (protectedDetails && recovery)
          await rehome(recovery.address, request.source);
        if (recoveryAddress) await source.close(recoveryAddress);
        // A preflight failure may have opened a shell, but never resumed an agent.
        if (targetAddress && !destinationChosen)
          await destination.close(targetAddress);
        for (const shell of [recovery, target])
          if (shell)
            await shell.runtime
              .run(`rm -rf -- ${shQuote(shell.directory)}`)
              .catch(() => {});
      },
    });
    services.publishWorldInvalidation(
      request.source.connection_id,
      request.source.generation,
    );
    services.publishWorldInvalidation(
      request.destination.connection_id,
      request.destination.generation,
    );
    return {
      ...result,
      ...(result.status === "moved" && target
        ? { target: target.address }
        : result.status === "rolled_back" && recovery
          ? { target: recovery.address }
          : {}),
    };
  } finally {
    locks.delete(key);
    if (identityLocked) locks.delete(identityKey);
  }
}
