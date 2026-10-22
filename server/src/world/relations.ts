import {
  observedSpawnClaims,
  spawnClaimsToRecord,
  type RelationObservation,
} from "../../../shared/relations";
import type { BoardDocument, BoardOp } from "./board-store";
import type { WorldSnapshotResult } from "./snapshot";

/**
 * The service's side of relations (shared/relations.ts): it reads spawn
 * tokens from World snapshots and keeps the last claim it saw, so a claim
 * outlives the token when Herdr restarts. Only a live snapshot of a
 * connection's current runtime is read; cached topology is never recorded.
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

/** The claims a snapshot adds or changes, as one Board operation. */
export function spawnRecordOps(
  document: BoardDocument,
  result: WorldSnapshotResult,
  now: number,
): BoardOp[] {
  const claims = spawnClaimsToRecord(
    document.relations.spawns,
    observedSpawnClaims(relationObservations(result), now),
  );
  return claims.length ? [{ op: "spawn.record", claims }] : [];
}
