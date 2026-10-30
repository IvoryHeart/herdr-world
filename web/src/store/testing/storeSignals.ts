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
 * Register before the trigger: resolves once `owner` completes a re-list. Every
 * completed re-list stamps `lastTopologyObservationStartedAt`, changed or not.
 */
export function relisted(owner: string): Promise<void> {
  const before = store.getConnection(owner).lastTopologyObservationStartedAt;
  return storeReaches(
    () =>
      store.getConnection(owner).lastTopologyObservationStartedAt !== before,
    `${owner} re-lists`,
  );
}
