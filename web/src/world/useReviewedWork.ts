import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import { deskIdentity, qualifiedReviewRecord } from "./useDeskState";
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

/** The service has a qualified record naming the stop. */
export const reviewStopKnown = (
  _leaf: WorldLeafObject,
  record: DeskRecord | undefined,
) => record?.observed_stop_id != null || record?.stopped_at != null;

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

/**
 * Marks an agent's finished work reviewed; true once the service saved it.
 * A caller that showed one stop's report marks that stop, not a newer one;
 * otherwise the current stop, read from the store at the moment of marking.
 */
export async function markReviewed(
  store: Pick<WorldDeskStore, "get" | "mutate" | "refresh">,
  leaf: WorldLeafObject,
  stop?: string,
): Promise<boolean> {
  const current = await qualifiedReviewRecord(store, deskIdentity(leaf), stop);
  if (!current) return false;
  return store.mutate("world.desk.review", deskIdentity(leaf), {
    stop_id: stop ?? reviewStop(leaf, current),
    reviewed: true,
  });
}

/**
 * Keys of the finished agents (done, or idle ones Town saw finish) whose
 * work is reviewed. Only finished agents are looked up, so a dense roster
 * pays one cheap pass; the previous set is returned while its keys are
 * unchanged, so Town's presented office stays the same object.
 */
export function reviewedAgentKeys(
  roster: readonly {
    agent: { key: string; nodeId: string; semanticStatus: string };
  }[],
  finished: ReadonlySet<string>,
  leafOf: (nodeId: string) => WorldLeafObject | null,
  reviewed: (leaf: WorldLeafObject) => boolean,
  previous: ReadonlySet<string>,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const { agent } of roster) {
    if (
      agent.semanticStatus !== "done" &&
      !(agent.semanticStatus === "idle" && finished.has(agent.key))
    )
      continue;
    const leaf = leafOf(agent.nodeId);
    if (leaf && reviewed(leaf)) keys.add(agent.key);
  }
  return keys.size === previous.size &&
    [...keys].every((key) => previous.has(key))
    ? previous
    : keys;
}

type ReviewView = { records: readonly DeskRecord[]; verified: boolean };
const NO_RECORDS: ReviewView = { records: [], verified: false };

/**
 * One reviewed record for Town, Desk and Needs you. Desk's service record,
 * keyed by the agent and its current stop. Lookups run only for the agents
 * asked about, so a
 * dense World pays nothing per update. With `stops` false (Town) the caller
 * sees only reviewed records, so the service's frequent stop observations do
 * not re-render it; `toReview` then knows done agents only.
 */
export function useReviewedWork(
  store: WorldDeskStore = sharedDeskStore(),
  stops = true,
) {
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
  const mark = useCallback(
    (leaf: WorldLeafObject, stop?: string) => markReviewed(store, leaf, stop),
    [store],
  );
  // When the agent stopped (blocked or finished): the service's stop, else
  // Herdr's last activity.
  const stoppedAt = useCallback(
    (leaf: WorldLeafObject) =>
      recordOf(leaf)?.stopped_at ?? leaf.lastActivityAt ?? null,
    [recordOf],
  );
  return {
    reviewed,
    stopOf,
    toReview,
    stoppedAt,
    mark,
    verified: shown.verified,
  };
}
