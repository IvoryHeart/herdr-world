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
  Enter: "enter",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
// Shift's characters on the Terminal's keyboard (mobileTerminalKeyCombination).
const UNSHIFTED = "`1234567890-=[]\\;',./";
const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';

/**
 * Herdr's name for a custom combination, matching what the Terminal sends:
 * Shift turns a printable key into its shifted character, since Herdr's
 * "shift+1" would send "1"; Ctrl+Shift keeps Shift only on letters. Null for
 * a combination the Terminal refuses or Herdr cannot name.
 */
function combinationName({
  key,
  ctrl,
  alt,
  shift,
}: Exclude<MobileTerminalShortcutAction, string>): string | null {
  const prefix = `${ctrl ? "ctrl+" : ""}${alt ? "alt+" : ""}`;
  if (key === "Tab") return ctrl || alt ? null : shift ? "shift+tab" : "tab";
  if (key === "Escape") return ctrl || shift ? null : `${prefix}esc`;
  if (key === "Backspace") return shift ? null : `${prefix}backspace`;
  // Shift leaves a space a space.
  if (key === "Space") return `${prefix}space`;
  if (key.length === 1) {
    const index = UNSHIFTED.indexOf(key);
    const shifted = !shift
      ? key
      : index >= 0
        ? SHIFTED[index]!
        : key.toUpperCase();
    // ESC [ and ESC O begin escape sequences; the Terminal sends these as
    // their own key codes, which Herdr cannot name.
    if (alt && !ctrl && (shifted === "[" || shifted === "O")) return null;
    if (!shift) return prefix + (ctrl ? key.toLowerCase() : key);
    if (!ctrl) return prefix + shifted;
    return /^[A-Z]$/.test(shifted)
      ? `${prefix}shift+${shifted.toLowerCase()}`
      : null;
  }
  const named =
    NAMED[key] ?? (/^F\d{1,2}$/.test(key) ? key.toLowerCase() : null);
  return named ? `${prefix}${shift ? "shift+" : ""}${named}` : null;
}

/**
 * Herdr's name for a composer key control, or null for one Chat cannot
 * press: scrolling, and keys Herdr does not name (Page Up/Down, Home, End,
 * Insert, Delete).
 */
export function chatKeyName(
  action: MobileTerminalShortcutAction,
): string | null {
  const name =
    typeof action === "string"
      ? action
          .replace(/^arrow-/, "")
          .replace(/^(ctrl|alt|shift)-/, "$1+")
          .replace(/^escape$/, "esc")
      : combinationName(action);
  return name !== null && CHAT_KEY.test(name) ? name : null;
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
