import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * A function whose identity never changes but which always calls the latest
 * `fn`, so a memoized child gets a stable prop without a stale closure.
 * The latest `fn` is installed before any effect or event runs.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
