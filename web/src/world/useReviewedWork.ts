import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { deskKey, type DeskRecord } from "../../../shared/deskState";
import { deskIdentity } from "./useDeskState";
import {
  sharedDeskStore,
  useSharedDeskStore,
  type DeskStoreState,
  type WorldDeskStore,
} from "./deskStateStore";
import {
  completionSeenKey,
  completionSeenStore,
  useCompletionSeen,
  type CompletionSeenStore,
} from "./completionSeenState";
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

/**
 * Whether Desk's review record can name this stop: the service saw it end,
 * or Herdr reports when the agent was last active. Otherwise the mark goes
 * to the terminal's completion check until the service names every stop.
 */
export const reviewStopKnown = (
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
) =>
  record?.observed_stop_id != null ||
  record?.stopped_at != null ||
  leaf.lastActivityAt != null;

/** Whether the agent's current stop is the one marked reviewed. */
export const isReviewedStop = (
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
) =>
  record?.reviewed_stop != null &&
  record.reviewed_stop === reviewStop(leaf, record);

const seenKey = (leaf: WorldLeafObject) =>
  completionSeenKey(leaf.connectionId, leaf.generation, leaf.terminalId);

/**
 * Finished work waiting for review, as Desk's review lane counts it: an agent
 * Herdr reports done, or an idle one whose turn the service saw end recently
 * (Herdr reports a finished turn as idle once it is seen).
 */
export const awaitsReview = (
  leaf: WorldLeafObject,
  record: DeskRecord | undefined,
  now: number,
  checked = false,
) =>
  (leaf.status === "done" ||
    (leaf.status === "idle" &&
      record?.stopped_at != null &&
      now - record.stopped_at <= IDLE_WINDOW_MS)) &&
  !checked &&
  !isReviewedStop(leaf, record);

/**
 * Marks an agent's finished work reviewed; true once the service saved it.
 * A caller that showed one stop's report marks that stop, not a newer one;
 * otherwise the current stop, read from the store at the moment of marking.
 * Work Desk cannot name a stop for takes the terminal's completion check,
 * whatever stop the caller showed (that stop names nothing).
 */
export function markReviewed(
  store: Pick<WorldDeskStore, "get" | "mutate">,
  seenStore: Pick<CompletionSeenStore, "markTerminal">,
  leaf: WorldLeafObject,
  stop?: string,
): Promise<boolean> {
  const key = deskKey(deskIdentity(leaf));
  const current = store.get().records.find((record) => deskKey(record) === key);
  if (!reviewStopKnown(leaf, current))
    return seenStore.markTerminal(
      leaf.connectionId,
      leaf.generation,
      leaf.terminalId,
    );
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
 * keyed by the agent and its current stop, is the record; a terminal's
 * completion check still counts as reviewed, and takes the mark when Desk
 * cannot name the stop. Lookups run only for the agents asked about, so a
 * dense World pays nothing per update. With `stops` false (Town) the caller
 * sees only reviewed records, so the service's frequent stop observations do
 * not re-render it; `toReview` then knows done agents only.
 */
export function useReviewedWork(
  store: WorldDeskStore = sharedDeskStore(),
  stops = true,
  seenStore: CompletionSeenStore = completionSeenStore,
) {
  useSharedDeskStore(store);
  const seen = useCompletionSeen(seenStore);
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
  const checked = useCallback(
    (leaf: WorldLeafObject) =>
      seen.terminals.has(leaf.terminalId) && seen.identities.has(seenKey(leaf)),
    [seen],
  );
  const reviewed = useCallback(
    (leaf: WorldLeafObject) =>
      checked(leaf) || isReviewedStop(leaf, recordOf(leaf)),
    [checked, recordOf],
  );
  const stopOf = useCallback(
    (leaf: WorldLeafObject) => reviewStop(leaf, recordOf(leaf)),
    [recordOf],
  );
  const toReview = useCallback(
    (leaf: WorldLeafObject, now: number) =>
      awaitsReview(leaf, recordOf(leaf), now, checked(leaf)),
    [checked, recordOf],
  );
  const mark = useCallback(
    (leaf: WorldLeafObject, stop?: string) =>
      markReviewed(store, seenStore, leaf, stop),
    [store, seenStore],
  );
  return {
    reviewed,
    stopOf,
    toReview,
    mark,
    verified: shown.verified && seen.verified,
  };
}
