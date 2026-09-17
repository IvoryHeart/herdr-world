import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PanelRightClose, X } from "lucide-react";
import {
  clampFloatingTerminalGeometry,
  defaultFloatingTerminalGeometry,
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import type { WorldFloatingTerminal } from "./worldTerminalPresentation";
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

export default function WorldFloatingTerminalWindow({
  conversation,
  cascadeIndex,
  compactActive,
  onClose,
  onDock,
  onFocus,
  onAnchorChange,
  onPortalChange,
}: {
  conversation: WorldFloatingTerminal;
  cascadeIndex: number;
  compactActive: boolean;
  onClose(): void;
  onDock(): void;
  onFocus(): void;
  onAnchorChange(anchor: OfficeCanvasAnchor | null): void;
  onPortalChange(element: HTMLDivElement | null): void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const onAnchorChangeRef = useRef(onAnchorChange);
  onAnchorChangeRef.current = onAnchorChange;
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
      aria-label={`${conversation.label} terminal`}
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
      onPointerDownCapture={onFocus}
      onPointerMove={moveInteraction}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
    >
      <header
        className="world-floating-terminal-header"
        tabIndex={0}
        aria-label="Move terminal window"
        onPointerDown={(event) => beginInteraction("moving", event)}
        onKeyDown={(event) => nudge("moving", event)}
      >
        <div>
          <strong>{conversation.label}</strong>
          <span>
            {conversation.hostLabel} · {conversation.spaceLabel}
          </span>
        </div>
        <div className="world-floating-terminal-actions">
          <button
            type="button"
            onClick={onDock}
            title="Dock terminal in profile"
            aria-label="Dock terminal in profile"
          >
            <PanelRightClose size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <X size={15} />
          </button>
        </div>
      </header>
      <div ref={onPortalChange} className="world-floating-terminal-portal" />
      <button
        type="button"
        className="world-floating-terminal-resize"
        aria-label="Resize terminal window"
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
