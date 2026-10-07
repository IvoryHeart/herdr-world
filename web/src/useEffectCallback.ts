import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable effect listener using the callback from the latest committed render. */
export function useEffectCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
