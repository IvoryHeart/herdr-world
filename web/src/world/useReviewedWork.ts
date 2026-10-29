import { useCallback, useMemo } from "react";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import { deskIdentity } from "./useDeskState";
import {
  sharedDeskStore,
  useSharedDeskStore,
  useWorldDeskState,
} from "./deskStateStore";
import { handoffId } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

/** The stop part of Desk's handoff ID: what a review mark names. */
function currentStop(leaf: WorldLeafObject, record: DeskRecord | undefined) {
  const [, stop] = JSON.parse(
    handoffId(
      leaf,
      record?.stopped_at ?? undefined,
      record?.observed_stop_id ?? undefined,
    ),
  ) as [string, string];
  return stop;
}

/**
 * Whether a finished agent's latest stop is reviewed, and a way to mark it,
 * keyed as Desk keys its handoffs: the agent and its current stop. Lookups
 * go through the service's few records and run only for the agents asked
 * about, so a dense World pays nothing per update.
 */
export function useReviewedWork(store = sharedDeskStore()) {
  useSharedDeskStore(store);
  const state = useWorldDeskState(store);
  const records = useMemo(
    () =>
      new Map(
        (state.verified ? state.records : []).map((record) => [
          deskKey(record),
          record,
        ]),
      ),
    [state],
  );
  const recordOf = useCallback(
    (leaf: WorldLeafObject) => records.get(deskKey(deskIdentity(leaf))),
    [records],
  );
  const reviewed = useCallback(
    (leaf: WorldLeafObject) => {
      const record = recordOf(leaf);
      return (
        record?.reviewed_stop != null &&
        record.reviewed_stop === currentStop(leaf, record)
      );
    },
    [recordOf],
  );
  const mark = useCallback(
    (leaf: WorldLeafObject, done = true) =>
      store.mutate("world.desk.review", deskIdentity(leaf), {
        stop_id: currentStop(leaf, recordOf(leaf)),
        reviewed: done,
      }),
    [store, recordOf],
  );
  return { reviewed, mark, verified: state.verified };
}
