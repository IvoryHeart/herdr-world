import type React from "react";
export function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(".xterm")) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  if (target.closest(".file-preview-code .cm-editor")) return false;
  return target.isContentEditable;
}

export function blocksNavigationShortcuts(target: EventTarget | null) {
  if (
    target instanceof HTMLElement &&
    target.closest(".agent-history-composer")
  )
    return false;
  return isEditableElement(target);
}

export function blurActiveInput(event: React.PointerEvent<HTMLButtonElement>) {
  // A compact-row gesture may be a horizontal pan. Dismiss input only once
  // its native click handler confirms navigation, not at the start of a swipe.
  if (
    event.currentTarget.closest(
      ".app[data-mobile-controls-compact] .mobile-controls-stack",
    )
  )
    return;
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  const button = event.currentTarget;
  window.setTimeout(() => button.blur(), 0);
}
