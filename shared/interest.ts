/** The viewer's effective interest in an agent. Absence inherits group intent. */
export type Interest = "watching" | "muted" | "focused";

/**
 * Explicit agent overrides. Watching forces Watch; deletion means Default.
 * Muted stops an agent's chimes (its items still enter reception); focused
 * lets only focused agents chime, with the Town master's needs-you.
 */
export type StoredInterest = Interest;
export const STORED_INTERESTS: readonly StoredInterest[] = [
  "watching",
  "muted",
  "focused",
];
/** Group Default is absence; there is no group-level force-Watch. */
export type GroupInterest = "muted" | "focused";

/**
 * Interest belongs to the seat: the terminal on its host, with no runtime
 * generation. A terminal keeps its ID through moves, and an agent restarted
 * in it keeps its interest. Each agent in a multi-pane tab has its own.
 */
export const interestKey = (connectionId: string, terminalId: string) =>
  `${connectionId}:terminal:${terminalId}`;

/** Whether a stored key names a terminal on a host, as `interestKey` makes. */
export function isInterestKey(key: string) {
  const at = key.indexOf(":terminal:");
  return at > 0 && at + ":terminal:".length < key.length;
}

/** The stored keys for one host, so its gone terminals can be found. */
export const interestKeyPrefix = (connectionId: string) =>
  `${connectionId}:terminal:`;
