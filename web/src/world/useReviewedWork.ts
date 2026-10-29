import { useCallback, useMemo } from "react";
import { deskIdentity, deskMetadata } from "./useDeskState";
import {
  sharedDeskStore,
  useSharedDeskStore,
  useWorldDeskState,
} from "./deskStateStore";
import { handoffId, receiptIdentity } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

/**
 * Whether each finished agent's latest stop is reviewed, and a way to mark
 * it, keyed as Desk keys its handoffs: the agent and its current stop.
 */
export function useReviewedWork(
  agents: readonly WorldLeafObject[],
  store = sharedDeskStore(),
) {
  useSharedDeskStore(store);
  const state = useWorldDeskState(store);
  const metadata = useMemo(
    () => deskMetadata([...agents], state),
    [agents, state],
  );
  const stopOf = useCallback(
    (leaf: WorldLeafObject) => {
      const key = receiptIdentity(leaf);
      return handoffId(
        leaf,
        metadata.stops.get(key),
        metadata.stopIds.get(key),
      );
    },
    [metadata],
  );
  const reviewed = useCallback(
    (leaf: WorldLeafObject) => metadata.handled.has(stopOf(leaf)),
    [metadata, stopOf],
  );
  const mark = useCallback(
    (leaf: WorldLeafObject, done = true) => {
      const [, stop] = JSON.parse(stopOf(leaf)) as [string, string];
      return store.mutate("world.desk.review", deskIdentity(leaf), {
        stop_id: stop,
        reviewed: done,
      });
    },
    [store, stopOf],
  );
  return { reviewed, mark, verified: state.verified };
}
