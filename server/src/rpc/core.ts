import { isLocalCoreAddress } from "../../../shared/coreAddress";
import { harnessReadiness } from "../agent/harness-readiness";
import { profileLaunch } from "../agent/profile-launch";
import { WORLD_HARNESSES } from "../cli/harness-names";
import { shQuote, runProcessWithCodeTimeout } from "../utils/process-utils";
import type { ConnectionManager } from "../connections/manager";
import type { CoreHost } from "../herdr-core/host";
import { coreHostForProfile, resolveCoreExecutable } from "../herdr-core/host";
import type { CoreConnectionProfile } from "../connections/profiles";
import { createCoreConnections } from "../herdr-core/connections";
import { memoryCoreTopologyPort } from "../storage/core-topology";
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
import { deliverCore } from "../herdr-core/delivery";
import { coreRecipientChange } from "../herdr-core/recipient";
import {
  type CoreConnectionRuntime,
  readCoreScreen,
} from "../herdr-core/runtime";
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

/** What the world.core.* handlers act through. */
export type CoreRpcServices = {
  manager: ConnectionManager<CoreConnectionRuntime>;
  topology: CoreTopologyPort;
  /** Files, Git, hooks and worktrees of a core connection's generation (P4). */
  hostRuntime(lease: ReadyRuntimeLease<CoreConnectionRuntime>): CoreHostRuntime;
  /** Where the core of a connection runs, for finding executables. */
  host(connectionId: string): CoreHost | null;
  /** Test seam: how the readiness probe runs. */
  run?: typeof runProcessWithCodeTimeout;
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
      readSettings: async (id) =>
        core.fixture.settingsFor(
          id,
          await (readSettings ?? (async () => defaultGuiSettings()))(),
        ),
    }),
  };
  return { core, rpc };
}

function address(value: unknown): string {
  if (typeof value !== "string" || !isLocalCoreAddress(value))
    throw new CoreOperationRefused("Name the terminal.");
  return value;
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
        const kinds = [...WORLD_HARNESSES];
        const readiness = await harnessReadiness({
          kinds,
          ...(host?.destination ? { host: host.destination } : {}),
          windows: host?.windows ?? false,
          run: core.run ?? runProcessWithCodeTimeout,
          shQuote,
        });
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
        const launch = shell
          ? null
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
      case "world.core.room.create":
        reply(
          await createCoreRoom(lease, core.topology, String(p.label ?? "")),
        );
        return invalidate();
      case "world.core.room.rename":
        await renameCoreRoom(
          lease,
          core.topology,
          String(p.workspace_id ?? ""),
          String(p.label ?? ""),
        );
        reply({ ok: true });
        return invalidate();
      // Session input (M4/§8): core's own send and keys, only to the
      // program the browser's recipient token names. Never retried.
      case "world.core.send": {
        const text = typeof p.text === "string" ? p.text : "";
        return reply(
          await deliverCore(
            lease,
            address(p.terminal),
            String(p.recipient ?? ""),
            p.answer === true
              ? { kind: "answer", text }
              : { kind: "message", text },
          ),
        );
      }
      case "world.core.keys":
        return reply(
          await deliverCore(
            lease,
            address(p.terminal),
            String(p.recipient ?? ""),
            {
              kind: "keys",
              keys: Array.isArray(p.keys)
                ? p.keys.filter((key): key is string => typeof key === "string")
                : [],
            },
          ),
        );
      case "world.core.screen": {
        const terminal = address(p.terminal);
        const view = lease.runtime.core;
        if (
          !view.epoch ||
          coreRecipientChange(
            String(p.recipient ?? ""),
            view.epoch.coreId,
            view.terminal(terminal),
            view.occupancy(terminal),
          )
        )
          throw new CoreOperationRefused("The agent changed; reopen its Chat.");
        const screen = await readCoreScreen(lease, address(p.terminal)).catch(
          () => {
            throw new CoreOperationRefused("World could not read its screen.");
          },
        );
        return reply({
          text: typeof screen.text === "string" ? screen.text : "",
        });
      }
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
