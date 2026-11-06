import {
  createSshForwards,
  forwardToWire,
  worldOwnPorts,
} from "../bridge/ssh-forward";
import type { ServerConfig } from "../config/server-config";
import type { Logger } from "../utils/logger";

/** All runtimes in one World service share local port reservations. */
export function createServiceForwards(
  config: ServerConfig,
  logger: Logger,
  broadcast: (payload: string, context?: string) => void,
  stopping: () => boolean,
) {
  let port = config.port;
  const registry = createSshForwards({
    logger: logger.child("forward"),
    reservedPorts: () =>
      worldOwnPorts(port, process.env.NODE_ENV === "development"),
  });
  registry.onChange((forwards) => {
    if (!stopping())
      broadcast(
        JSON.stringify({ forwards: forwards.map(forwardToWire) }),
        "forwards",
      );
  });
  return {
    registry,
    listeningOn(value: number) {
      port = value;
    },
    async stop() {
      registry.closeAll();
      await registry.drainConnection();
    },
  };
}
