import {
  createContext,
  useSyncExternalStore,
  useContext,
  useRef,
  useMemo,
} from "react";
import { type State } from "./types";
import { store } from "../store";
import { connectionSnapshot } from "./sessions";
import { operationalStore } from "./operations";

export interface OperationalContext {
  connectionId: string;
  runtimeGeneration: number;
}
export const OperationalContext = createContext<OperationalContext | null>(
  null,
);

export function useStore(): State {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Shallowly compares own enumerable values; pair with useStoreSelector. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  ) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (
      !Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Subscribe to a derived slice of the store. The selector result is cached
 * and reused while `isEqual` reports equality, so inline selectors are safe
 * as long as they keep stable semantics; object-returning selectors should
 * pass a shallow equality to avoid re-rendering on every emit.
 */
export function useStoreSelector<T>(
  selector: (state: State) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const context = useContext(OperationalContext);
  const cacheRef = useRef<{
    state: State;
    selector: (state: State) => T;
    value: T;
  } | null>(null);

  const getSnapshot = () => {
    const source = store.get();
    const snapshot = context
      ? connectionSnapshot(source, context.connectionId)
      : source;
    const cache = cacheRef.current;
    if (cache && cache.state === snapshot && cache.selector === selector) {
      return cache.value;
    }
    const value = selector(snapshot);
    if (cache && isEqual(cache.value, value)) {
      cacheRef.current = { state: snapshot, selector, value: cache.value };
      return cache.value;
    }
    cacheRef.current = { state: snapshot, selector, value };
    return value;
  };

  return useSyncExternalStore(store.subscribe, getSnapshot);
}

export function useOperationalStore() {
  const context = useContext(OperationalContext);
  const owner = useStoreSelector(
    (snapshot) => ({
      connectionId: snapshot.activeConnectionId,
      runtimeGeneration: snapshot.serverRuntimeGeneration,
    }),
    shallowEqual,
  );
  const status = useStoreSelector((snapshot) => snapshot.status);
  const attachEpoch = useStoreSelector(
    (snapshot) => snapshot.terminalAttachEpoch,
  );
  const connectionId = context?.connectionId ?? owner.connectionId;
  const runtimeGeneration =
    context?.runtimeGeneration ?? owner.runtimeGeneration;
  return useMemo(() => {
    void status;
    void attachEpoch;
    return operationalStore({
      connectionId,
      runtimeGeneration: runtimeGeneration ?? -1,
    });
  }, [connectionId, runtimeGeneration, status, attachEpoch]);
}
