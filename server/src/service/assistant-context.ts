import { createAssistantContext } from "../assistant/context";
import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import {
  connectionRecoveryFingerprint,
  type ConnectionProfile,
} from "../connections/profiles";
import type { CoreRpcServices } from "../rpc/core";
import { createCoreWorktree } from "../herdr-core/worktrees";
import { createWorkspaceWorktree } from "../worktree/create";

/** Ranger captures the runtime it reads; the two providers never substitute. */
export function createRuntimeAssistantContext(args: {
  profiles(): ConnectionProfile[];
  tui: ConnectionManager<LegacyConnectionRuntime>;
  core: CoreRpcServices;
}) {
  return createAssistantContext({
    catalog: args.profiles,
    lease: (id) => {
      if (args.tui.has(id)) return args.tui.readyRuntimeLease(id);
      const lease = args.core.manager.has(id)
        ? args.core.manager.readyRuntimeLease(id)
        : null;
      if (!lease?.isCurrent()) return null;
      return {
        runtime: args.core.hostRuntime(lease),
        generation: lease.generation,
        isCurrent: () => lease.isCurrent(),
      };
    },
    recoveryFingerprint: (id) => {
      const profile = args.profiles().find((profile) => profile.id === id);
      if (!profile)
        throw new Error("Ranger connection is no longer configured");
      return connectionRecoveryFingerprint(profile);
    },
    createCoreWorktree: (host, request) =>
      createCoreWorktree(
        host.lease,
        { topology: args.core.topology, host },
        request,
      ),
    createWorktree: (runtime, params, isCurrent, beforeDispatch) =>
      createWorkspaceWorktree(
        runtime,
        params,
        isCurrent,
        undefined,
        undefined,
        beforeDispatch,
      ),
  });
}
