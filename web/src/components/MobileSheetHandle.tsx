import { useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import "./MobileSheetHandle.css";

export function MobileSheetHandle({
  label,
  expanded,
  onExpand,
  onCollapse,
  onClose,
  onClick,
}: {
  label: string;
  expanded?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  onClose: () => void;
  onClick?: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const activate = useRef<() => void>(() => {});
  const actions = useRef({ expanded, onExpand, onCollapse, onClose, onClick });
  useLayoutEffect(() => {
    actions.current = { expanded, onExpand, onCollapse, onClose, onClick };
  });

  useEffect(() => {
    const handle = button.current!;
    const sheet = handle.parentElement!;
    let animation: Animation | null = null;
    let sizeAnimation: Animation | null = null;
    const duration = () =>
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
    let dragged = false;
    let start: {
      x: number;
      y: number;
      scale: number;
      height: number;
      heights: { compact: number; expanded: number } | null;
      scrollUp: boolean;
      scrollDown: boolean;
      claimed: boolean;
    } | null = null;
    const clearStyles = () => {
      sheet.classList.remove("is-dragging", "is-resizing");
      sheet.style.removeProperty("transform");
      sheet.style.removeProperty("height");
      sheet.style.removeProperty("max-height");
    };
    const reset = () => {
      start = null;
      clearStyles();
    };
    const settle = (action?: () => void) => {
      const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth;
      const from = sheet.getBoundingClientRect().height / scale;
      const transform = getComputedStyle(sheet).transform;
      sizeAnimation?.cancel();
      reset();
      if (action) flushSync(action);
      if (!actions.current.onExpand) return;
      const to = sheet.getBoundingClientRect().height / scale;
      sheet.classList.add("is-resizing");
      sheet.style.height = `${to}px`;
      sheet.style.maxHeight = "none";
      const pending = sheet.animate(
        [
          { height: `${from}px`, transform },
          { height: `${to}px`, transform: "none" },
        ],
        { duration: duration(), easing: "ease-out" },
      );
      sizeAnimation = pending;
      void pending.finished.then(
        () => {
          if (sizeAnimation !== pending) return;
          sizeAnimation = null;
          clearStyles();
        },
        () => {},
      );
    };
    const close = () => {
      if (animation) return;
      const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth;
      animation = sheet.animate(
        [
          { transform: getComputedStyle(sheet).transform },
          { transform: `translateY(${sheet.offsetHeight + 24 / scale}px)` },
        ],
        {
          duration: duration(),
          easing: "ease-out",
          fill: "forwards",
        },
      );
      // Replacing a lazy fallback can cancel its animation, not the accepted dismissal.
      const onClosed = actions.current.onClose;
      void animation.finished.then(onClosed, onClosed);
    };
    activate.current = () =>
      actions.current.onClick ? settle(actions.current.onClick) : close();
    const begin = (target: EventTarget | null, x: number, y: number) => {
      dragged = false;
      if (start) reset();
      if (
        animation ||
        document.documentElement.dataset.layout !== "mobile" ||
        !(target instanceof Element) ||
        target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider']",
        )
      )
        return;
      let scrollUp = false,
        scrollDown = false;
      for (
        let node: Element | null = target;
        node && node !== sheet;
        node = node.parentElement
      ) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) {
          scrollDown ||= node.scrollTop > 0;
          scrollUp ||=
            node.scrollTop + node.clientHeight < node.scrollHeight - 1;
        }
      }
      const scale = sheet.getBoundingClientRect().width / sheet.offsetWidth;
      start = {
        x,
        y,
        scale,
        scrollUp,
        scrollDown,
        claimed: false,
        height: 0,
        heights: null,
      };
    };
    const move = (x: number, y: number) => {
      if (!start) return false;
      const dx = x - start.x,
        dy = y - start.y;
      if (!start.claimed) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return false;
        // Keep native scrolling for the entire gesture; take over on a new drag at the top.
        if (
          Math.abs(dx) >= Math.abs(dy) ||
          (dy > 0 && start.scrollDown) ||
          (dy < 0 &&
            start.scrollUp &&
            (!actions.current.onExpand || actions.current.expanded))
        ) {
          dragged = true;
          reset();
          return false;
        }
        start.claimed = true;
        start.height = sheet.getBoundingClientRect().height / start.scale;
        const content = sheet.querySelector(".config-dropdown-content");
        const scrollTop = content?.scrollTop ?? 0;
        sizeAnimation?.cancel();
        sizeAnimation = null;
        clearStyles();
        sheet.style.animation = "none";
        if (actions.current.onExpand) {
          sheet.classList.remove("is-expanded");
          const compact = sheet.getBoundingClientRect().height / start.scale;
          sheet.classList.add("is-expanded");
          const expanded = sheet.getBoundingClientRect().height / start.scale;
          sheet.classList.toggle("is-expanded", !!actions.current.expanded);
          start.heights = { compact, expanded };
        }
        sheet.classList.add("is-dragging");
        sheet.style.height = `${start.height}px`;
        sheet.style.maxHeight = "none";
        if (content) content.scrollTop = scrollTop;
      }
      dragged = true;
      const { expanded, onExpand, onCollapse } = actions.current;
      if (
        start.heights &&
        ((dy < 0 && onExpand && !expanded) ||
          (dy > 0 && onCollapse && expanded))
      ) {
        sheet.style.height = `${Math.max(start.heights.compact, Math.min(start.heights.expanded, start.height - dy / start.scale))}px`;
        sheet.style.removeProperty("transform");
      } else {
        sheet.style.height = `${start.height}px`;
        sheet.style.transform = `translateY(${(dy > 0 ? dy : dy * 0.15) / start.scale}px)`;
      }
      return true;
    };
    const finish = (x: number, y: number) => {
      if (start) {
        const dy = y - start.y,
          dx = x - start.x;
        if (Math.hypot(dx, dy) > 10) dragged = true;
        if (
          start.claimed &&
          Math.abs(dy) >= 40 &&
          Math.abs(dy) > Math.abs(dx)
        ) {
          if (dy > 0) {
            if (actions.current.expanded && actions.current.onCollapse) {
              settle(actions.current.onCollapse);
              return;
            }
            close();
          } else if (actions.current.onExpand) {
            settle(actions.current.onExpand);
            return;
          }
        } else if (start.claimed && actions.current.onExpand) {
          settle();
          return;
        }
      }
      reset();
    };
    const cancel = () => {
      dragged = true;
      if (start?.claimed && actions.current.onExpand) settle();
      else if (start) reset();
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return cancel();
      const touch = event.touches[0];
      begin(event.target, touch.clientX, touch.clientY);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !event.cancelable) return cancel();
      const touch = event.touches[0];
      if (move(touch.clientX, touch.clientY)) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (touch) finish(touch.clientX, touch.clientY);
      if (dragged && event.cancelable) event.preventDefault();
    };
    const pointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === "touch" ||
        !event.isPrimary ||
        event.button !== 0
      )
        return;
      dragged = false;
      if (!handle.contains(event.target as Node)) return;
      begin(event.target, event.clientX, event.clientY);
      handle.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") move(event.clientX, event.clientY);
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") finish(event.clientX, event.clientY);
    };
    const pointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== "touch") cancel();
    };
    const lostCapture = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && start) cancel();
    };
    const clickCapture = (event: MouseEvent) => {
      if (dragged && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    sheet.addEventListener("touchstart", touchStart, { passive: true });
    sheet.addEventListener("touchmove", touchMove, { passive: false });
    sheet.addEventListener("touchend", touchEnd);
    sheet.addEventListener("touchcancel", cancel);
    sheet.addEventListener("pointerdown", pointerDown);
    handle.addEventListener("pointermove", pointerMove);
    handle.addEventListener("pointerup", pointerUp);
    handle.addEventListener("pointercancel", pointerCancel);
    handle.addEventListener("lostpointercapture", lostCapture);
    sheet.addEventListener("click", clickCapture, true);
    return () => {
      sizeAnimation?.cancel();
      animation?.cancel();
      reset();
      sheet.removeEventListener("touchstart", touchStart);
      sheet.removeEventListener("touchmove", touchMove);
      sheet.removeEventListener("touchend", touchEnd);
      sheet.removeEventListener("touchcancel", cancel);
      sheet.removeEventListener("pointerdown", pointerDown);
      handle.removeEventListener("pointermove", pointerMove);
      handle.removeEventListener("pointerup", pointerUp);
      handle.removeEventListener("pointercancel", pointerCancel);
      handle.removeEventListener("lostpointercapture", lostCapture);
      sheet.removeEventListener("click", clickCapture, true);
    };
  }, []);

  return (
    <button
      ref={button}
      type="button"
      className="mobile-sheet-handle"
      aria-label={label}
      aria-expanded={expanded}
      onClick={() => activate.current()}
    >
      <span />
    </button>
  );
}
