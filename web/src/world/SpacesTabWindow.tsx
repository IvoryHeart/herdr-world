import {
  useCallback,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FloatingTerminalGeometry } from "./floatingTerminalGeometry";
import "./SpacesTabWindow.css";

type Gesture = {
  pointerId: number;
  mode: "move" | "resize";
  x: number;
  y: number;
  geometry: FloatingTerminalGeometry;
};

export function SpacesTabWindow({
  tabId,
  label,
  active,
  geometry,
  stage,
  zIndex,
  onRaise,
  onFocus,
  onClose,
  onGeometryChange,
  onPortalChange,
}: {
  tabId: string;
  label: string;
  active: boolean;
  geometry: FloatingTerminalGeometry;
  stage: { width: number; height: number };
  zIndex: number;
  onRaise: () => void;
  onFocus: () => void;
  onClose: () => void;
  onGeometryChange: (geometry: FloatingTerminalGeometry) => void;
  onPortalChange: (element: HTMLDivElement | null) => void;
}) {
  const gestureRef = useRef<Gesture | null>(null);
  const portalChangeRef = useRef(onPortalChange);
  portalChangeRef.current = onPortalChange;
  const setPortal = useCallback(
    (element: HTMLDivElement | null) => portalChangeRef.current(element),
    [],
  );

  const startGesture = (
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: Gesture["mode"],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onFocus();
    gestureRef.current = {
      pointerId: event.pointerId,
      mode,
      x: event.clientX,
      y: event.clientY,
      geometry,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.mode === "move") {
      onGeometryChange({
        ...gesture.geometry,
        left: clamp(
          gesture.geometry.left + dx,
          0,
          stage.width - gesture.geometry.width,
        ),
        top: clamp(
          gesture.geometry.top + dy,
          0,
          stage.height - gesture.geometry.height,
        ),
      });
    } else {
      onGeometryChange({
        ...gesture.geometry,
        width: clamp(
          gesture.geometry.width + dx,
          320,
          stage.width - gesture.geometry.left,
        ),
        height: clamp(
          gesture.geometry.height + dy,
          180,
          stage.height - gesture.geometry.top,
        ),
      });
    }
  };

  const endGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const nudge = (mode: Gesture["mode"], key: string) => {
    onFocus();
    const delta = key === "ArrowLeft" || key === "ArrowUp" ? -20 : 20;
    if (mode === "move") {
      onGeometryChange({
        ...geometry,
        left:
          key === "ArrowLeft" || key === "ArrowRight"
            ? clamp(geometry.left + delta, 0, stage.width - geometry.width)
            : geometry.left,
        top:
          key === "ArrowUp" || key === "ArrowDown"
            ? clamp(geometry.top + delta, 0, stage.height - geometry.height)
            : geometry.top,
      });
    } else {
      onGeometryChange({
        ...geometry,
        width:
          key === "ArrowLeft" || key === "ArrowRight"
            ? clamp(geometry.width + delta, 320, stage.width - geometry.left)
            : geometry.width,
        height:
          key === "ArrowUp" || key === "ArrowDown"
            ? clamp(geometry.height + delta, 180, stage.height - geometry.top)
            : geometry.height,
      });
    }
  };

  return (
    <section
      className={`spaces-tab-window ${active ? "is-active" : ""}`}
      aria-label={`${label} terminal window`}
      data-tab-id={tabId}
      style={{ ...geometry, zIndex }}
      onPointerDownCapture={onRaise}
    >
      <header className="spaces-tab-window-header">
        <button
          type="button"
          className="spaces-tab-window-move"
          aria-label={`Move ${label} window`}
          title="Drag or use arrow keys to move window"
          onPointerDown={(event) => startGesture(event, "move")}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onKeyDown={(event) => {
            if (!event.key.startsWith("Arrow")) return;
            event.preventDefault();
            nudge("move", event.key);
          }}
        >
          {label}
        </button>
        <button
          type="button"
          className="spaces-tab-window-close"
          aria-label={`Close ${label} tab`}
          title="Close tab"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="spaces-tab-window-portal" ref={setPortal} />
      <button
        type="button"
        className="spaces-tab-window-resize"
        aria-label={`Resize ${label} window`}
        title="Drag or use arrow keys to resize window"
        onPointerDown={(event) => startGesture(event, "resize")}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onKeyDown={(event) => {
          if (!event.key.startsWith("Arrow")) return;
          event.preventDefault();
          nudge("resize", event.key);
        }}
      />
    </section>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(Math.max(min, max), value));
}
