import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createWindowManager,
  reconcileWindows,
  reduceWindowManager,
  type Size,
  type WindowCommand,
  type WindowInput,
  type WindowManagerState,
} from "./windowManager";

/** Scope adapters supply identities; this hook owns all presentation state. */
export function useWindowManager(
  inputs: readonly WindowInput[],
  size: Size,
  scope = "visual",
  initiallySingle = false,
) {
  const [scopes, setScopes] = useState<Record<string, WindowManagerState>>({});
  const empty = useMemo(
    () => ({ ...createWindowManager(), focusMode: initiallySingle }),
    [initiallySingle],
  );
  const state = reconcileWindows(scopes[scope] ?? empty, inputs, size);
  const current = useRef({ inputs, size, scope, initiallySingle });
  current.current = { inputs, size, scope, initiallySingle };
  // Reconcile before committing children: publishing a derived state from a
  // layout effect can race commands issued by those children's layout effects.
  if (state !== scopes[scope] && size.width > 0 && size.height > 0)
    setScopes({ ...scopes, [scope]: state });
  const dispatch = useCallback((command: WindowCommand) => {
    const { inputs, size, scope, initiallySingle } = current.current;
    setScopes((previous) => {
      const before = reconcileWindows(
        previous[scope] ?? {
          ...createWindowManager(),
          focusMode: initiallySingle,
        },
        inputs,
        size,
      );
      const after = reduceWindowManager(before, command, size);
      return after === previous[scope]
        ? previous
        : { ...previous, [scope]: after };
    });
  }, []);
  return { state, dispatch };
}

/** All frame coordinates are local CSS pixels; zoom is handled at pointer input. */
export function useWindowWorkArea(
  element: HTMLElement | null,
  active = true,
): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element || !active) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((old) =>
        old.width === next.width && old.height === next.height ? old : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [element, active]);
  return size;
}
