/** Completion signals from the focused store, for tests that avoid sleeps. */
import { store } from "../../store";
import { settles } from "./simulatedWorld";

/** Resolves on the store emission (or now) where `predicate` holds. */
export function storeReaches(
  predicate: () => boolean,
  what: string,
): Promise<void> {
  if (predicate()) return Promise.resolve();
  let stop: () => unknown = () => {};
  const reached = new Promise<void>((resolve) => {
    stop = store.subscribe(() => {
      if (predicate()) resolve();
    });
  });
  return settles(reached, what).finally(() => stop());
}

/**
 * Register before the trigger: resolves once `owner` completes a re-list that
 * started after this call, so one already in flight can't satisfy it. Every
 * completed re-list stamps its start time (`performance.now()`) in
 * `lastTopologyObservationStartedAt`, changed or not.
 */
export function relisted(owner: string): Promise<void> {
  const registeredAt = performance.now();
  return storeReaches(
    () =>
      store.getConnection(owner).lastTopologyObservationStartedAt >
      registeredAt,
    `${owner} re-lists`,
  );
}
