import type { ServerWebSocket } from "bun";
import type { FeatureKernel } from "../contract";
import { createWorldDeskService } from "../../world/desk-service";
import { DeskWatches } from "../../world/desk-watches";
import { readDeskWatch } from "../../world/desk-watch-read";

export function createDesk(
  kernel: Pick<FeatureKernel, "clients" | "scheduler" | "send" | "connections">,
) {
  const service = createWorldDeskService((line) => {
    for (const socket of kernel.clients)
      kernel.send(socket, line, "world-desk");
  });
  const watches = new DeskWatches<ServerWebSocket<unknown>>({
    scheduler: kernel.scheduler,
    lease(target) {
      const lease = kernel
        .connections()
        .readyRuntimeLease(target.connection_id);
      if (
        !lease ||
        lease.generation !== target.connection_generation ||
        !lease.isCurrent()
      )
        return null;
      return {
        isCurrent: lease.isCurrent,
        read: (kind, target) =>
          readDeskWatch(lease.runtime, kind, target, lease.isCurrent),
      };
    },
    send: (socket, control) =>
      kernel.send(socket, JSON.stringify({ control }), "world-desk-reads"),
  });
  return { service, watches };
}
