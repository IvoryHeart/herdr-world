import { useSyncExternalStore } from "react";

// Inspector headers can live in another React portal. Register their real DOM
// controls rather than polling the terminal/composer subtree for layout changes.
const headers = new Set<HTMLElement>();
const listeners = new Set<() => void>();
let target: HTMLElement | null = null;
let observer: ResizeObserver | null = null;
const refresh = () => {
  const visible = [...headers].filter((header) => {
    const frame = header.closest<HTMLElement>(
      ".world-managed-window.is-compact",
    );
    if (!frame) return false;
    const bounds = frame.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    const rect = header.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth
    );
  });
  const next =
    visible.find((header) =>
      header.closest(".world-managed-window.is-active"),
    ) ??
    visible[visible.length - 1] ??
    null;
  if (next === target) return;
  target = next;
  for (const listener of listeners) listener();
};

export function registerCompactWindowHeader(header: HTMLElement) {
  headers.add(header);
  if (!observer) {
    observer = new ResizeObserver(refresh);
    window.addEventListener("resize", refresh);
  }
  const frame = header.closest(".world-managed-window");
  observer.observe(header);
  if (frame) observer.observe(frame);
  refresh();
  return () => {
    headers.delete(header);
    observer?.unobserve(header);
    if (
      frame &&
      ![...headers].some(
        (other) => other.closest(".world-managed-window") === frame,
      )
    )
      observer?.unobserve(frame);
    if (!headers.size) {
      observer?.disconnect();
      observer = null;
      window.removeEventListener("resize", refresh);
    }
    refresh();
  };
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => target;
const empty = () => null;
const idle = () => () => {};
export function useWindowSwitcherHeader(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribe : idle,
    enabled ? snapshot : empty,
    empty,
  );
}
