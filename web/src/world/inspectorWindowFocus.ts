/** Native listeners see portaled Inspector controls in their physical window. */
export function listenForInspectorWindowRaise(
  element: HTMLElement,
  raise: () => void,
) {
  element.addEventListener("pointerdown", raise, true);
  element.addEventListener("focusin", raise, true);
  return () => {
    element.removeEventListener("pointerdown", raise, true);
    element.removeEventListener("focusin", raise, true);
  };
}
