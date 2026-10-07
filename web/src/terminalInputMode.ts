import { worldLocalStorage } from "./browserStorage";

export type TerminalInputMode = "composer" | "direct";

export const TERMINAL_INPUT_MODE_STORAGE_KEY = "terminalInputMode.v1";
let unsavedMode: TerminalInputMode | undefined;

/** A browser UI preference, independent of drafts and live input sessions. */
export function readTerminalInputMode(): TerminalInputMode {
  return (
    unsavedMode ??
    (worldLocalStorage.getItem(TERMINAL_INPUT_MODE_STORAGE_KEY) === "direct"
      ? "direct"
      : "composer")
  );
}

/** Call only for an explicit mode choice, never a safety reset or picker. */
export function rememberTerminalInputMode(mode: TerminalInputMode) {
  try {
    worldLocalStorage.setItem(TERMINAL_INPUT_MODE_STORAGE_KEY, mode);
    unsavedMode = undefined;
  } catch {
    // Storage can be unavailable; retain the choice for this page's lifetime.
    unsavedMode = mode;
  }
}
