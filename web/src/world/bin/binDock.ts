/**
 * Board's dock (the hub beside the bin, WorldBin.tsx) floats centred over
 * the page. Board's controls (board/BoardControls.tsx) read it here, so they
 * leave it room instead of sitting under it.
 */

let dock: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The dock's ref: its element while shown, null once gone. */
export function setBinDock(element: HTMLElement | null) {
  if (dock === element) return;
  dock = element;
  listeners.forEach((listener) => listener());
}

export const binDock = () => dock;

/** Called as the dock appears or goes; returns the unsubscribe. */
export function onBinDock(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * The width the dock takes from a row of controls aligned to the row's right
 * edge: from the row's left edge to `gap` past the dock, when they share a
 * band. Nothing when the dock stands above, below or right of the row.
 */
export function dockReserve(
  row: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  dock: Pick<DOMRect, "left" | "right" | "top" | "bottom"> | null,
  gap: number,
) {
  if (
    !dock ||
    dock.bottom <= row.top ||
    dock.top >= row.bottom ||
    dock.left >= row.right ||
    dock.right + gap <= row.left
  )
    return 0;
  return Math.min(row.right - row.left, dock.right + gap - row.left);
}
