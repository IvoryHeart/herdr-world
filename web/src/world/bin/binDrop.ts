/**
 * Dropping an agent on the bin: the bin chip and Town's stops carry
 * `data-bin-drop`. A drag in Town or on Board asks what is under its
 * pointer, and the target under it is marked (`data-bin-over`) while it is.
 */

let marked: Element | null = null;

/** The bin drop target under client point (x, y), or null. */
export function binDropAt(x: number, y: number): Element | null {
  if (typeof document.elementsFromPoint !== "function") return null;
  for (const element of document.elementsFromPoint(x, y)) {
    const target = element.closest("[data-bin-drop]");
    if (target) return target;
  }
  return null;
}

/** Mark the drop target a drag is over (null: none). */
export function markBinDrop(target: Element | null) {
  if (target === marked) return;
  marked?.removeAttribute("data-bin-over");
  target?.setAttribute("data-bin-over", "");
  marked = target;
}

/** Whether a drag at client point (x, y) is over the bin; marks it so. */
export function aimAtBin(at: { x: number; y: number } | null) {
  const target = at ? binDropAt(at.x, at.y) : null;
  markBinDrop(target);
  return target !== null;
}
