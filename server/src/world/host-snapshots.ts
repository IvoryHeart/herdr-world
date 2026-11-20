import type { WorldHost } from "../../../shared/hosts";
import type {
  WorldConnectionSnapshot,
  WorldHostSnapshot,
} from "./snapshot-types";

export function groupHostSnapshots(
  hosts: WorldHost[],
  connections: WorldConnectionSnapshot[],
): WorldHostSnapshot[] {
  const observations = new Map(
    connections.map((connection) => [connection.connection_id, connection]),
  );
  return hosts.map((host) => ({
    ...host,
    runtimes: host.runtimes.map((runtime) => {
      const connection = observations.get(runtime.connection_id);
      return {
        ...runtime,
        snapshot_generation: connection?.snapshot_generation ?? null,
        stale: connection?.stale ?? true,
        actionable: runtime.installed && (connection?.actionable ?? false),
      };
    }),
  }));
}
