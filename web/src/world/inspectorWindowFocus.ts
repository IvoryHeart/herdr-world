/** Native listeners see portaled Inspector controls in their physical window. */
export function listenForInspectorWindowRaise(
  element: HTMLElement,
  onPointer: () => void,
  onFocus: () => void = onPointer,
) {
  let pointerActive = false;
  const pointerDown = () => {
    pointerActive = true;
    onPointer();
  };
  const pointerEnd = () => {
    pointerActive = false;
  };
  const focusIn = () => {
    if (pointerActive) onPointer();
    else onFocus();
  };
  element.addEventListener("pointerdown", pointerDown, true);
  element.addEventListener("focusin", focusIn, true);
  window.addEventListener("pointerup", pointerEnd, true);
  window.addEventListener("pointercancel", pointerEnd, true);
  return () => {
    element.removeEventListener("pointerdown", pointerDown, true);
    element.removeEventListener("focusin", focusIn, true);
    window.removeEventListener("pointerup", pointerEnd, true);
    window.removeEventListener("pointercancel", pointerEnd, true);
  };
}
