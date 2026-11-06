import { useCallback, useSyncExternalStore } from "react";
import { deskKey } from "../../../shared/deskState";
import { useConversationRead } from "./conversationRead";
import { sharedDeskStore, useSharedDeskStore } from "./deskStateStore";
import { deskIdentity } from "./useDeskState";
import { reviewStop } from "./useReviewedWork";
import type { WorldLeafObject } from "./worldObject";

/**
 * The current stop of one agent, as the reviewed record names it, or null
 * while the shared record is unverified. Only this agent's record is read,
 * so another agent's stop notice does not re-render the caller.
 */
export function useReviewStop(
  leaf: WorldLeafObject | null,
  store = sharedDeskStore(),
) {
  useSharedDeskStore(store);
  const key = leaf ? deskKey(deskIdentity(leaf)) : null;
  const get = useCallback(() => {
    if (!leaf || key === null) return null;
    const state = store.get();
    if (!state.verified) return null;
    return reviewStop(
      leaf,
      state.records.find((record) => deskKey(record) === key),
    );
    // The stop depends on the leaf's identity and last activity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key, leaf?.lastActivityAt]);
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * An agent's latest report as Chat reads it, and whether it is the report
 * of the agent's current stop: Mark reviewed names the stop shown, so it
 * waits while a new stop's report is read and offers Retry when it fails.
 */
export function useShownReport(
  leaf: WorldLeafObject | null,
  active: boolean,
  reviewable: boolean,
  store = sharedDeskStore(),
) {
  const stop = useReviewStop(active && reviewable ? leaf : null, store);
  const read = useConversationRead(leaf, active, stop);
  const current = stop !== null && !!read.conversation && read.readFor === stop;
  const failed = read.failed && !current;
  return {
    conversation: read.conversation,
    stop: current ? stop : null,
    failed,
    retry: read.retry,
    /** For a Mark reviewed button: ready only for the shown stop's report. */
    review: { ready: current, failed, onRetry: read.retry },
    /** Marks the stop whose report is shown, and says whether it saved. */
    markShown: (
      mark: (leaf: WorldLeafObject, stop: string) => Promise<boolean>,
      label: string,
      toast: (kind: "ok" | "error", text: string) => void,
    ) =>
      leaf && current && stop !== null
        ? markShownReport(mark, leaf, stop, label, toast)
        : Promise.resolve(false),
  };
}

/**
 * Marks a shown report reviewed and says what happened: success only once
 * the service saved the mark, otherwise a failure to retry. Town's peek
 * calls it with the stop whose report it shows.
 */
export async function markShownReport(
  mark: (leaf: WorldLeafObject, stop: string) => Promise<boolean>,
  leaf: WorldLeafObject,
  stop: string,
  label: string,
  toast: (kind: "ok" | "error", text: string) => void,
) {
  const saved = await mark(leaf, stop).catch(() => false);
  toast(
    saved ? "ok" : "error",
    saved
      ? `${label}'s work reviewed`
      : `Could not save the review mark for ${label}. Try again when the connection is ready.`,
  );
  return saved;
}
