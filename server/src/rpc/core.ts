import { moveCore } from "../herdr-core/town-move";
import { apartmentResumeLaunch } from "../world/apartment-resume";
import { isLocalCoreAddress } from "../../../shared/coreAddress";
import { profileLaunch } from "../agent/profile-launch";
import { coreHarnessNames } from "../herdr-core/harness";
import type { ConnectionManager } from "../connections/manager";
import type { CoreHost } from "../herdr-core/host";
import {
  coreHarnessReadiness,
  coreHostForProfile,
  resolveCoreExecutable,
} from "../herdr-core/host";
import type { CoreConnectionProfile } from "../connections/profiles";
import { createCoreConnections } from "../herdr-core/connections";
import { memoryCoreTopologyPort } from "../storage/core-topology";
import { inspectWorkspacePath } from "../workspace/path";
import {
  closeCoreRoom,
  CoreOperationRefused,
  coreRoomTerminals,
  createCoreRoom,
  killCore,
  launchCore,
  parseCoreKillConfirmation,
  planCoreKill,
  renameCoreRoom,
} from "../herdr-core/operations";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import {
  createCoreWorktree,
  listCoreWorktrees,
  openCoreWorktree,
  removeCoreWorktree,
} from "../herdr-core/worktrees";
import {
  type CoreHostRuntime,
  coreHostRuntimes,
} from "../herdr-core/host-runtime";
import type { ReadyRuntimeLease } from "../connections/manager";
import { defaultGuiSettings, type GuiSettings } from "../config/gui-settings";
import type { CoreTopologyPort } from "../storage/core-topology";
import type { BridgeRpcContext } from "./context";
import { followCoreDeskMove } from "../world/agent-move-sides";
import { settlingMessage } from "../world/move-settle";

/** A core connection's rooms and terminals, as a desk move reads them. */
async function coreDeskRows(lease: ReadyRuntimeLease<CoreConnectionRuntime>) {
  const operations = lease.runtime.operations;
  const [{ workspaces = [] }, { panes = [] }] = await Promise.all([
    operations.listWorkspaces(),
    operations.listTerminals(),
  ]);
  return {
    workspaces: workspaces.map((row) => String(row.workspace_id ?? "")),
    panes,
  };
}

/** What the world.core.* handlers act through. */
export type CoreRpcServices = {
  manager: ConnectionManager<CoreConnectionRuntime>;
  topology: CoreTopologyPort;
  /** Files, Git, hooks and worktrees of a core connection's generation (P4). */
  hostRuntime(lease: ReadyRuntimeLease<CoreConnectionRuntime>): CoreHostRuntime;
  /** Where the core of a connection runs, for finding executables. */
  host(connectionId: string): CoreHost | null;
};

/**
 * herdr-core for the composed service: connections World never starts (it
 * observes, starts and ends terminals there), World's layout of each core
 * (M1: SQLite, or memory for test doubles) and the world.core.* services.
 */
type CoreConnectionsArgs = Parameters<typeof createCoreConnections>[0];
export function composeCore(
  args: Omit<CoreConnectionsArgs, "topology" | "profiles"> & {
    /** The profile service: core profiles in full, for where each runs. */
    profiles(): Omit<
      ReturnType<CoreConnectionsArgs["profiles"]>,
      "coreList"
    > & {
      coreList(): Array<CoreConnectionProfile & { state: string }>;
    };
    topology?: CoreTopologyPort;
    /** The service's settings (repository hooks, worktree commands). */
    readSettings?(): Promise<GuiSettings>;
  },
) {
  const topology = args.topology ?? memoryCoreTopologyPort();
  const { readSettings, ...connections } = args;
  const core = createCoreConnections({
    ...connections,
    topology: () => topology,
  });
  const host = (connectionId: string) => {
    const profile = args
      .profiles()
      .coreList()
      .find((item) => item.id === connectionId);
    return profile ? coreHostForProfile(profile) : null;
  };
  const rpc: CoreRpcServices = {
    manager: core.manager,
    topology,
    host,
    hostRuntime: coreHostRuntimes({
      host,
      onUploadCleanupError: (error) =>
        args.logger.warn("core upload cleanup failed", {
          error: (error as Error)?.message ?? String(error),
        }),
      readSettings: async (id) =>
        core.fixture.settingsFor(
          id,
          await (readSettings ?? (async () => defaultGuiSettings()))(),
        ),
    }),
  };
  return { core, rpc };
}

function addresses(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64)
    throw new CoreOperationRefused("Name the terminals to end.");
  return value.map((item) => {
    if (typeof item !== "string" || !isLocalCoreAddress(item))
      throw new CoreOperationRefused("Name the terminals to end.");
    return item;
  });
}

