import {
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import { isMobileLayout } from "../layoutPreferences";

type ToastProps = {
  className: string;
  role: "status" | "alert";
  onDismiss: () => void;
  /** Identifies the displayed notification; changes cancel in-flight swipes. */
  notificationKey: string | number | undefined;
  dismissDisabled?: boolean;
  children: ReactNode;
};

type SwipeState = {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  offset: number;
  swiping: boolean;
  /** Set when the gesture began on scrollable output: drag scrolls it. */
  scroller: HTMLElement | null;
  startScrollTop: number;
};

const SWIPE_SLOP_PX = 6;
const SWIPE_DISMISS_PX = 36;
const SWIPE_DISMISS_VELOCITY = 0.45;
const SWIPE_EXIT_MS = 180;
const REPEAT_DISMISS_MS = 500;

/** A rapid second tap must not activate the control a removed toast exposed. */
function guardRemovedToastClick(point: { x: number; y: number; at: number }) {
  const remaining = REPEAT_DISMISS_MS - (performance.now() - point.at);
  if (remaining <= 0) return;
  const events = [
    "pointerdown",
    "pointerup",
    "pointercancel",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
  ] as const;
  const held = new Set<number>();
  const releasePoint = { x: point.x, y: point.y };
  const cleanup = () => {
    for (const type of events) window.removeEventListener(type, guard, true);
    window.removeEventListener("blur", cleanup);
    window.clearTimeout(timer);
  };
  let timer = window.setTimeout(cleanup, remaining);
  const guard = (event: MouseEvent) => {
    const pointerId = (event as PointerEvent).pointerId;
    if (
      !event.isTrusted ||
      (event.type === "click" && event.detail === 0) ||
      (!held.has(pointerId) &&
        (event.button !== 0 ||
          Math.min(
            Math.hypot(event.clientX - point.x, event.clientY - point.y),
            Math.hypot(
              event.clientX - releasePoint.x,
              event.clientY - releasePoint.y,
            ),
          ) > 24 ||
          (event.target instanceof Element && event.target.closest(".toast"))))
    )
      return;
    // Keep a second contact blocked through release, even if it is held past
    // the repeat window or moved away from the original close button.
    if (event.type === "pointerdown") {
      held.add(pointerId);
      window.clearTimeout(timer);
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      // The compatibility click follows the release coordinates after a drag.
      if (event.type === "pointerup") {
        releasePoint.x = event.clientX;
        releasePoint.y = event.clientY;
      }
      held.delete(pointerId);
      if (!held.size) timer = window.setTimeout(cleanup, REPEAT_DISMISS_MS);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of events) window.addEventListener(type, guard, true);
  window.addEventListener("blur", cleanup, { once: true });
}

// Touch-only swipe-up dismissal in the mobile layout, matching native
// notification banners. Desktop layouts, mouse, and pen keep the explicit
// close button.
export function Toast({
  className,
  role,
  onDismiss,
  notificationKey,
  dismissDisabled = false,
  children,
}: ToastProps) {
  const ref = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<SwipeState | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const clickRef = useRef<{ x: number; y: number; at: number } | null>(null);

  // A replacement notification reuses this element. Abandon gestures and
  // exits that began on the previous one before the new one paints, so they
  // cannot dismiss it; this also cancels a pending exit on unmount.
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (clickRef.current) guardRemovedToastClick(clickRef.current);
      clickRef.current = null;
      swipeRef.current = null;
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      el?.classList.remove("toast-swiping");
      el?.style.removeProperty("transform");
      el?.style.removeProperty("opacity");
    };
  }, [notificationKey]);

  const setOffset = (offset: number, swiping: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle("toast-swiping", swiping);
    if (offset === 0) {
      el.style.removeProperty("transform");
      el.style.removeProperty("opacity");
      return;
    }
    el.style.transform = `translate3d(0, ${offset}px, 0)`;
    el.style.opacity = String(Math.max(0, 1 + Math.min(0, offset) / 140));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "touch" ||
      swipeRef.current ||
      exitTimerRef.current !== null ||
      !isMobileLayout()
    )
      return;
    const target = event.target as Element;
    // Buttons keep their taps.
    if (target.closest("button")) return;
    const scroller = target.closest<HTMLElement>(".toast-output pre");
    swipeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: event.timeStamp,
      offset: 0,
      swiping: false,
      scroller,
      startScrollTop: scroller?.scrollTop ?? 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    const dx = event.clientX - swipe.startX;
    const dy = event.clientY - swipe.startY;
    if (!swipe.swiping) {
      if (Math.abs(dx) < SWIPE_SLOP_PX && Math.abs(dy) < SWIPE_SLOP_PX) return;
      if (Math.abs(dx) > Math.abs(dy)) {
        swipeRef.current = null;
        return;
      }
      swipe.swiping = true;
      // A running entry animation overrides the inline transform, so jump it
      // to its end state; finishing (unlike removing it) never replays it.
      if (!swipe.scroller)
        for (const animation of ref.current?.getAnimations() ?? [])
          animation.finish();
    }
    // The mobile toast's touch-action: none also blocks native panning of
    // its output (descendants cannot re-enable it in every engine), so drags
    // that start there scroll the output by hand instead of dismissing.
    if (swipe.scroller) {
      swipe.scroller.scrollTop = swipe.startScrollTop - dy;
      return;
    }
    // Follow upward drags; resist downward or blocked ones like a rubber band.
    swipe.offset = dy < 0 && !dismissDisabled ? dy : dy / 5;
    setOffset(swipe.offset, true);
  };

  const finishSwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const swipe = swipeRef.current;
    if (!swipe || swipe.pointerId !== event.pointerId) return;
    swipeRef.current = null;
    if (!swipe.swiping || swipe.scroller) return;
    const elapsed = Math.max(1, event.timeStamp - swipe.startTime);
    const velocity = swipe.offset / elapsed;
    const dismiss =
      event.type === "pointerup" &&
      !dismissDisabled &&
      (swipe.offset <= -SWIPE_DISMISS_PX ||
        (swipe.offset < -SWIPE_SLOP_PX && velocity <= -SWIPE_DISMISS_VELOCITY));
    if (!dismiss) {
      setOffset(0, false);
      return;
    }
    const el = ref.current;
    const exit = -((el?.offsetHeight ?? 120) + (el?.offsetTop ?? 0) + 24);
    setOffset(exit, false);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      onDismiss();
      setOffset(0, false);
    }, SWIPE_EXIT_MS);
  };

  const rememberClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Keyboard and programmatic activations do not begin a pointer sequence.
    if (!event.isTrusted || event.detail === 0) return;
    clickRef.current = {
      x: event.clientX,
      y: event.clientY,
      at: performance.now(),
    };
  };

  return (
    <div
      ref={ref}
      className={className}
      role={role}
      onClickCapture={rememberClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishSwipe}
      onPointerCancel={finishSwipe}
    >
      {children}
      <span className="toast-grabber" aria-hidden="true" />
    </div>
  );
}
