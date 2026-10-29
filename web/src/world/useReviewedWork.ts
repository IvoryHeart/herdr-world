import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import { deskIdentity } from "./useDeskState";
import {
  sharedDeskStore,
  useSharedDeskStore,
  type DeskStoreState,
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

type ReviewView = { records: readonly DeskRecord[]; verified: boolean };
const NO_RECORDS: ReviewView = { records: [], verified: false };

/**
 * Whether a finished agent's latest stop is reviewed, and a way to mark it,
 * keyed as Desk keys its handoffs: the agent and its current stop. Lookups
 * go through the service's few records and run only for the agents asked
 * about, so a dense World pays nothing per update. With `stops` false (Town)
 * the caller sees only reviewed records, so the service's frequent stop
 * observations do not re-render it; `toReview` then knows done agents only.
 */
export function useReviewedWork(store = sharedDeskStore(), stops = true) {
  useSharedDeskStore(store);
  const cache = useRef<{ state: DeskStoreState | null; key: string }>({
    state: null,
    key: "",
  });
  const view = useRef<ReviewView>(NO_RECORDS);
  const snapshot = useCallback(() => {
    const state = store.get();
    if (cache.current.state === state) return view.current;
    const records = state.verified
      ? stops
        ? state.records
        : state.records.filter((record) => record.reviewed_stop != null)
      : [];
    // A reviewed-only view changes only when a reviewed record does.
    const key = stops ? "" : JSON.stringify([state.verified, records]);
    if (stops || key !== cache.current.key)
      view.current = { records, verified: state.verified };
    cache.current = { state, key };
    return view.current;
  }, [store, stops]);
  const shown = useSyncExternalStore(store.subscribe, snapshot, snapshot);
  const records = useMemo(
    () => new Map(shown.records.map((record) => [deskKey(record), record])),
    [shown],
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
  // A caller that showed one stop's report marks that stop, not a newer one;
  // otherwise the current stop, read from the store at the moment of marking.
  const mark = useCallback(
    (leaf: WorldLeafObject, stop?: string) => {
      const key = deskKey(deskIdentity(leaf));
      const current = store
        .get()
        .records.find((record) => deskKey(record) === key);
      return markReviewed(store, leaf, stop ?? reviewStop(leaf, current));
    },
    [store],
  );
  return { reviewed, stopOf, toReview, mark, verified: shown.verified };
}
