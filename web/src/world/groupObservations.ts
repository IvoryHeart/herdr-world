import { observeGroupTopology } from "../../../shared/groupObservations";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { taskSummarySessionFingerprint } from "./worldObject";

export function groupRuntimeObservations(
  connections: readonly WorldRuntimeConnection[],
) {
  return observeGroupTopology(connections, taskSummarySessionFingerprint);
}
