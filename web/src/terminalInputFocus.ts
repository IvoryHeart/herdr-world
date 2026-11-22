/**
 * Which terminal input holds focus, as an attribute on <html>:
 * `data-terminal-input-focus` lists "terminal" (xterm's helper textarea) or
 * "composer" (the draft editor), plus "bar" when that composer sits in the
 * phone's bottom bar. Absent while neither has focus.
 *
 * Shell styles (header, tab bar, pane switcher, toasts) read this instead of
 * `.app:has(.terminal-composer-input:focus)`. A `:has()` on a shell ancestor
 * makes Chrome restyle the whole app on every DOM change below it, and each
 * typed key changes the composer's text (#1231).
 */
export const TERMINAL_INPUT_FOCUS_ATTRIBUTE = "data-terminal-input-focus";

export function terminalInputFocusTokens(
  element: Element | null,
): string | null {
  // Only inputs inside the App shell count, as the old `.app:has()` did.
  if (!element?.closest(".app")) return null;
  if (element.matches(".xterm-helper-textarea")) return "terminal";
  if (!element.matches(".terminal-composer-input")) return null;
  return element.closest(".mobile-bottom-bar") ? "composer bar" : "composer";
}

export function syncTerminalInputFocus(
  focused: Element | null = document.activeElement,
  root: HTMLElement = document.documentElement,
) {
  const tokens = terminalInputFocusTokens(focused);
  if (tokens === root.getAttribute(TERMINAL_INPUT_FOCUS_ATTRIBUTE)) return;
  if (tokens) root.setAttribute(TERMINAL_INPUT_FOCUS_ATTRIBUTE, tokens);
  else root.removeAttribute(TERMINAL_INPUT_FOCUS_ATTRIBUTE);
}

let installs = 0;
let uninstall: (() => void) | null = null;

/**
 * Follows focus for the document. `focusout` names where focus goes next
 * (null when it leaves, including when Chrome and Safari remove a focused
 * element), so the attribute never waits for a later event. Each App mount
 * installs it; the listeners stay until the last one unmounts.
 */
export function installTerminalInputFocusFlag(): () => void {
  installs += 1;
  if (!uninstall) {
    const root = document.documentElement;
    const focusIn = (event: FocusEvent) =>
      syncTerminalInputFocus(event.target as Element, root);
    const focusOut = (event: FocusEvent) =>
      syncTerminalInputFocus(event.relatedTarget as Element | null, root);
    syncTerminalInputFocus(document.activeElement, root);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    uninstall = () => {
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      root.removeAttribute(TERMINAL_INPUT_FOCUS_ATTRIBUTE);
    };
  }
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    installs -= 1;
    if (installs > 0) return;
    uninstall?.();
    uninstall = null;
  };
}
