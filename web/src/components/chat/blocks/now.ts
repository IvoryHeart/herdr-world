/** Harnesses where Esc interrupts the current turn without quitting. */
export const STOPS_WITH_ESCAPE = new Set(["claude", "codex", "pi"]);
/** Two presses of Esc this close together stop the agent. */
export const DOUBLE_ESCAPE_MS = 700;

export function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The task a harness names in its title, without its spinner glyph. */
export const titleTask = (title: string | null | undefined) =>
  title?.replace(/^[^\p{L}\p{N}]+/u, "").trim() || null;

export const STATUS_WORDS: Record<string, string> = {
  working: "Working",
  blocked: "Needs you",
  done: "Done",
  idle: "Idle",
};
