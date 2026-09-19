import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampFloatingTerminalGeometry,
  defaultFloatingTerminalGeometry,
  floatingTerminalContainingViewport,
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import type {
  WorldFloatingTerminal,
  WorldInspectorConversation,
} from "./worldTerminalPresentation";
import type { WorldConnectorTargetBounds } from "./worldConnectorGeometry";
import { worldLocalStorage } from "../browserStorage";
import {
  floatingTerminalGeometryId,
  readFloatingTerminalGeometry,
  writeFloatingTerminalGeometry,
} from "./floatingTerminalPreferences";

type Interaction = {
  mode: "moving" | "resizing";
  pointerId: number;
  startX: number;
  startY: number;
  geometry: FloatingTerminalGeometry;
};

export default function WorldFloatingInspectorWindow({
  conversation,
  cascadeIndex,
  compactActive,
  onFocus,
  onRaise,
  onAnchorChange,
  onPortalChange,
}: {
  conversation: WorldInspectorConversation | WorldFloatingTerminal;
  cascadeIndex: number;
  compactActive: boolean;
  onFocus(): void;
  onRaise(): void;
  onAnchorChange(anchor: WorldConnectorTargetBounds | null): void;
  onPortalChange(element: HTMLDivElement | null): void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const onAnchorChangeRef = useRef(onAnchorChange);
  const onFocusRef = useRef(onFocus);
  const onRaiseRef = useRef(onRaise);
  const onPortalChangeRef = useRef(onPortalChange);
  onAnchorChangeRef.current = onAnchorChange;
  onFocusRef.current = onFocus;
  onRaiseRef.current = onRaise;
  onPortalChangeRef.current = onPortalChange;
  const setPortalRef = useCallback((element: HTMLDivElement | null) => {
    onPortalChangeRef.current(element);
  }, []);
  const geometryId = floatingTerminalGeometryId(conversation);
  const [interaction, setInteraction] = useState<Interaction["mode"] | null>(
    null,
  );
  const [geometry, setGeometry] = useState<FloatingTerminalGeometry>(() => {
    const viewport = viewportSize();
    return readFloatingTerminalGeometry(
      worldLocalStorage,
      geometryId,
      defaultFloatingTerminalGeometry(cascadeIndex, viewport),
      viewport,
    );
  });
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;

  useEffect(() => {
    writeFloatingTerminalGeometry(worldLocalStorage, geometryId, geometry);
  }, [geometry, geometryId]);

  useLayoutEffect(() => {
    setGeometry((current) =>
      clampFloatingTerminalGeometry(
        current,
        viewportSize(windowRef.current, current),
      ),
    );
  }, []);

  useEffect(() => {
    const clampToViewport = () => {
      setGeometry((current) =>
        clampFloatingTerminalGeometry(
          current,
          viewportSize(windowRef.current, current),
        ),
      );
    };
    window.addEventListener("resize", clampToViewport);
    window.visualViewport?.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      window.visualViewport?.removeEventListener("resize", clampToViewport);
    };
  }, []);

  useEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    const focusFromPointer = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        (event.target.closest(".world-floating-terminal-resize") ||
          event.target.closest(".workspace-inspector-actions") ||
          (event.target.closest(
            ".workspace-inspector-head.is-window-drag-handle",
          ) &&
            !event.target.closest(
              "button, a, input, textarea, select, [role='tab'], [role='separator']",
            )))
      ) {
        return;
      }
      onFocusRef.current();
    };
    // Inspector content is rendered through a portal owned by a sibling.
    // React events follow that logical tree, not this window's DOM ancestry,
    // so a native capture listener is required for clicks in its resources.
    element.addEventListener("pointerdown", focusFromPointer, true);
    return () =>
      element.removeEventListener("pointerdown", focusFromPointer, true);
  }, []);

  useEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    const interactiveSelector =
      "button, a, input, textarea, select, [role='tab'], [role='separator']";
    const beginMove = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      const header = event.target.closest(
        ".workspace-inspector-head.is-window-drag-handle",
      );
      if (!header || event.target.closest(interactiveSelector)) return;
      event.preventDefault();
      const initial = geometryRef.current;
      interactionRef.current = {
        mode: "moving",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        geometry: initial,
      };
      onRaiseRef.current();
      capturePointer(element, event.pointerId);
      setInteraction("moving");
    };
    const move = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      const deltaX = event.clientX - current.startX;
      const deltaY = event.clientY - current.startY;
      if (current.mode === "moving") {
        setGeometry({
          ...current.geometry,
          ...moveFloatingTerminalPosition(
            current.geometry,
            deltaX,
            deltaY,
            viewportSize(element, current.geometry),
            current.geometry,
          ),
        });
        return;
      }
      setGeometry(
        resizeFloatingTerminalGeometry(
          current.geometry,
          deltaX,
          deltaY,
          viewportSize(element, current.geometry),
        ),
      );
    };
    const end = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      interactionRef.current = null;
      setInteraction(null);
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const moveByKeyboard = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element)) return;
      const header = event.target.closest(
        ".workspace-inspector-head.is-window-drag-handle",
      );
      if (!header || event.target !== header) return;
      const delta = arrowDelta(event.key, event.shiftKey ? 1 : 16);
      if (!delta) return;
      event.preventDefault();
      const current = geometryRef.current;
      setGeometry({
        ...current,
        ...moveFloatingTerminalPosition(
          current,
          delta.x,
          delta.y,
          viewportSize(windowRef.current, current),
          current,
        ),
      });
    };
    element.addEventListener("pointerdown", beginMove, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    element.addEventListener("keydown", moveByKeyboard, true);
    return () => {
      element.removeEventListener("pointerdown", beginMove, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      element.removeEventListener("keydown", moveByKeyboard, true);
    };
  }, []);

  useEffect(() => {
    onAnchorChangeRef.current({
      left: geometry.left,
      top: geometry.top,
      right: geometry.left + geometry.width,
      bottom: geometry.top + geometry.height,
    });
  }, [geometry]);

  useEffect(
    () => () => {
      onAnchorChangeRef.current(null);
    },
    [],
  );

  const currentGeometry = () => {
    return geometry;
  };

  const beginInteraction = (
    mode: Interaction["mode"],
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0) return;
    if (
      mode === "moving" &&
      event.target instanceof Element &&
      event.target.closest("button")
    ) {
      return;
    }
    const initial = currentGeometry();
    const element = windowRef.current;
    if (!element) return;
    event.preventDefault();
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: initial,
    };
    onRaiseRef.current();
    capturePointer(element, event.pointerId);
    setInteraction(mode);
  };

  const nudge = (
    mode: Interaction["mode"],
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    const amount = event.shiftKey ? 1 : 16;
    const delta = arrowDelta(event.key, amount);
    if (!delta) return;
    if (
      mode === "moving" &&
      event.target instanceof Element &&
      event.target.closest("button")
    ) {
      return;
    }
    const current = currentGeometry();
    if (!current) return;
    event.preventDefault();
    if (mode === "moving") {
      setGeometry({
        ...current,
        ...moveFloatingTerminalPosition(
          current,
          delta.x,
          delta.y,
          viewportSize(),
          current,
        ),
      });
      return;
    }
    setGeometry(
      resizeFloatingTerminalGeometry(
        current,
        delta.x,
        delta.y,
        viewportSize(windowRef.current, current),
      ),
    );
  };

  return (
    <section
      ref={windowRef}
      className="world-floating-terminal"
      role="dialog"
      aria-modal="false"
      aria-label={`${conversation.label} Inspector`}
      data-compact-active={compactActive}
      data-interaction={interaction ?? undefined}
      style={
        {
          left: geometry.left,
          top: geometry.top,
          width: geometry.width,
          height: geometry.height,
          right: "auto",
          bottom: "auto",
        } satisfies CSSProperties
      }
    >
      <div ref={setPortalRef} className="world-floating-terminal-portal" />
      <button
        type="button"
        className="world-floating-terminal-resize"
        aria-label="Resize Inspector window"
        title="Drag to resize Inspector; use arrow keys for precise sizing"
        onPointerDown={(event) => beginInteraction("resizing", event)}
        onKeyDown={(event) => nudge("resizing", event)}
      ></button>
    </section>
  );
}

function viewportSize(
  element?: HTMLElement | null,
  geometry?: FloatingTerminalGeometry,
) {
  const visualViewport = window.visualViewport;
  const viewport = {
    width: visualViewport?.width ?? window.innerWidth,
    height: visualViewport?.height ?? window.innerHeight,
    offsetLeft: visualViewport?.offsetLeft ?? 0,
    offsetTop: visualViewport?.offsetTop ?? 0,
  };
  if (!element || !geometry) return viewport;
  const rendered = element.getBoundingClientRect();
  return floatingTerminalContainingViewport(viewport, {
    left: rendered.left - geometry.left,
    top: rendered.top - geometry.top,
  });
}

function arrowDelta(key: string, amount: number) {
  if (key === "ArrowLeft") return { x: -amount, y: 0 };
  if (key === "ArrowRight") return { x: amount, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -amount };
  if (key === "ArrowDown") return { x: 0, y: amount };
  return null;
}

function capturePointer(element: HTMLElement, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some embedded browsers reject capture for synthetic or already-ended
    // pointers. The interaction remains usable while events stay in-window.
  }
}
