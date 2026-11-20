import type { ConnectionManager } from "../connections/manager";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { CoreRpcServices } from "../rpc/core";
import { MemoryService } from "./service";

export function createRuntimeMemoryService(args: {
  tui(): ConnectionManager<LegacyConnectionRuntime>;
  core: CoreRpcServices;
  now(): number;
}) {
  return new MemoryService({
    now: args.now,
    lease(id) {
      if (args.tui().has(id)) return args.tui().readyRuntimeLease(id);
      if (!args.core.manager.has(id)) return null;
      const lease = args.core.manager.readyRuntimeLease(id);
      if (!lease?.isCurrent()) return null;
      return {
        generation: lease.generation,
        isCurrent: () => lease.isCurrent(),
        runtime: args.core.hostRuntime(lease),
      };
    },
  });
}
