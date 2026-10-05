import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  visibleWindowIds,
  windowCanvas,
  windowDividers,
  windowGeometry,
  usesWindowCanvas,
  type ManagedWindow,
  type Size,
  type WindowCommand,
  type WindowManagerState,
} from "./windowManager";
import type { FloatingTerminalGeometry as Rect } from "../floatingTerminalGeometry";
import "./windows.css";

export function WindowSurface({
  state,
  dispatch,
  stage,
  compact,
  onLayer,
  children,
  className = "",
  bounds,
}: {
  state: WindowManagerState;
  dispatch(command: WindowCommand): void;
  stage: Size;
  compact: boolean;
  onLayer(element: HTMLDivElement | null): void;
  children(props: {
    entry: ManagedWindow;
    geometry: Rect;
    stage: Size;
    zIndex: number;
    active: boolean;
  }): ReactNode;
  className?: string;
  bounds?: Size;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const canvas =
    compact || state.focusMode ? stage : windowCanvas(state, stage);
  const visible = visibleWindowIds(state, compact);
  const overflow =
    canvas.width > stage.width + 1 || canvas.height > stage.height + 1;
  const latest = useRef({ state, dispatch, stage, compact });
  latest.current = { state, dispatch, stage, compact };
  useEffect(() => {
    const { state, stage, compact } = latest.current;
    if (!ref.current || !state.activeId) return;
    const geometry = windowGeometry(state, state.activeId, stage, compact);
    if (!geometry) return;
    const host = ref.current;
    if (geometry.left < host.scrollLeft) host.scrollLeft = geometry.left;
    else if (geometry.left + geometry.width > host.scrollLeft + stage.width)
      host.scrollLeft = geometry.left + geometry.width - stage.width;
    if (geometry.top < host.scrollTop) host.scrollTop = geometry.top;
    else if (geometry.top + geometry.height > host.scrollTop + stage.height)
      host.scrollTop = geometry.top + geometry.height - stage.height;
  }, [state.revealVersion, compact, stage.width, stage.height]);
  const layerRef = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element;
      onLayer(element);
    },
    [onLayer],
  );
  return (
    <div
      ref={layerRef}
      style={{ ...bounds, overflow: overflow ? "auto" : "hidden" }}
      className={`world-window-layer ${className} ${overflow ? "has-overflow" : ""} ${canvas.height > stage.height + 1 ? "is-vertical-scroll" : ""} ${canvas.width > stage.width + 1 ? "is-horizontal-scroll" : ""}`}
      onScroll={(event) =>
        setScroll({
          left: event.currentTarget.scrollLeft,
          top: event.currentTarget.scrollTop,
        })
      }
    >
      <div
        className="world-window-canvas"
        style={{ width: canvas.width, height: canvas.height }}
      >
        {visible.map((id) => {
          const entry = state.windows[id]!;
          const geometry = windowGeometry(state, id, stage, compact)!;
          if (
            overflow &&
            !entry.maximized &&
            (geometry.left + geometry.width < scroll.left - stage.width ||
              geometry.left > scroll.left + stage.width * 2 ||
              geometry.top + geometry.height < scroll.top - stage.height ||
              geometry.top > scroll.top + stage.height * 2)
          )
            return null;
          const displayed =
            entry.maximized || compact || state.focusMode
              ? { ...geometry, left: scroll.left, top: scroll.top }
              : geometry;
          return children({
            entry,
            geometry: displayed,
            stage:
              usesWindowCanvas(entry) &&
              !entry.maximized &&
              !state.focusMode &&
              !compact
                ? canvas
                : stage,
            zIndex: 2 + state.stack.indexOf(id),
            active: id === state.activeId,
          });
        })}
        {!compact &&
          windowDividers(state, stage).map((divider, index) => (
            <button
              key={`${divider.axis}:${index}`}
              type="button"
              role="separator"
              aria-label={
                divider.axis === "x"
                  ? "Resize window columns"
                  : "Resize window rows"
              }
              aria-orientation={
                divider.axis === "x" ? "vertical" : "horizontal"
              }
              aria-valuenow={Math.round(divider.position)}
              className="world-window-divider"
              style={
                divider.axis === "x"
                  ? {
                      left: divider.position - 3,
                      top: divider.start,
                      width: 6,
                      height: divider.length,
                      cursor: "col-resize",
                    }
                  : {
                      left: divider.start,
                      top: divider.position - 3,
                      width: divider.length,
                      height: 6,
                      cursor: "row-resize",
                    }
              }
              onKeyDown={(event) => {
                const negative = divider.axis === "x" ? "ArrowLeft" : "ArrowUp",
                  positive = divider.axis === "x" ? "ArrowRight" : "ArrowDown";
                if (event.key !== negative && event.key !== positive) return;
                event.preventDefault();
                event.stopPropagation();
                dispatch({
                  type: "divide",
                  divider,
                  delta:
                    (event.key === negative ? -1 : 1) *
                    (event.shiftKey ? 1 : 16),
                });
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                const handle = event.currentTarget;
                const x = event.clientX,
                  y = event.clientY;
                const scale = ref.current
                  ? ref.current.getBoundingClientRect().width /
                    ref.current.offsetWidth
                  : 1;
                let previous = 0;
                handle.setPointerCapture(event.pointerId);
                const move = (next: PointerEvent) => {
                  const value =
                    (divider.axis === "x"
                      ? next.clientX - x
                      : next.clientY - y) / (scale || 1);
                  latest.current.dispatch({
                    type: "divide",
                    divider,
                    delta: value - previous,
                  });
                  previous = value;
                };
                const end = () => {
                  handle.removeEventListener("pointermove", move);
                  handle.removeEventListener("pointerup", end);
                  handle.removeEventListener("pointercancel", end);
                };
                handle.addEventListener("pointermove", move);
                handle.addEventListener("pointerup", end, { once: true });
                handle.addEventListener("pointercancel", end, { once: true });
              }}
            />
          ))}
      </div>
    </div>
  );
}
