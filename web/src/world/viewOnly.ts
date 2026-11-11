import type { WorldLeafObject } from "./worldObject";

/** The title of a herdr-core agent's terminal control. */
export const CORE_WATCH_TITLE =
  "Open its terminal (World takes its size only while you type)";

const WAITING: Record<string, string> = {
  permission: "Waiting for permission",
  question: "Asking a question",
  auth: "Waiting to sign in",
};

/**
 * What a view-only (herdr-core) agent says about itself: the program's own
 * status message, else why it waits, else its task. World has no transcript
 * or screen for it, so this is the whole message it can show.
 */
export function viewOnlyMessage(leaf: WorldLeafObject): string {
  const said = leaf.pane.status_message?.trim();
  if (said) return said;
  if (leaf.status === "blocked")
    return WAITING[leaf.pane.blocked_kind ?? ""] ?? "Waiting for you";
  return (
    leaf.taskSummary ??
    (leaf.status === "done"
      ? "Finished its turn"
      : leaf.status === "working"
        ? "Working…"
        : leaf.status === "idle"
          ? "Idle"
          : "No status reported")
  );
}
