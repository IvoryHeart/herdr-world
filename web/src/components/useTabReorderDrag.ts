import { useEffect, useLayoutEffect, useRef } from "react";
import { tabDropSlot } from "../tabReorder";

/** Pointer travel before a press on a tab becomes a drag instead of a click. */
const DRAG_START_PX = 4;
/** Matches the `.tabbar-tab` transform transition in TabBar.css. */
const SETTLE_MS = 180;

type Session = {
  pointerId: number;
  tabId: string;
  startX: number;
  dragging: boolean;
  group: string[];
  index: number;
  rects: DOMRect[];
  scale: number;
  shift: number;
  slot: number;
};

/**
 * Press-and-drag reordering for the tab strip. The dragged tab follows the
 * pointer 1:1 inside its pin group while its neighbors slide aside; on release
 * it settles into its slot and `onDrop` receives the group's new order.
 * Escape or a cancelled pointer returns everything to rest.
 */
export function useTabReorderDrag({
  groupOf,
  orderKey,
  onDrop,
}: {
  /** Display-ordered tab ids sharing the tab's pin group. */
  groupOf: (tabId: string) => string[];
  /** Changes whenever the displayed tab order changes. */
  orderKey: string;
  onDrop: (tabId: string, groupOrder: string[]) => void;
}) {
  const elements = useRef(new Map<string, HTMLElement>());
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearOnReorder = useRef(false);

  const element = (tabId: string) => elements.current.get(tabId);

  const resetStyles = () => {
    for (const el of elements.current.values()) {
      el.style.transition = "none";
      el.style.transform = "";
      el.classList.remove("is-dragging", "is-settling");
      // Restore the stylesheet transition once the reset has been applied.
      void el.offsetWidth;
      el.style.transition = "";
    }
    elements.current
      .values()
      .next()
      .value?.parentElement?.classList.remove("is-reordering");
  };

  // The new order renders with every tab still offset; clear the offsets in
  // the same frame so nothing jumps.
  useLayoutEffect(() => {
    if (!clearOnReorder.current) return;
    clearOnReorder.current = false;
    resetStyles();
  }, [orderKey]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const layout = (current: Session, dx: number) => {
    const { rects, index, group, shift, scale } = current;
    const first = rects[0];
    const last = rects[rects.length - 1];
    const own = rects[index];
    const offset = Math.min(
      Math.max(dx, first.left - own.left),
      last.right - own.right,
    );
    // The leading edge can cross a narrow neighbor even at the group's bounds.
    const position =
      offset > 0
        ? own.right + offset
        : offset < 0
          ? own.left + offset
          : own.left + own.width / 2;
    const others = rects
      .filter((_, i) => i !== index)
      .map((rect) => rect.left + rect.width / 2);
    current.slot = tabDropSlot(position, others);
    group.forEach((tabId, i) => {
      const el = element(tabId);
      if (!el) return;
      if (i === index) {
        el.style.transform = `translateX(${offset / scale}px)`;
        return;
      }
      const moved =
        current.slot > index
          ? i > index && i <= current.slot
            ? -shift
            : 0
          : i >= current.slot && i < index
            ? shift
            : 0;
      el.style.transform = moved ? `translateX(${moved / scale}px)` : "";
    });
  };

  const finish = (commit: boolean) => {
    const current = session.current;
    session.current = null;
    if (!current?.dragging) return;
    const { rects, index, group, scale } = current;
    const slot = commit ? current.slot : index;
    const own = rects[index];
    const target =
      slot > index
        ? rects[slot].right - own.right
        : rects[slot].left - own.left;
    const el = element(current.tabId);
    if (el) {
      el.classList.remove("is-dragging");
      el.classList.add("is-settling");
      el.style.transform = target ? `translateX(${target / scale}px)` : "";
    }
    if (!commit || slot === index) {
      for (const tabId of group)
        if (tabId !== current.tabId) {
          const other = element(tabId);
          if (other) other.style.transform = "";
        }
    }
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      if (!commit || slot === index) {
        resetStyles();
        return;
      }
      const order = group.filter((tabId) => tabId !== current.tabId);
      order.splice(slot, 0, current.tabId);
      clearOnReorder.current = true;
      onDrop(current.tabId, order);
      // If the order did not change after all, nothing re-renders.
      requestAnimationFrame(() => {
        if (!clearOnReorder.current) return;
        clearOnReorder.current = false;
        resetStyles();
      });
    }, SETTLE_MS);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !session.current?.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  });

  return {
    /** Ref callback registering a tab's element. */
    register: (tabId: string) => (el: HTMLElement | null) => {
      if (el) elements.current.set(tabId, el);
      else elements.current.delete(tabId);
    },
    handlers: (tabId: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        // Touch keeps strip scrolling and the long-press menu.
        if (e.pointerType === "touch" || e.button !== 0) return;
        if ((e.target as HTMLElement).closest("button")) return;
        if (session.current || settleTimer.current) return;
        // Keep receiving release/cancel even before the drag threshold.
        e.currentTarget.setPointerCapture(e.pointerId);
        session.current = {
          pointerId: e.pointerId,
          tabId,
          startX: e.clientX,
          dragging: false,
          group: [],
          index: 0,
          rects: [],
          scale: 1,
          shift: 0,
          slot: 0,
        };
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        const current = session.current;
        if (!current || current.pointerId !== e.pointerId) return;
        if (!(e.buttons & 1)) {
          finish(false);
          return;
        }
        const dx = e.clientX - current.startX;
        if (!current.dragging) {
          if (Math.abs(dx) < DRAG_START_PX) return;
          const group = groupOf(tabId);
          const rects = group.map(
            (id) => element(id)?.getBoundingClientRect() ?? new DOMRect(),
          );
          const index = group.indexOf(tabId);
          if (index < 0 || group.length < 2) {
            session.current = null;
            return;
          }
          const gap =
            rects.length > 1 ? Math.max(0, rects[1].left - rects[0].right) : 0;
          // Rects and pointer coordinates are viewport pixels; transforms use
          // CSS pixels. Measure the actual zoom ratio, as other drag controls do.
          const bar = e.currentTarget.parentElement ?? e.currentTarget;
          Object.assign(current, {
            dragging: true,
            group,
            rects,
            scale: bar.getBoundingClientRect().width / bar.offsetWidth || 1,
            index,
            slot: index,
            shift: rects[index].width + gap,
          });
          e.currentTarget.classList.add("is-dragging");
          e.currentTarget.parentElement?.classList.add("is-reordering");
        }
        layout(current, dx);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        const current = session.current;
        if (!current || current.pointerId !== e.pointerId) return;
        if (current.dragging) suppressClick.current = true;
        finish(true);
      },
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
        if (session.current?.pointerId === e.pointerId) finish(false);
      },
      onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => {
        if (session.current?.pointerId === e.pointerId) finish(false);
      },
      onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    }),
  };
}
