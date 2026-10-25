import type { WorldObject } from "../worldObject";

/** Rendering may defer topology, but never retain a retired live action target. */
export function boardObservation(current: WorldObject, deferred: WorldObject) {
  const owners = new Map(
    current.hosts.map((host) => [host.connectionId, host]),
  );
  return deferred.hosts.some(
    (host) =>
      host.actionable &&
      (!owners.get(host.connectionId)?.actionable ||
        owners.get(host.connectionId)?.generation !== host.generation),
  )
    ? current
    : deferred;
}
