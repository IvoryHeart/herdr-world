import type { FeatureKernel } from "../contract";
import { MemoryService } from "../../memory/service";

export function createRuntimeMemoryService(
  args: Pick<
    FeatureKernel,
    "connections" | "core" | "coreHostRuntime" | "clock"
  >,
) {
  return new MemoryService({
    now: () => args.clock.now(),
    lease(id) {
      if (args.connections().has(id))
        return args.connections().readyRuntimeLease(id);
      if (!args.core().has(id)) return null;
      const lease = args.core().readyRuntimeLease(id);
      if (!lease?.isCurrent()) return null;
      return {
        generation: lease.generation,
        isCurrent: () => lease.isCurrent(),
        runtime: args.coreHostRuntime(lease),
      };
    },
  });
}
