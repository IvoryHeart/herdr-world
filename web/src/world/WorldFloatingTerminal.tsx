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
  moveFloatingTerminalPosition,
  resizeFloatingTerminalGeometry,
  type FloatingTerminalGeometry,
} from "./floatingTerminalGeometry";
import type { WorldFloatingTerminal } from "./worldTerminalPresentation";

type Interaction = {
  mode: "moving" | "resizing";
  pointerId: number;
  startX: number;
  startY: number;
  geometry: FloatingTerminalGeometry;
};

export default function WorldFloatingTerminalWindow({
  conversation,
  onClose,
  onDock,
  onPortalChange,
}: {
  conversation: WorldFloatingTerminal;
  onClose(): void;
  onDock(): void;
  onPortalChange(element: HTMLDivElement | null): void;
}) {
  const windowRef = useRef<HTMLElement | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const [interaction, setInteraction] = useState<Interaction["mode"] | null>(
    null,
  );
  const [geometry, setGeometry] = useState<FloatingTerminalGeometry | null>(
    null,
  );

  useEffect(() => {
    const clampToViewport = () => {
      setGeometry((current) =>
        current
          ? clampFloatingTerminalGeometry(current, viewportSize())
          : current,
      );
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const currentGeometry = () => {
    if (geometry) return geometry;
    const rect = windowRef.current?.getBoundingClientRect();
    return rect
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : null;
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
    if (!initial || !element) return;
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
      data-interaction={interaction ?? undefined}
      style={
        geometry
          ? ({
              left: geometry.left,
              top: geometry.top,
              width: geometry.width,
              height: geometry.height,
              right: "auto",
              bottom: "auto",
            } satisfies CSSProperties)
          : undefined
      }
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
