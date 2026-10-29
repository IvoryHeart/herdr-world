import { useCallback, useMemo } from "react";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import { deskIdentity } from "./useDeskState";
import {
  sharedDeskStore,
  useSharedDeskStore,
  useWorldDeskState,
  type WorldDeskStore,
} from "./deskStateStore";
import { handoffId, IDLE_WINDOW_MS } from "./handoffs";
import type { WorldLeafObject } from "./worldObject";

/** The stop part of Desk's handoff ID: what a review mark names. */
export function reviewStop(
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
) {
  const [, stop] = JSON.parse(
    handoffId(
      leaf,
      record?.stopped_at ?? undefined,
      record?.observed_stop_id ?? undefined,
    ),
  ) as [string, string];
  return stop;
}

/** Whether the agent's current stop is the one marked reviewed. */
export const isReviewedStop = (
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
) =>
  record?.reviewed_stop != null &&
  record.reviewed_stop === reviewStop(leaf, record);

/**
 * Finished work waiting for review, as Desk's review lane counts it: an agent
 * Herdr reports done, or an idle one whose turn the service saw end recently
 * (Herdr reports a finished turn as idle once it is seen).
 */
export const awaitsReview = (
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
  now: number,
) =>
  (leaf.status === "done" ||
    (leaf.status === "idle" &&
      record?.stopped_at != null &&
      now - record.stopped_at <= IDLE_WINDOW_MS)) &&
  !isReviewedStop(leaf, record);

/** Marks one stop reviewed (or not) in the service's record. */
export const markReviewed = (
  store: WorldDeskStore,
  leaf: WorldLeafObject,
  stop: string,
  reviewed = true,
) =>
  store.mutate("world.desk.review", deskIdentity(leaf), {
    stop_id: stop,
    reviewed,
  });

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
    (leaf: WorldLeafObject) => isReviewedStop(leaf, recordOf(leaf)),
    [recordOf],
  );
  const stopOf = useCallback(
    (leaf: WorldLeafObject) => reviewStop(leaf, recordOf(leaf)),
    [recordOf],
  );
  const toReview = useCallback(
    (leaf: WorldLeafObject, now: number) =>
      awaitsReview(leaf, recordOf(leaf), now),
    [recordOf],
  );
  // A caller that showed one stop's report marks that stop, not a newer one.
  const mark = useCallback(
    (leaf: WorldLeafObject, stop = reviewStop(leaf, recordOf(leaf))) =>
      markReviewed(store, leaf, stop),
    [store, recordOf],
  );
  return { reviewed, stopOf, toReview, mark, verified: state.verified };
}
