import { useEffect, useRef } from "react";
import { shortcutMatches } from "../shortcutPreferences";

// Open dialogs, menus and the pane switcher own the keyboard while shown.
const KEYBOARD_OWNERS =
  '.modal-backdrop, .command-popover, .context-menu, .pane-jump-backdrop, .shortcut-modal, [role="menu"]';

/**
 * Whether a key aimed at `target` stays with it: a terminal (Ctrl+F is a
 * shell key), a text field or Chat composer ("/" starts slash commands), or
 * any other editable element.
 */
export function keyBelongsToTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".xterm, .cm-editor")) return true;
  if (target.closest("input, textarea, select")) return true;
  return target instanceof HTMLElement && target.isContentEditable;
}

/**
 * The `view.search` shortcut: "/" and Ctrl+F (Cmd+F on a Mac) by default.
 * It runs `onSearch` and keeps the browser's find closed, unless the key
 * belongs to a terminal, text field or editable element, or something else
 * already handled it.
 */
export function viewSearchShortcutApplies(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
    return false;
  if (!shortcutMatches(event, "view.search")) return false;
  if (keyBelongsToTarget(event.target)) return false;
  return !document.querySelector(KEYBOARD_OWNERS);
}

/** Puts the cursor in the mounted view's search on the `view.search` keys. */
export function useViewSearchShortcut(onSearch: () => void) {
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!viewSearchShortcutApplies(event)) return;
      event.preventDefault();
      if (!event.repeat) onSearchRef.current();
    };
    // Bubble phase: a handler nearer the target, such as a file preview's
    // own find, keeps the key when it claims it.
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
