import { planBoardPatch } from "./board-plan";
import {
  closedRelations,
  observedSpawnClaims,
  spawnClaimsToRecord,
  type RelationObservation,
} from "../../../shared/relations";
import type { BoardDocument, BoardOp, BoardStorePort } from "./board-store";
import type { WorldSnapshotResult } from "./snapshot";

/**
 * The service's side of relations (shared/relations.ts): it reads spawn
 * tokens from World snapshots and keeps the last claim it saw, so a claim
 * outlives a token cleared while both terminals run. Claims and group
 * members whose terminals have closed are dropped, so they neither ride
 * along in every Board document nor keep the browser deriving colours. Only
 * a live snapshot of a connection's current runtime is read; cached topology
 * is never recorded or pruned.
 */

export function relationObservations(
  result: WorldSnapshotResult,
): RelationObservation[] {
  return result.connections.map((connection) => ({
    connection_id: connection.connection_id,
    generation: connection.generation,
    current:
      connection.state === "ready" &&
      !connection.stale &&
      connection.actionable &&
      connection.snapshot !== null &&
      connection.snapshot_generation === connection.generation,
    complete:
      connection.snapshot?.coverage?.panes ===
      connection.snapshot?.panes.length,
    panes: (connection.snapshot?.panes ?? []).flatMap((pane) =>
      typeof pane.pane_id === "string" && typeof pane.terminal_id === "string"
        ? [
            {
              pane_id: pane.pane_id,
              terminal_id: pane.terminal_id,
              tokens: pane.tokens,
            },
          ]
        : [],
    ),
  }));
}

/** The claims a snapshot adds or changes, and what it shows closed, as Board operations. */
export function spawnRecordOps(
  document: BoardDocument,
  result: WorldSnapshotResult,
  now: number,
): BoardOp[] {
  const observations = relationObservations(result);
  const closed = closedRelations(document.relations, observations);
  const claims = spawnClaimsToRecord(
    document.relations.spawns,
    observedSpawnClaims(observations, now),
  );
  return [
    ...(closed.children.length || closed.members.length
      ? [{ op: "relations.prune" as const, ...closed }]
      : []),
    ...(claims.length ? [{ op: "spawn.record" as const, claims }] : []),
  ];
}

/**
 * Keep the spawn claims a snapshot shows, and drop the closed ones, in
 * Board's store; written and published only when something changed. A
 * failure is logged: the snapshot reply goes out either way.
 */
export async function recordSpawnClaims(
  store: Pick<BoardStorePort, "get" | "patch">,
  snapshot: WorldSnapshotResult,
  publish: (revision: number) => void,
  logger: { warn(message: string, fields: { detail: string }): void },
  now: number = Date.now(),
  isCurrent: (connectionId: string, generation: number) => boolean = () => true,
): Promise<void> {
  try {
    let changed = false;
    const document = await store.patch(
      planBoardPatch([snapshot], (current) => {
        const active = {
          ...snapshot,
          connections: snapshot.connections.map((host) =>
            isCurrent(host.connection_id, host.generation)
              ? host
              : { ...host, stale: true, actionable: false },
          ),
        };
        const ops = spawnRecordOps(current, active, now);
        changed = ops.length > 0;
        return changed ? ops : null;
      }),
    );
    if (changed) publish(document.revision);
  } catch (error) {
    logger.warn("World could not record spawn claims", {
      detail: String(error),
    });
  }
}
