import { CHAT_KEY } from "../../../../shared/chatKeys";
import { worldLocalStorage } from "../../browserStorage";
import {
  defaultMobileTerminalShortcutRows,
  MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
  parseMobileTerminalShortcutRows,
  type MobileTerminalShortcutAction,
  type MobileTerminalShortcutRows,
} from "../../mobileTerminalShortcuts";

const NAMED: Record<string, string> = {
  Space: "space",
  Enter: "enter",
  Tab: "tab",
  Escape: "esc",
  Backspace: "backspace",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Herdr's name for a composer key control, or null for one Chat cannot
 * press: scrolling, and keys Herdr does not name (Page Up/Down, Home, End,
 * Insert, Delete).
 */
export function chatKeyName(
  action: MobileTerminalShortcutAction,
): string | null {
  let name: string;
  if (typeof action === "string")
    name = action
      .replace(/^arrow-/, "")
      .replace(/^(ctrl|alt|shift)-/, "$1+")
      .replace(/^escape$/, "esc");
  else {
    const key =
      action.key.length === 1
        ? action.ctrl
          ? action.key.toLowerCase()
          : action.key
        : (NAMED[action.key] ?? action.key.toLowerCase());
    name = [
      action.ctrl ? "ctrl+" : "",
      action.alt ? "alt+" : "",
      action.shift && action.key.length > 1 ? "shift+" : "",
      key,
    ].join("");
  }
  return CHAT_KEY.test(name) ? name : null;
}

/** The terminal's key controls as the user arranged them in Settings. */
export function chatKeyRows(): MobileTerminalShortcutRows {
  try {
    const stored = worldLocalStorage.getItem(
      MOBILE_TERMINAL_SHORTCUTS_STORAGE_KEY,
    );
    return stored === null
      ? defaultMobileTerminalShortcutRows()
      : parseMobileTerminalShortcutRows(stored);
  } catch {
    return defaultMobileTerminalShortcutRows();
  }
}
