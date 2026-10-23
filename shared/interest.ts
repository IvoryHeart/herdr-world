/** The viewer's interest in an agent; absent means watching. */
export type Interest = "watching" | "muted" | "focused";

/**
 * What World's service stores: watching is the default and is not stored.
 * Muted stops an agent's chimes (its items still enter reception); focused
 * lets only focused agents chime, with the Town master's needs-you.
 */
export type StoredInterest = Exclude<Interest, "watching">;
export const STORED_INTERESTS: readonly StoredInterest[] = ["muted", "focused"];

/**
 * Interest belongs to the seat: the terminal on its host, with no runtime
 * generation. A terminal keeps its ID through moves, and an agent restarted
 * in it keeps its interest. Each agent in a multi-pane tab has its own.
 */
export const interestKey = (connectionId: string, terminalId: string) =>
  `${connectionId}:terminal:${terminalId}`;

/** The stored keys for one host, so its gone terminals can be found. */
export const interestKeyPrefix = (connectionId: string) =>
  `${connectionId}:terminal:`;