/**
 * Control of herdr-core connections (world.core.*). Each request names its
 * connection and the runtime generation it saw; the lease is taken only
 * from the core manager, so a TUI connection can never answer it.
 */
export async function handleCoreRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const p = (params ?? {}) as Record<string, unknown>;
  const reply = (result: unknown): void => {
    sendReply({ id, result }, "world-core");
  };
  const core = rpc.services.coreControl;
  try {
    if (!core) throw new CoreOperationRefused("herdr-core is not available.");
    const connectionId = String(p.connection_id ?? "");
    if (!core.manager.has(connectionId))
      throw new CoreOperationRefused("That host is not a herdr-core host.");
    const lease = core.manager.readyRuntimeLease(connectionId);
    if (
      !lease ||
      lease.generation !== p.connection_generation ||
      !lease.isCurrent()
    )
      throw new CoreOperationRefused(
        "The host's herdr-core reconnected; look again and retry.",
      );
    const worktreeDeps = () => ({
      topology: core.topology,
      host: core.hostRuntime(lease),
    });
    const invalidate = () => {
      if (lease.isCurrent())
        rpc.services.publishWorldInvalidation(connectionId, lease.generation);
    };
    switch (method) {
      case "world.core.catalog": {
        // Every harness Herdr integrates, and whether this host has it: the
        // launcher offers the installed ones (core runs any program).
        const host = core.host(connectionId);
        if (!host)
          throw new CoreOperationRefused("World cannot reach that host");
        const kinds = coreHarnessNames();
        const readiness = await coreHarnessReadiness(host, kinds);
        return reply({ kinds, readiness, skills: [] });
      }
      case "world.core.launch": {
        const profileId = typeof p.profile_id === "string" ? p.profile_id : "";
        const profile = profileId
          ? rpc.services.profiles().profile(profileId)
          : null;
        if (profileId && !profile)
          throw new CoreOperationRefused("That profile no longer exists.");
        const shell = p.shell === true;
        const resume =
          typeof p.resume_resident === "string" ? p.resume_resident : null;
        const launch = shell
          ? null
          : resume
            ? apartmentResumeLaunch(
                rpc.services.apartments?.apartments.get(resume),
                connectionId,
              )
            : profileLaunch(profile ?? null, {
                kind: String(p.kind ?? ""),
                label: String(p.label ?? "")
                  .trim()
                  .slice(0, 64),
                text: String(p.text ?? "").slice(0, 16_000),
              });
        const host = core.host(connectionId);
        const result = await launchCore(
          lease,
          {
            workspaceId: String(p.workspace_id ?? ""),
            kind: launch ? launch.kind : null,
            label: launch
              ? launch.label
              : String(p.label ?? "Shell")
                  .trim()
                  .slice(0, 64),
            ...(launch?.args ? { args: launch.args } : {}),
            text: launch ? launch.text : "",
            ...(typeof p.parent_pane_id === "string"
              ? { spawnedBy: p.parent_pane_id }
              : {}),
          },
          {
            topology: core.topology,
            resolveExecutable: (kind) => {
              if (!host) throw new Error("World cannot reach that host");
              return resolveCoreExecutable(host, kind);
            },
          },
        );
        invalidate();
        return reply(result);
      }
      case "world.core.move": {
        const request = {
          kind: p.kind === "desk" ? ("desk" as const) : ("pane" as const),
          tab_id: String(p.tab_id ?? ""),
          pane_id: String(p.pane_id ?? ""),
          workspace_id: String(p.workspace_id ?? ""),
        };
        const log = rpc.services.logger?.child("agent-move");
        const fields = {
          from: `${connectionId}#${lease.generation}`,
          kind: request.kind,
          tab: request.tab_id,
          ...(request.kind === "pane"
            ? { pane: request.pane_id }
            : { room: request.workspace_id }),
        };
        // One move per agent until it settles (world/move-settle.ts).
        const moving = {
          connection_id: connectionId,
          ...(request.kind === "desk"
            ? { tab_id: request.tab_id }
            : { terminal_id: request.pane_id }),
        };
        const settling = rpc.services.moveSettle?.wait(moving) ?? 0;
        if (settling) {
          log?.warn("move outcome", {
            ...fields,
            outcome: "refused",
            reason: "settling",
          });
          return reply({
            status: "refused",
            reason: "stale",
            message: settlingMessage("This desk", settling),
          });
        }
        const before =
          request.kind === "desk" ? await coreDeskRows(lease) : null;
        const result = await moveCore(lease, core.topology, request);
        if (result.status === "moved") {
          rpc.services.moveSettle?.mark({
            connection_id: connectionId,
            tab_id: result.tab_id,
          });
          for (const pane of result.panes)
            rpc.services.moveSettle?.mark({
              connection_id: connectionId,
              terminal_id: pane.current,
            });
        }
        // Core gives a moved desk a new tab ID: its Board facts follow.
        const revision =
          before && result.status === "moved"
            ? await followCoreDeskMove(
                {
                  board: rpc.services.board,
                  publishBoardChanged: rpc.services.publishBoardChanged,
                },
                {
                  connection_id: connectionId,
                  generation: lease.generation,
                  tab_id: request.tab_id,
                },
                before,
                result,
                (await coreDeskRows(lease).catch(() => before)).workspaces,
              ).catch((error: unknown) => {
                log?.warn("move rehome", {
                  ...fields,
                  outcome: "failed",
                  message: String(error),
                });
                return null;
              })
            : null;
        (result.status === "moved" ? log?.info : log?.warn)?.call(
          log,
          "move outcome",
          {
            ...fields,
            outcome: result.status,
            ...(result.status === "moved"
              ? {
                  at_tab: result.tab_id,
                  room_at: result.workspace_id,
                  revision,
                }
              : { message: result.message }),
            ...(result.status === "refused" ? { reason: result.reason } : {}),
          },
        );
        invalidate();
        return reply(result);
      }
      case "world.core.kill_plan": {
        const targets =
          typeof p.workspace_id === "string"
            ? await coreRoomTerminals(lease, p.workspace_id)
            : addresses(p.terminals);
        return reply(await planCoreKill(lease, targets));
      }
      case "world.core.kill": {
        const outcome = await killCore(
          lease,
          addresses(p.terminals),
          parseCoreKillConfirmation(p.confirmation),
        );
        invalidate();
        return reply(outcome);
      }
      case "world.core.room.create": {
        // A folder is checked on the core's host, as a Herdr workspace's.
        let folder: string | undefined;
        if (typeof p.folder === "string" && p.folder.trim()) {
          const host = core.hostRuntime(lease);
          const info = await inspectWorkspacePath(
            p.folder,
            {
              host: host.sshHost(),
              remotePlatform: host.remotePlatform,
              runProcessWithCodeTimeout: host.runProcessWithCodeTimeout,
            },
            false,
          );
          if (info.error)
            throw new CoreOperationRefused(`${info.error} ${info.path}`);
          if (!lease.isCurrent())
            throw new CoreOperationRefused(
              "The host's herdr-core reconnected; look again and retry.",
            );
          folder = info.path;
        }
        reply(
          await createCoreRoom(
            lease,
            core.topology,
            String(p.label ?? ""),
            folder,
          ),
        );
        return invalidate();
      }
      case "world.core.room.rename":
        await renameCoreRoom(
          lease,
          core.topology,
          String(p.workspace_id ?? ""),
          String(p.label ?? ""),
        );
        reply({ ok: true });
        return invalidate();
      case "world.core.room.close": {
        const outcome = await closeCoreRoom(
          lease,
          core.topology,
          String(p.workspace_id ?? ""),
          parseCoreKillConfirmation(p.confirmation),
        );
        invalidate();
        return reply(outcome);
      }
      case "world.core.worktree.list":
        return reply(
          await listCoreWorktrees(
            lease,
            worktreeDeps(),
            String(p.workspace_id ?? ""),
          ),
        );
      case "world.core.worktree.create": {
        const result = await createCoreWorktree(lease, worktreeDeps(), {
          workspaceId: String(p.workspace_id ?? ""),
          branch: String(p.branch ?? ""),
        });
        invalidate();
        return reply(result);
      }
      case "world.core.worktree.open": {
        const result = await openCoreWorktree(lease, worktreeDeps(), {
          workspaceId: String(p.workspace_id ?? ""),
          path: String(p.path ?? ""),
        });
        invalidate();
        return reply(result);
      }
      case "world.core.worktree.remove": {
        const result = await removeCoreWorktree(lease, worktreeDeps(), {
          workspaceId: String(p.workspace_id ?? ""),
          force: p.force === true,
          confirmation:
            p.confirmation === undefined
              ? null
              : parseCoreKillConfirmation(p.confirmation),
        });
        invalidate();
        return reply(result);
      }
      default:
        throw new CoreOperationRefused("Unknown herdr-core operation.");
    }
  } catch (error) {
    if (error instanceof CoreOperationRefused && error.plan) {
      // The confirmation fell out of date: send the plan as it is now.
      sendReply(
        { id, error: { message: error.message, plan: error.plan } },
        "world-core-error",
      );
      return;
    }
    sendError("world-core-error", error);
  }
}
