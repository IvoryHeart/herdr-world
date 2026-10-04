import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { FloatingTerminalGeometry as Rect } from "../floatingTerminalGeometry";
import {
  fitWindow,
  snapGeometry,
  type Size,
  type SnapTarget,
} from "./windowManager";
import {
  RESIZE_EDGES,
  resizeWindow,
  snapAtPointer,
  type ResizeEdge,
} from "./windowInteraction";
import "./windows.css";

export function WindowFrame({
  id,
  label,
  geometry,
  restoreGeometry,
  stage,
  active,
  compact,
  zIndex,
  onRaise,
  onPlace,
  onSnap,
  onMaximize,
  onPortalChange,
  children,
  className = "",
  onBoundsChange,
  onTerminalActivate,
}: {
  id: string;
  label: string;
  geometry: Rect;
  restoreGeometry?: Rect;
  stage: Size;
  active: boolean;
  compact: boolean;
  zIndex: number;
  onRaise(): void;
  onPlace(rect: Rect): void;
  onSnap(target: SnapTarget): void;
  onMaximize(): void;
  onTerminalActivate?(paneId: string | null): void;
  onPortalChange?(element: HTMLDivElement | null): void;
  children?: ReactNode;
  className?: string;
  onBoundsChange?(
    bounds: { left: number; top: number; right: number; bottom: number } | null,
  ): void;
}) {
  const ref = useRef<HTMLElement>(null);
  const latest = useRef({
    geometry,
    restoreGeometry,
    stage,
    compact,
    onRaise,
    onPlace,
    onSnap,
    onMaximize,
    onPortalChange,
    onBoundsChange,
    onTerminalActivate,
  });
  latest.current = {
    geometry,
    restoreGeometry,
    stage,
    compact,
    onRaise,
    onPlace,
    onSnap,
    onMaximize,
    onPortalChange,
    onBoundsChange,
    onTerminalActivate,
  };
  const [preview, setPreview] = useState<SnapTarget | "maximize" | null>(null);
  const [interacting, setInteracting] = useState(false);
  const [interactionRect, setInteractionRect] = useState<Rect | null>(null);
  const displayed = interactionRect ?? geometry;
  const portal = useCallback(
    (element: HTMLDivElement | null) =>
      latest.current.onPortalChange?.(element),
    [],
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    type Gesture = {
      pointerId: number;
      x: number;
      y: number;
      scale: number;
      rect: Rect;
      current: Rect;
      edge: ResizeEdge | null;
      target: SnapTarget | "maximize" | null;
      moved: boolean;
    };
    let gesture: Gesture | null = null;
    const begin = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      latest.current.onRaise();
      if (event.target.closest(".xterm"))
        latest.current.onTerminalActivate?.(
          event.target.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ??
            null,
        );
      if (latest.current.compact) return;
      const edge = event.target.closest<HTMLElement>("[data-window-resize]")
        ?.dataset.windowResize as ResizeEdge | undefined;
      const handle = event.target.closest(
        "[data-window-drag-handle], .workspace-inspector-head.is-window-drag-handle",
      );
      if (
        !edge &&
        (!handle ||
          event.target.closest(
            "button:not([data-window-drag-handle]),a,input,textarea,select,[role=tab],[role=separator]",
          ))
      )
        return;
      event.preventDefault();
      const rendered = element.getBoundingClientRect();
      const scale = rendered.width / latest.current.geometry.width || 1;
      let rect = { ...latest.current.geometry };
      if (!edge && latest.current.restoreGeometry) {
        const fraction = (event.clientX - rendered.left) / rendered.width;
        rect = fitWindow(
          {
            ...latest.current.restoreGeometry,
            left:
              rect.left +
              (event.clientX - rendered.left) / scale -
              latest.current.restoreGeometry.width * fraction,
            top: rect.top,
          },
          latest.current.stage,
        );
      }
      gesture = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scale,
        rect,
        current: rect,
        edge: edge ?? null,
        target: null,
        moved: false,
      };
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        /* Window listeners also handle uncaptured pointers. */
      }
      setInteracting(true);
    };
    const move = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = (event.clientX - gesture.x) / gesture.scale,
        dy = (event.clientY - gesture.y) / gesture.scale;
      if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      gesture.moved = true;
      event.preventDefault();
      const current = latest.current;
      gesture.current = gesture.edge
        ? resizeWindow(gesture.rect, gesture.edge, dx, dy, current.stage)
        : fitWindow(
            {
              ...gesture.rect,
              left: gesture.rect.left + dx,
              top: gesture.rect.top + dy,
            },
            current.stage,
          );
      setInteractionRect(gesture.current);
      if (!gesture.edge) {
        const layer = element.offsetParent?.getBoundingClientRect();
        gesture.target = layer
          ? snapAtPointer(
              (event.clientX - layer.left) / gesture.scale,
              (event.clientY - layer.top) / gesture.scale,
              current.stage,
            )
          : null;
        setPreview(gesture.target);
      }
    };
    const end = (event: PointerEvent) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const finished = gesture;
      gesture = null;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
      setInteracting(false);
      setPreview(null);
      setInteractionRect(null);
      if (event.type === "pointercancel") return;
      if (finished.moved) latest.current.onPlace(finished.current);
      if (finished.moved && finished.target === "maximize")
        latest.current.onMaximize();
      else if (
        finished.moved &&
        finished.target &&
        finished.target !== "maximize"
      )
        latest.current.onSnap(finished.target);
    };
    const key = (event: KeyboardEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      if (event.key === "Enter" && event.target === element) {
        const input = element.querySelector<HTMLTextAreaElement>(
          ".pane-layout-cell.is-active .xterm-helper-textarea, .pane-layout-single .xterm-helper-textarea, .pane-switcher-layout .xterm-helper-textarea",
        );
        if (input) {
          event.preventDefault();
          event.stopPropagation();
          latest.current.onTerminalActivate?.(
            input.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ??
              null,
          );
          input.focus({ preventScroll: true });
        }
        return;
      }
      if (latest.current.compact) return;
      const edge = event.target.dataset.windowResize as ResizeEdge | undefined;
      const handle = event.target.matches(
        "[data-window-drag-handle],.workspace-inspector-head.is-window-drag-handle",
      );
      if (!edge && !handle) return;
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onRaise();
      const n = event.shiftKey ? 1 : 16;
      const dx =
        event.key === "ArrowLeft" ? -n : event.key === "ArrowRight" ? n : 0;
      const dy =
        event.key === "ArrowUp" ? -n : event.key === "ArrowDown" ? n : 0;
      latest.current.onPlace(
        edge
          ? resizeWindow(
              latest.current.geometry,
              edge,
              dx,
              dy,
              latest.current.stage,
            )
          : fitWindow(
              {
                ...latest.current.geometry,
                left: latest.current.geometry.left + dx,
                top: latest.current.geometry.top + dy,
              },
              latest.current.stage,
            ),
      );
    };
    const focus = () => latest.current.onRaise();
    element.addEventListener("pointerdown", begin, true);
    element.addEventListener("focusin", focus);
    element.addEventListener("keydown", key, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    return () => {
      element.removeEventListener("pointerdown", begin, true);
      element.removeEventListener("focusin", focus);
      element.removeEventListener("keydown", key, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
    };
  }, []);
  useEffect(() => {
    const bounds = ref.current?.getBoundingClientRect();
    if (bounds)
      latest.current.onBoundsChange?.({
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
      });
    return () => latest.current.onBoundsChange?.(null);
  }, [displayed.left, displayed.top, displayed.width, displayed.height]);
  const previewRect =
    preview === "maximize"
      ? { left: 0, top: 0, ...stage }
      : preview
        ? snapGeometry(preview, stage)
        : null;
  return (
    <>
      {previewRect && (
        <div
          className="world-window-snap-preview"
          style={{ ...previewRect, zIndex: zIndex + 1 }}
          aria-hidden="true"
        />
      )}
      <section
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        data-window-id={id}
        data-tab-id={className.includes("spaces-tab-window") ? id : undefined}
        data-interaction={interacting ? "moving" : undefined}
        className={`world-managed-window ${className} ${active ? "is-active" : ""} ${compact ? "is-compact" : ""}`}
        style={{ ...displayed, zIndex }}
      >
        {children}
        {onPortalChange && (
          <div ref={portal} className="world-window-content" />
        )}
        {!compact &&
          RESIZE_EDGES.map((edge) => (
            <button
              key={edge}
              type="button"
              data-window-resize={edge}
              className={`world-window-resize edge-${edge}`}
              aria-label={`Resize ${label} ${edge}`}
              title="Drag or use arrow keys to resize"
            />
          ))}
      </section>
    </>
  );
}
