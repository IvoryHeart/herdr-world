import { observeGroupTopology } from "../../../shared/groupObservations";
import { agentCheckoutSessionFingerprint } from "../herdr/agent-checkout";
import type { WorldConnectionSnapshot } from "./snapshot";

type GroupSnapshotConnection = Pick<
  WorldConnectionSnapshot,
  | "connection_id"
  | "generation"
  | "snapshot_generation"
  | "state"
  | "stale"
  | "actionable"
> & {
  snapshot: {
    workspaces: readonly unknown[];
    tabs: readonly unknown[];
    panes: readonly unknown[];
    agents: readonly unknown[];
  } | null;
};

export function groupSnapshotObservations(
  connections: readonly GroupSnapshotConnection[],
) {
  return observeGroupTopology(
    connections.map((connection) => ({
      connectionId: connection.connection_id,
      snapshotGeneration: connection.snapshot_generation,
      generation: connection.generation,
      state: connection.state,
      stale: connection.stale,
      actionable: connection.actionable,
      snapshot: connection.snapshot,
    })),
    agentCheckoutSessionFingerprint,
  );
}
