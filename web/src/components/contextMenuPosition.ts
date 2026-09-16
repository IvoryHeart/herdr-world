export interface FloatingMenuPosition {
  left: number;
  top: number;
}

/** Keep a rendered floating menu inside the viewport around its anchor point. */
export function clampContextMenuPosition(
  anchor: FloatingMenuPosition,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): FloatingMenuPosition {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  return {
    left: Math.max(margin, Math.min(anchor.left, maxLeft)),
    top: Math.max(margin, Math.min(anchor.top, maxTop)),
  };
}

/** Re-clamp after menu-content, window, or mobile visual-viewport changes. */
export function observeClampedContextMenu(
  menu: HTMLElement,
  anchor: FloatingMenuPosition,
): () => void {
  const updatePosition = () => {
    const rect = menu.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const position = clampContextMenuPosition(
      anchor,
      { width: rect.width, height: rect.height },
      {
        width: visualViewport?.width ?? window.innerWidth,
        height: visualViewport?.height ?? window.innerHeight,
      },
    );
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
  };

  updatePosition();
  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updatePosition);
  resizeObserver?.observe(menu);
  window.addEventListener("resize", updatePosition);
  window.visualViewport?.addEventListener("resize", updatePosition);
  window.visualViewport?.addEventListener("scroll", updatePosition);
  return () => {
    resizeObserver?.disconnect();
    window.removeEventListener("resize", updatePosition);
    window.visualViewport?.removeEventListener("resize", updatePosition);
    window.visualViewport?.removeEventListener("scroll", updatePosition);
  };
}
