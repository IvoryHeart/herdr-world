import type { acquireInstanceLock } from "../config/instance-lock";
import type { ServerConfig } from "../config/server-config";

/** A bound listener must not serve without publishing its owning address. */
export function publishInstanceAddress(
  lock: ReturnType<typeof acquireInstanceLock>,
  config: Pick<ServerConfig, "host" | "port" | "tls">,
  listener: { port?: number; stop(closeActiveConnections: boolean): unknown },
): void {
  try {
    lock.listening({
      host: config.host,
      port: listener.port ?? config.port,
      tls: Boolean(config.tls),
    });
  } catch (error) {
    listener.stop(true);
    throw error;
  }
}
