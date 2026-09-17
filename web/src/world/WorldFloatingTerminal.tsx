import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampFloatingTerminalGeometry,
  defaultFloatingTerminalGeometry,
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import type {
  WorldFloatingTerminal,
  WorldInspectorConversation,
} from "./worldTerminalPresentation";
import type { OfficeCanvasAnchor } from "./PixelOfficeCanvas";
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
  onAnchorChange,
  onPortalChange,
}: {
  conversation: WorldInspectorConversation | WorldFloatingTerminal;
  cascadeIndex: number;
  compactActive: boolean;
  onFocus(): void;
  onAnchorChange(anchor: OfficeCanvasAnchor | null): void;
  onPortalChange(element: HTMLDivElement | null): void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const onAnchorChangeRef = useRef(onAnchorChange);
  const onFocusRef = useRef(onFocus);
  const onPortalChangeRef = useRef(onPortalChange);
  onAnchorChangeRef.current = onAnchorChange;
  onFocusRef.current = onFocus;
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

  useEffect(() => {
    const clampToViewport = () => {
      setGeometry((current) =>
        clampFloatingTerminalGeometry(current, viewportSize()),
      );
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  useEffect(() => {
    const element = windowRef.current;
    if (!element) return;
    const focusFromPointer = () => onFocusRef.current();
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
      element.setPointerCapture(event.pointerId);
      interactionRef.current = {
        mode: "moving",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        geometry: initial,
      };
      setInteraction("moving");
    };
    const move = (event: PointerEvent) => {
      const current = interactionRef.current;
      if (
        !current ||
        current.mode !== "moving" ||
        current.pointerId !== event.pointerId
      ) {
        return;
      }
      event.preventDefault();
      setGeometry({
        ...current.geometry,
        ...moveFloatingTerminalPosition(
          current.geometry,
          event.clientX - current.startX,
          event.clientY - current.startY,
          viewportSize(),
          current.geometry,
        ),
      });
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
          viewportSize(),
          current,
        ),
      });
    };
    element.addEventListener("pointerdown", beginMove, true);
    element.addEventListener("pointermove", move, true);
    element.addEventListener("pointerup", end, true);
    element.addEventListener("pointercancel", end, true);
    element.addEventListener("keydown", moveByKeyboard, true);
    return () => {
      element.removeEventListener("pointerdown", beginMove, true);
      element.removeEventListener("pointermove", move, true);
      element.removeEventListener("pointerup", end, true);
      element.removeEventListener("pointercancel", end, true);
      element.removeEventListener("keydown", moveByKeyboard, true);
    };
  }, []);

  useEffect(() => {
    onAnchorChangeRef.current({
      x: geometry.left + geometry.width / 2,
      y: geometry.top,
      visible: true,
      edge: null,
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
    element.setPointerCapture(event.pointerId);
    interactionRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry: initial,
    };
    setInteraction(mode);
  };

  const moveInteraction = (event: ReactPointerEvent<HTMLElement>) => {
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
          viewportSize(),
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
        viewportSize(),
      ),
    );
  };

  const endInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    setInteraction(null);
    if (windowRef.current?.hasPointerCapture(event.pointerId)) {
      windowRef.current.releasePointerCapture(event.pointerId);
    }
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
      resizeFloatingTerminalGeometry(current, delta.x, delta.y, viewportSize()),
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
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
    >
      <div ref={setPortalRef} className="world-floating-terminal-portal" />
      <button
        type="button"
        className="world-floating-terminal-resize"
        aria-label="Resize Inspector window"
        onPointerDown={(event) => beginInteraction("resizing", event)}
        onKeyDown={(event) => nudge("resizing", event)}
      />
    </section>
  );
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function arrowDelta(key: string, amount: number) {
  if (key === "ArrowLeft") return { x: -amount, y: 0 };
  if (key === "ArrowRight") return { x: amount, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -amount };
  if (key === "ArrowDown") return { x: 0, y: amount };
  return null;
}
