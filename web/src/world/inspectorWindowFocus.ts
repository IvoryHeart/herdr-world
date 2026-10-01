/** Keep pointer intent across listener reattachment while a window is raised. */
const pointerActiveWindows = new WeakSet<HTMLElement>();

/** Native listeners see portaled Inspector controls in their physical window. */
export function listenForInspectorWindowRaise(
  element: HTMLElement,
  onPointer: () => void,
  onFocus: () => void = onPointer,
) {
  const pointerEnd = () => {
    pointerActiveWindows.delete(element);
    window.removeEventListener("pointerup", pointerEnd, true);
    window.removeEventListener("pointercancel", pointerEnd, true);
  };
  const pointerDown = () => {
    pointerActiveWindows.add(element);
    window.addEventListener("pointerup", pointerEnd, true);
    window.addEventListener("pointercancel", pointerEnd, true);
    onPointer();
  };
  const focusIn = () => {
    if (pointerActiveWindows.has(element)) onPointer();
    else onFocus();
  };
  element.addEventListener("pointerdown", pointerDown, true);
  element.addEventListener("focusin", focusIn, true);
  return () => {
    element.removeEventListener("pointerdown", pointerDown, true);
    element.removeEventListener("focusin", focusIn, true);
  };
}
